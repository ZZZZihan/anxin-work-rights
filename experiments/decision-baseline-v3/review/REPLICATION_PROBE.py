"""Independent offline adapter probe; all run/data writes use TemporaryDirectory.

Usage: python3 REPLICATION_PROBE.py /absolute/path/to/decision-baseline-v3
Does not open the project's holdout inputs, labels or model result contents.
"""
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch


SOURCE = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(SOURCE))
import dev
import freeze
import reporting
import run
from dependencies import common, parse_proposal

spec = importlib.util.spec_from_file_location("reviewed_replication_adapter", SOURCE / "replication/reproduce.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")


def jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def call(due=0, paid=0):
    return json.dumps({"action": "call_tool", "tool": "calculate_wage_gap", "arguments": {
        "period_start": "2026-01-01", "period_end": "2026-01-31", "due": due, "paid": paid}})


def ask(field):
    return json.dumps({"action": "ask_user", "questions": [{"field": field, "reason": "missing",
        "text": "请核实该期间完整工资总额及来源。"}]}, ensure_ascii=False)


def rejected(fn):
    try:
        fn()
    except ValueError:
        return
    raise AssertionError("Adapter accepted a forbidden mutation")


def invoke(*arguments):
    with patch.object(sys, "argv", [str(SOURCE / "replication/reproduce.py"), *arguments]), patch("sys.stdout", new=io.StringIO()):
        adapter.main()


