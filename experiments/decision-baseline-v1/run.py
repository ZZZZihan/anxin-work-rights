"""Run frozen decision baselines. No fine-tuning or external business actions."""
import argparse
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

from common import ROOT, append, messages, now, read_jsonl, save, sha, visible

GIB = 1024 ** 3


def memory_snapshot():
    pressure = int(subprocess.check_output(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], text=True))
    swap = subprocess.check_output(["sysctl", "-n", "vm.swapusage"], text=True)
    m = re.search(r"used\s*=\s*([\d.]+)([MG])", swap)
    return {"at": now(), "pressure_level": pressure,
            "swap_used_bytes": float(m[1]) * (1024 ** 2 if m[2] == "M" else GIB)}


def stage(run, name, **data):
    value = {"at": now(), "monotonic": time.monotonic(), "stage": name, **data}
    tmp = run / "status.tmp"
    save(tmp, value)
    tmp.replace(run / "status.json")
    append(run / "events.jsonl", value)
    print(json.dumps(value, ensure_ascii=False), flush=True)


def verify_model(model, integrity):
    manifest = json.loads((integrity / "source-manifest.json").read_text())
    verification = json.loads((integrity / "weights-verification.json").read_text())
    if not verification["all_ok"] or verification["revision"] != manifest["revision"]:
        raise ValueError("Model verification incomplete")
    if Path(verification["model_dir"]).resolve() != model.resolve():
        raise ValueError("Model verification path mismatch")
    if verification["manifest_sha256"] != sha(integrity / "source-manifest.json"):
        raise ValueError("Model manifest changed")
    for item in verification["files"]:
        st = (model / item["path"]).stat()
        if [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns] != item["stat_fingerprint"]:
            raise ValueError("Model file changed since full hash verification")
    return {"repository": manifest["repo_id"], "revision": manifest["revision"],
            "integrity_method": "prior full hashes plus current stat fingerprints",
            "manifest_sha256": sha(integrity / "source-manifest.json")}


def qwen_worker(args, records, prompt):
    import mlx.core as mx
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler
    if not mx.metal.is_available():
        raise RuntimeError("Metal unavailable")
    mx.set_default_device(mx.gpu)
    mx.set_memory_limit(28 * GIB)
    mx.set_wired_limit(24 * GIB)
    mx.set_cache_limit(512 * 1024 ** 2)
    mx.random.seed(123)
    stage(args.run_dir, "loading")
    started = time.perf_counter()
    model, tokenizer = load(str(args.model_path), lazy=False, trust_remote_code=False)
    mx.eval(model.parameters())
    mx.synchronize()
    save(args.run_dir / "load.json", {"seconds": time.perf_counter() - started,
         "device": mx.device_info(), "packages": {p: metadata.version(p) for p in
         ["mlx", "mlx-metal", "mlx-lm", "transformers"]}})
    for record in records:
        mx.clear_cache()
        mx.reset_peak_memory()
        msgs = messages(record, prompt)
        rendered = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True,
                                                   enable_thinking=False)
        if not rendered.endswith("<think>\n\n</think>\n\n"):
            raise ValueError("Non-thinking Qwen template not confirmed")
        tokens = tokenizer.encode(rendered, add_special_tokens=False)
        if len(tokens) + 512 > 6144:
            raise ValueError("Context bound exceeded")
        stage(args.run_dir, "generating", id=record["id"])
        t0 = time.perf_counter()
        chunks, ids = [], []
        first = None
        final = None
        for response in stream_generate(model, tokenizer, tokens, max_tokens=512,
                sampler=make_sampler(temp=0.0), prefill_step_size=256):
            if first is None:
                first = time.perf_counter() - t0
            chunks.append(response.text)
            if response.token not in tokenizer.eos_token_ids:
                ids.append(response.token)
            final = response
        mx.synchronize()
        if final is None:
            raise RuntimeError("No generation result")
        append(args.run_dir / "results.jsonl", {"id": record["id"], "backend": "qwen",
            "at": now(), "raw_output": "".join(chunks), "rendered_prompt": rendered,
            "output_token_ids": ids, "input_tokens": len(tokens), "output_tokens": len(ids),
            "finish_reason": final.finish_reason, "latency_seconds": time.perf_counter() - t0,
            "ttft_seconds": first, "mlx_peak_bytes": mx.get_peak_memory()})
        stage(args.run_dir, "case_done", id=record["id"])
    stage(args.run_dir, "finished")


