"""Matched v1/v2 inference with program-owned v2 dispatch. Never trains."""
import argparse
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

from legacy import V1, common, runtime as old
from protocol import parse_proposal
from tool_control import ToolController, preflight

ROOT = Path(__file__).resolve().parent
GIB = 1024 ** 3


def build_messages(record, variant, prompt):
    # Exact v1 message assembly retained for both arms; only v2 prompt differs.
    return common.messages(record, prompt)


def admission(record, variant):
    return preflight(record["tool_state"]) if variant == "v2" else {"allow_model": True, "canonical": None, "error": None}


def finalize(record, row, variant):
    """No gold labels enter protocol normalization or actual arithmetic dispatch."""
    if variant == "v1":
        obj, strict = common.parse_output(row["raw_output"])
        valid = common.validate_output(obj)
        state = record["tool_state"]
        exhausted = bool(state and state["status"] == "TIMEOUT" and state["attempts"] >= state["max_attempts"])
        action = obj["next_action"] if valid else {}
        replay = common.calculate(action["arguments"]) if action.get("type") == "call_tool" and not exhausted else None
        row.update(protocol_accepted=valid, canonical_output=obj if valid else None,
                   legacy_strict_json=strict, legacy_arithmetic_replay=replay,
                   execution_status="BLOCKED_RETRY_LIMIT" if exhausted and action.get("type") == "call_tool" else "LEGACY_REPLAY_ONLY")
    else:
        parsed = parse_proposal(row["raw_output"])
        controller = ToolController(record["tool_state"])
        dispatched = controller.dispatch(parsed)
        row.update(protocol_accepted=parsed["accepted"], parsed=parsed,
                   canonical_output=parsed["canonical"], dispatch=dispatched,
                   controller_snapshot=controller.snapshot)
    return row


def terminal_row(record, args):
    check = admission(record, args.variant)
    if check["allow_model"]:
        return None
    if check["error"]:
        raise ValueError("Invalid trusted tool state")
    return {"id": record["id"], "backend": args.backend, "variant": args.variant, "at": common.now(),
            "model_invoked": False, "raw_output": "", "finish_reason": "program_terminal",
            "latency_seconds": 0.0, "canonical_output": check["canonical"], "protocol_accepted": None,
            "preflight": check}


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
    old.stage(args.run_dir, "loading")
    start = time.perf_counter()
    model, tokenizer = load(str(args.model_path), lazy=False, trust_remote_code=False)
    mx.eval(model.parameters())
    mx.synchronize()
    common.save(args.run_dir / "load.json", {"seconds": time.perf_counter() - start,
        "device": mx.device_info(), "packages": {p: metadata.version(p) for p in ["mlx", "mlx-metal", "mlx-lm", "transformers"]}})
    for record in records:
        skipped = terminal_row(record, args)
        if skipped:
            common.append(args.run_dir / "results.jsonl", skipped)
            old.stage(args.run_dir, "program_terminal", id=record["id"])
            continue
        mx.clear_cache()
        mx.reset_peak_memory()
        msgs = build_messages(record, args.variant, prompt)
        rendered = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        if not rendered.endswith("<think>\n\n</think>\n\n"):
            raise ValueError("Non-thinking template not confirmed")
        tokens = tokenizer.encode(rendered, add_special_tokens=False)
        if len(tokens) + 512 > 6144:
            raise ValueError("Context bound exceeded")
        old.stage(args.run_dir, "generating", id=record["id"])
        t0 = time.perf_counter()
        chunks, ids, first, final = [], [], None, None
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
        row = {"id": record["id"], "backend": "qwen", "variant": args.variant, "at": common.now(),
            "model_invoked": True, "raw_output": "".join(chunks), "rendered_prompt": rendered,
            "output_token_ids": ids, "input_tokens": len(tokens), "output_tokens": len(ids),
            "finish_reason": final.finish_reason, "latency_seconds": time.perf_counter() - t0,
            "ttft_seconds": first, "mlx_peak_bytes": mx.get_peak_memory()}
        common.append(args.run_dir / "results.jsonl", finalize(record, row, args.variant))
        old.stage(args.run_dir, "case_done", id=record["id"])
    old.stage(args.run_dir, "finished")


def supervise(args):
    before = old.memory_snapshot()
    common.save(args.run_dir / "memory-before.json", before)
    if before["pressure_level"] != 1:
        common.save(args.run_dir / "outcome.json", {"completed": False, "stop_reason": "initial_memory_pressure"})
        return 1
    argv = [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], "--worker"]
    env = dict(os.environ, HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1",
               HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false", PYTHONUNBUFFERED="1")
    start, warning, reason = time.monotonic(), None, None
    with (args.run_dir / "worker.log").open("w") as log:
        child = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        common.save(args.run_dir / "owned-process.json", {"pid": child.pid, "created_at": common.now()})
        try:
            while child.poll() is None:
                sample = old.memory_snapshot()
                common.append(args.run_dir / "telemetry.jsonl", sample)
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
    common.save(args.run_dir / "memory-after.json", old.memory_snapshot())
    common.save(args.run_dir / "outcome.json", {"exit_code": child.returncode, "stop_reason": reason,
        "completed": child.returncode == 0 and reason is None, "seconds": time.monotonic() - start})
    return 0 if child.returncode == 0 and reason is None else 1


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, None)