def main():
    with tempfile.TemporaryDirectory(prefix="anxin-independent-replication-") as temporary:
        outer = Path(temporary)
        base, v1, v2 = [outer / x for x in ("decision-baseline-v3", "decision-baseline-v1", "decision-baseline-v2")]
        for directory in (base, v1, v2):
            directory.mkdir()
            (directory / "marker.py").write_text("# synthetic source only\n", encoding="utf-8")
        for directory in (v1, v2):
            save(directory / "freeze.json", {"fixture": True})
        for name in ("CONTRACT.md", "METRICS.md", "DEVELOPMENT.md"):
            (base / name).write_text("offline fixture only\n", encoding="utf-8")
        prompt = "独立适配器回归夹具，不用于模型请求。"
        (base / "prompt.txt").write_text(prompt, encoding="utf-8")
        records = [
            dev.make_record("replication-fixture-unknown-due", due=None, status_due="unknown"),
            dev.make_record("replication-fixture-unknown-paid", paid=None, status_paid="unknown"),
            dev.make_record("replication-fixture-zero", due="0.00"),
            dev.make_record("replication-fixture-negative", due="0.00", paid="100.00"),
            dev.make_record("replication-fixture-terminal-a", state={"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}),
            dev.make_record("replication-fixture-terminal-b", state={"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}),
        ]
        correct_raw = [ask("agreed_due_total"), ask("wage_paid_total"), call(), call(0, 100)]
        labels = []
        for index, record in enumerate(records):
            expected = (parse_proposal(correct_raw[index])["canonical"] if index < 4 else
                        run.terminal_row(record, SimpleNamespace(backend="qwen"))["canonical_output"])
            labels.append({"id": record["id"], "group_id": "fixture-pair-" + str(index // 2),
                           "category": "independent-adapter-probe", "expected": expected})
        jsonl(base / "data/test.inputs.jsonl", records)
        jsonl(base / "data/test.labels.jsonl", labels)
        rep = base / "replication"
        (rep / "results").mkdir(parents=True)
        (rep / "data").symlink_to("../data", target_is_directory=True)
        (rep / "freeze.json").symlink_to("../freeze.json")
        (rep / "results/qwen").symlink_to("../../results/qwen", target_is_directory=True)

        with patch.multiple(freeze, ROOT=base, V1=v1, V2=v2), patch.multiple(adapter, HERE=rep, BASE=base), patch.object(reporting, "ROOT", rep):
            save(base / "freeze.json", {"source_sha256": freeze.sources(), "data_sha256": {
                p.name: sha(p) for p in (base / "data").iterdir()}})

            def make_run(backend, directory, raws, selected=range(6)):
                directory.mkdir(parents=True, exist_ok=True)
                protocol = {"backend": backend, "source_sha256": {p.name: sha(p) for p in base.glob("*.py")},
                    "dependency_sha256": {p.relative_to(base.parent).as_posix(): sha(p) for d in (v1, v2) for p in d.glob("*.py")},
                    "prompt_sha256": sha(base / "prompt.txt"), "inputs_sha256": sha(base / "data/test.inputs.jsonl"),
                    "training": False, "adapter": None, "gold_sent_to_inference": False,
                    "case_ids": [r["id"] for r in records]}
                save(directory / "protocol.json", protocol)
                save(directory / "inputs-visible.json", records)
                save(directory / "outcome.json", {"completed": True, "fixture": True})
                rows = []
                for index in selected:
                    record = records[index]
                    row = run.terminal_row(record, SimpleNamespace(backend=backend))
                    if row is None:
                        messages = run.build_messages(record, "v3", prompt)
                        row = {"id": record["id"], "backend": backend, "variant": "v3", "model_invoked": True,
                            "request_messages": messages, "raw_output": raws[index], "finish_reason": "stop", "latency_seconds": 0.01}
                        if backend == "qwen":
                            row["rendered_prompt"] = "".join("<|im_start|>" + m["role"] + "\n" + m["content"] + "<|im_end|>\n" for m in messages) + "<|im_start|>assistant\n<think>\n\n</think>\n\n"
                        row = run.finalize(record, row)
                    rows.append(row)
                jsonl(directory / "results.jsonl", rows)

            make_run("qwen", base / "results/qwen", correct_raw)
            # The primary has two valid successful calculations. The independent
            # replication asks in every legal calculation case and must score 0.
            make_run("deepseek", base / "results/deepseek", correct_raw, selected=(2, 3))
            make_run("deepseek", rep / "results/deepseek", [ask("agreed_due_total")] * 4)
            save(base / "comparison.json", {"primary_sentinel": "must remain unchanged"})
            primary_paths = [base / "results/deepseek/results.jsonl", base / "comparison.json"]
            before = {p: p.read_bytes() for p in primary_paths}
            registration = {"parent_freeze_sha256": sha(base / "freeze.json"),
                "adapter_sha256": sha(SOURCE / "replication/reproduce.py"),
                "primary_results_sha256": sha(primary_paths[0]), "inputs_sha256": sha(base / "data/test.inputs.jsonl"),
                "planned_cases": 6, "fixture": True}
            save(rep / "registration.json", registration)

            invoke("--prepare-review")
            packet = common.read_jsonl(rep / "review/blind.jsonl")
            save(rep / "review/semantic.json", {"packet_digest": reporting.digest(packet), "reviewer": {
                "kind": "independent_agent", "human_expert": False, "model_requested": "gpt-6.1-sol",
                "reasoning_effort_requested": "ultra"}, "cases": [{"review_id": r["review_id"],
                    "question_semantics_correct": True, "reason": "offline fixture judgment"} for r in packet]})
            invoke()
            invoke("--check")
            value = json.loads((rep / "comparison.json").read_text())
            assert value["backends"]["deepseek"]["assessment"]["all"]["planned"] == 6
            assert value["backends"]["deepseek"]["assessment"]["nonterminal"]["planned"] == 4
            for arm in ("guarded", "ungated"):
                assert value["backends"]["deepseek"]["assessment"]["all"]["arms"][arm]["legal_case_success"] == 0
                assert value["backends"]["qwen"]["assessment"]["all"]["arms"][arm]["legal_case_success"] == 2
            assert all(p.read_bytes() == value for p, value in before.items())

            # Binding and exact alias failures are exercised without reading any
            # project result file: every modified path below is in the temporary fixture.
            original = primary_paths[0].read_bytes()
            primary_paths[0].write_bytes(original + b"\n")
            rejected(lambda: invoke("--check"))
            primary_paths[0].write_bytes(original)
            bad = deepcopy(registration); bad["adapter_sha256"] = "0" * 64
            save(rep / "registration.json", bad)
            rejected(lambda: invoke("--check"))
            save(rep / "registration.json", registration)
            (rep / "results/qwen").unlink()
            (rep / "results/qwen").symlink_to(str(base / "results/qwen"), target_is_directory=True)
            rejected(lambda: invoke("--check"))
            print("PASS: frozen full reporting path, full planned denominator, separate raw runs, no success-row mixing, primary results/comparison unchanged, shared Qwen only, primary/adapter hash rejection, exact relative-alias rejection, comparison reproduction")


if __name__ == "__main__":
    main()