def supervised_qwen(args):
    before = memory_snapshot()
    save(args.run_dir / "memory-before.json", before)
    if before["pressure_level"] != 1:
        save(args.run_dir / "outcome.json", {"completed": False, "stop_reason": "initial_memory_pressure"})
        return 1
    argv = [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], "--worker"]
    env = dict(os.environ, HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
               HF_HUB_DISABLE_IMPLICIT_TOKEN="1", HF_HUB_DISABLE_TELEMETRY="1",
               TOKENIZERS_PARALLELISM="false", PYTHONUNBUFFERED="1")
    start = time.monotonic()
    warning = None
    reason = None
    with (args.run_dir / "worker.log").open("w") as log:
        child = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        save(args.run_dir / "owned-process.json", {"pid": child.pid, "created_at": now()})
        try:
            while child.poll() is None:
                sample = memory_snapshot()
                append(args.run_dir / "telemetry.jsonl", sample)
                status = json.loads((args.run_dir / "status.json").read_text()) if (args.run_dir / "status.json").exists() else None
                warning = (warning or time.monotonic()) if sample["pressure_level"] >= 2 else None
                if sample["pressure_level"] >= 4:
                    reason = "critical_memory_pressure"
                elif warning and time.monotonic() - warning >= 10:
                    reason = "sustained_memory_warning"
                elif sample["swap_used_bytes"] - before["swap_used_bytes"] > 4 * GIB:
                    reason = "swap_growth_above_4_GiB"
                elif time.monotonic() - start > 3600:
                    reason = "total_timeout"
                elif status and time.monotonic() - status["monotonic"] > 180:
                    reason = "stage_timeout"
                if reason:
                    break
                time.sleep(2)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=10)
    save(args.run_dir / "memory-after.json", memory_snapshot())
    save(args.run_dir / "outcome.json", {"exit_code": child.returncode, "stop_reason": reason,
        "completed": child.returncode == 0 and reason is None, "seconds": time.monotonic() - start})
    return 0 if child.returncode == 0 and reason is None else 1