def deepseek(args, records, prompt):
    if args.key_file is None or args.key_file.stat().st_mode & 0o077:
        raise ValueError("Private API credential file required")
    key = args.key_file.read_text().strip()
    if not key:
        raise ValueError("Empty API credential")
    opener = urllib.request.build_opener(NoRedirect())
    reserved, failed = 0.0, 0
    for record in records:
        skipped = terminal_row(record, args)
        if skipped:
            common.append(args.run_dir / "results.jsonl", skipped)
            old.stage(args.run_dir, "program_terminal", id=record["id"])
            continue
        msgs = build_messages(record, args.variant, prompt)
        token_upper = sum(len(m["content"].encode()) for m in msgs) + 256
        reserve = (token_upper * 1.32 + 512 * 3.96) / 1e6
        if token_upper > 18000 or reserved + reserve > 2:
            raise RuntimeError("Predeclared API budget bound reached")
        payload = {"model": "deepseek-v4-pro", "messages": msgs, "temperature": 0,
                   "max_tokens": 512, "stream": False, "thinking": {"type": "disabled"}}
        req = urllib.request.Request("https://api.deepseek.com/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode(),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
        reserved += reserve
        old.stage(args.run_dir, "requesting", id=record["id"])
        start = time.perf_counter()
        row = {"id": record["id"], "backend": "deepseek", "variant": args.variant, "at": common.now(), "model_invoked": True}
        try:
            with opener.open(req, timeout=120) as response:
                value = json.load(response)
            choice = value["choices"][0]
            row.update(raw_output=choice["message"].get("content") or "", finish_reason=choice["finish_reason"],
                request_messages=msgs, request_model="deepseek-v4-pro", response_model=value.get("model"),
                response_id=value.get("id"), system_fingerprint=value.get("system_fingerprint"), usage=value.get("usage"))
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError, IndexError, TypeError, AttributeError) as exc:
            failed += 1
            row.update(raw_output="", finish_reason="request_error", error_type=type(exc).__name__, http_status=getattr(exc, "code", None))
        row["latency_seconds"] = time.perf_counter() - start
        common.append(args.run_dir / "results.jsonl", finalize(record, row, args.variant))
        old.stage(args.run_dir, "case_done", id=record["id"])
        if failed >= 3:
            common.save(args.run_dir / "outcome.json", {"completed": False, "failed": failed,
                "stop_reason": "three_request_errors", "reserved_peak_usd_upper": reserved})
            return 1
    common.save(args.run_dir / "outcome.json", {"completed": True, "failed": failed, "reserved_peak_usd_upper": reserved, "actual_billed_cost": None})
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["qwen", "deepseek"], required=True)
    parser.add_argument("--variant", choices=["v1", "v2"], required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--model-path", type=Path)
    parser.add_argument("--integrity-dir", type=Path)
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    records = [common.visible(r) for r in common.read_jsonl(args.inputs)]
    if not records or len(records) > 108 or len({r["id"] for r in records}) != len(records):
        raise ValueError("Invalid input count or IDs")
    for record in records:
        if preflight(record["tool_state"])["error"]:
            raise ValueError("Invalid trusted state in dataset")
    prompt_path = (V1 if args.variant == "v1" else ROOT) / "prompt.txt"
    prompt = prompt_path.read_text()
    if args.worker:
        qwen_worker(args, records, prompt)
        return 0
    args.run_dir.mkdir(parents=True, exist_ok=False)
    protocol = {"created_at": common.now(), "backend": args.backend, "variant": args.variant,
        "training": False, "adapter": None, "inputs_sha256": common.sha(args.inputs),
        "prompt_sha256": common.sha(prompt_path), "case_ids": [r["id"] for r in records],
        "source_sha256": {p.name: common.sha(p) for p in sorted(ROOT.glob("*.py"))},
        "v1_dependency_sha256": {p.name: common.sha(p) for p in sorted(V1.glob("*.py"))},
        "temperature": 0, "max_new_tokens": 512, "thinking": "disabled", "context_reset_per_case": True,
        "automatic_api_retries": 0, "concurrency": 1, "gold_sent_to_inference": False,
        "response_format": "prompt_only_json; no constrained decoding", "api_budget_usd_upper_per_run": 2,
        "program_terminal_bypass": args.variant == "v2",
        "scope": "fixed history one-step decisions; v2 actual local arithmetic dispatch; not website integration"}
    if args.backend == "qwen":
        protocol["model"] = old.verify_model(args.model_path, args.integrity_dir)
        protocol["guard"] = {"memory_guideline_gib": 28, "max_swap_growth_gib": 4, "warning_seconds": 10,
                             "critical_pressure": 4, "max_stage_seconds": 180, "max_total_seconds": 3600}
    else:
        protocol["model"] = "deepseek-v4-pro"
        protocol["model_pin_limit"] = "provider alias; returned model and fingerprint recorded per response"
    common.save(args.run_dir / "protocol.json", protocol)
    common.save(args.run_dir / "inputs-visible.json", records)
    return supervise(args) if args.backend == "qwen" else deepseek(args, records, prompt)


if __name__ == "__main__":
    raise SystemExit(main())