def deepseek(args, records, prompt):
    # Key stays out of argv, manifests, prompts, exception messages and repository.
    key_path = args.key_file
    if key_path is None or key_path.stat().st_mode & 0o077:
        raise ValueError("A private key file with permissions 0600 is required")
    key = key_path.read_text().strip()
    estimated_usd = 0.0
    failed = 0
    for record in records:
        # At most 108 calls, <=~6k input tokens (guarded by byte count), 512 output.
        # Reserve at peak Pro rates; actual pricing/discounts are reported separately.
        msgs = messages(record, prompt)
        input_token_upper = sum(len(m["content"].encode("utf-8")) for m in msgs) + 256
        reserve = input_token_upper * 1.32 / 1e6 + 512 * 3.96 / 1e6
        if estimated_usd + reserve > 2.0 or input_token_upper > 18000:
            raise RuntimeError("Predeclared API budget bound reached")
        payload = {"model": args.api_model, "messages": msgs, "temperature": 0,
                   "max_tokens": 512, "stream": False, "thinking": {"type": "disabled"}}
        req = urllib.request.Request("https://api.deepseek.com/chat/completions",
              data=json.dumps(payload, ensure_ascii=False).encode(),
              headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
        stage(args.run_dir, "requesting", id=record["id"])
        start = time.perf_counter()
        estimated_usd += reserve  # includes uncertain failed requests, never retried silently
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                value = json.load(response)
            choice = value["choices"][0]
            row = {"id": record["id"], "backend": "deepseek", "at": now(),
                   "raw_output": choice["message"].get("content") or "",
                   "finish_reason": choice["finish_reason"], "request_messages": msgs,
                   "request_model": args.api_model, "response_model": value.get("model"),
                   "response_id": value.get("id"), "system_fingerprint": value.get("system_fingerprint"),
                   "usage": value.get("usage"), "latency_seconds": time.perf_counter() - start}
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as exc:
            failed += 1
            row = {"id": record["id"], "backend": "deepseek", "at": now(), "raw_output": "",
                   "finish_reason": "request_error", "error_type": type(exc).__name__,
                   "http_status": getattr(exc, "code", None), "latency_seconds": time.perf_counter() - start}
        append(args.run_dir / "results.jsonl", row)
        stage(args.run_dir, "case_done", id=record["id"])
        if failed >= 3:
            save(args.run_dir / "outcome.json", {"completed": False, "failed": failed,
                "stop_reason": "three_request_errors", "reserved_peak_usd_upper": estimated_usd})
            return 1
    save(args.run_dir / "outcome.json", {"completed": True, "failed": failed,
         "reserved_peak_usd_upper": estimated_usd, "actual_billed_cost": None})
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["rules", "qwen", "deepseek"], required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--integrity-dir", type=Path)
    parser.add_argument("--api-model", default="deepseek-v4-pro")
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    records = [visible(r) for r in read_jsonl(args.inputs)]
    if args.limit is not None:
        records = records[:args.limit]
    if not records or len(records) > 108 or len({r["id"] for r in records}) != len(records):
        raise ValueError("Invalid input count/IDs")
    prompt = (ROOT / "prompt.txt").read_text()
    if args.worker:
        qwen_worker(args, records, prompt)
        return 0
    args.run_dir.mkdir(parents=True, exist_ok=False)
    protocol = {"created_at": now(), "backend": args.backend, "training": False, "adapter": None,
        "inputs_sha256": sha(args.inputs), "prompt_sha256": sha(ROOT / "prompt.txt"),
        "source_sha256": {p.name: sha(p) for p in ROOT.glob("*.py")},
        "case_ids": [r["id"] for r in records], "temperature": 0, "max_new_tokens": 512,
        "thinking": "disabled", "context_reset_per_case": True, "calls_per_case": 1,
        "automatic_api_retries": 0, "concurrency": 1, "gold_sent_to_inference": False,
        "response_format": "prompt_only_json; no constrained decoding in either model",
        "metric_scope": "one-step decisions from fixed history snapshots; not interactive completion"}
    if args.backend == "qwen":
        protocol["model"] = verify_model(args.model_path, args.integrity_dir)
        protocol["guard"] = {"memory_guideline_gib": 28, "max_swap_growth_gib": 4,
            "warning_seconds": 10, "critical_pressure": 4, "max_stage_seconds": 180,
            "max_total_seconds": 3600, "note": "MLX guideline is not a process/system hard cap"}
    if args.backend == "deepseek":
        protocol["model"] = args.api_model
        protocol["model_pin_limit"] = "Provider model alias; record returned model and fingerprint. Backend revision may change."
        protocol["api_budget_usd_upper_per_run"] = 2.0
        protocol["pricing_reference"] = "https://api-docs.deepseek.com/quick_start/pricing/"
    save(args.run_dir / "protocol.json", protocol)
    save(args.run_dir / "inputs-visible.json", records)
    if args.backend == "qwen":
        return supervised_qwen(args)
    if args.backend == "deepseek":
        return deepseek(args, records, prompt)
    from rules import predict
    for record in records:
        start = time.perf_counter()
        value = predict(record)
        append(args.run_dir / "results.jsonl", {"id": record["id"], "backend": "rules",
            "at": now(), "raw_output": json.dumps(value, ensure_ascii=False), "finish_reason": "stop",
            "latency_seconds": time.perf_counter() - start})
    save(args.run_dir / "outcome.json", {"completed": True, "failed": 0})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
