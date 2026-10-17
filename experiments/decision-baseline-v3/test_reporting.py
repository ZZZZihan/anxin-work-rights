"""Offline reporting/freeze regressions using public development fixtures only.

No fresh holdout, real prompt, stored model result, network, or model is read.
All files written by these tests belong to temporary fixture directories.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from dev import make_record
import freeze
import reporting
from run import build_messages


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path, values):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values), encoding="utf-8")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(kind):
    if kind == "ask_user":
        return {"missing": ["agreed_due_total"], "conflicts": [], "next_action": {
            "type": kind, "questions": [{"field": "agreed_due_total", "text": "请核实本期完整应付工资总额。"}],
            "tool": None, "arguments": None,
        }}
    if kind == "report_tool_failure":
        return {"missing": [], "conflicts": [], "next_action": {
            "type": kind, "questions": [], "tool": None, "arguments": None,
        }}
    return {"missing": [], "conflicts": [], "next_action": {
        "type": "call_tool", "questions": [], "tool": "calculate_wage_gap",
        "arguments": {"period_start": "2026-01-01", "period_end": "2026-01-31", "due": 100.01, "paid": 0.0},
    }}


def fixture_rows(mode="success", pure_terminal=False):
    """Invent six records; never reuse IDs/text/values from the fresh holdout."""
    records, gold, rows, cases = {}, {}, {}, []
    count = 2 if pure_terminal else 6
    for index in range(count):
        terminal = pure_terminal or index >= 4
        ask = not terminal and index < 2
        ident = f"reporting-dev-{index}"
        state = {"status": "TIMEOUT", "attempts": 2, "max_attempts": 2} if terminal else None
        record = make_record(identity=ident, status_due="candidate" if ask else "confirmed", state=state)
        kind = "report_tool_failure" if terminal else "ask_user" if ask else "call_tool"
        expected = canonical(kind)
        label = {"id": ident, "group_id": f"reporting-group-{index // 2}", "category": "fixture", "expected": expected}
        records[ident], gold[ident] = record, label
        correct = terminal or mode == "success"
        cases.append({
            "id": ident, "group_id": label["group_id"], "terminal": terminal, "category": "fixture",
            "model_canonical_correct": False if terminal else correct,
            "arms": {arm: {"canonical_correct": correct} for arm in ("ungated", "guarded")},
        })
        if mode == "missing" and not terminal:
            continue
        actual = expected if correct else None
        rows[ident] = {
            "id": ident, "model_invoked": not terminal,
            "finish_reason": "program_terminal" if terminal else "request_error" if mode == "failure" else "stop",
            "parsed": {"canonical": actual},
            "ungated": {"dispatch": {"canonical": actual}},
            "guarded": {"dispatch": {"canonical": actual}},
            "usage": None if terminal else {"prompt_tokens": 9, "completion_tokens": 4},
        }
    return records, gold, rows, cases


class FrozenFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="anxin-v3-reporting-test-")
        self.addCleanup(temporary.cleanup)
        self.outer = Path(temporary.name)
        self.root, self.v1, self.v2 = [self.outer / name for name in ("decision-baseline-v3", "decision-baseline-v1", "decision-baseline-v2")]
        for directory in (self.root, self.v1, self.v2):
            directory.mkdir()
        for directory in (self.v1, self.v2):
            (directory / "fixture.py").write_text("# offline dependency fixture\n")
            write_json(directory / "freeze.json", {"fixture": True})
        (self.root / "fixture.py").write_text("# offline source marker\n")
        self.prompt_text = "这是专用离线开发夹具提示，不是真实模型提示词。\n"
        (self.root / "prompt.txt").write_text(self.prompt_text)
        for name in ("CONTRACT.md", "METRICS.md", "DEVELOPMENT.md"):
            (self.root / name).write_text("Offline fixture only.\n")
        self.records, self.gold, _, _ = fixture_rows()
        write_jsonl(self.root / "data/test.inputs.jsonl", self.records.values())
        write_jsonl(self.root / "data/test.labels.jsonl", self.gold.values())
        patcher = patch.multiple(freeze, ROOT=self.root, V1=self.v1, V2=self.v2)
        patcher.start(); self.addCleanup(patcher.stop)
        self.seal()

    def seal(self):
        self.manifest = {
            "source_sha256": freeze.sources(),
            "data_sha256": {p.name: sha(p) for p in sorted((self.root / "data").iterdir()) if p.is_file()},
        }
        write_json(self.root / "freeze.json", self.manifest)

    def make_run(self, backend="qwen"):
        directory = self.root / "results" / backend
        directory.mkdir(parents=True, exist_ok=True)
        protocol = {
            "backend": backend,
            "source_sha256": {q.name: sha(q) for q in sorted(self.root.glob("*.py"))},
            "dependency_sha256": {str(q.relative_to(self.root.parent)): sha(q) for d in (self.v1, self.v2) for q in sorted(d.glob("*.py"))},
            "prompt_sha256": sha(self.root / "prompt.txt"),
            "inputs_sha256": sha(self.root / "data/test.inputs.jsonl"),
            "training": False, "adapter": None, "gold_sent_to_inference": False,
            "case_ids": list(self.records),
        }
        write_json(directory / "protocol.json", protocol)
        write_json(directory / "inputs-visible.json", list(self.records.values()))
        rows = [{"id": record["id"], "backend": backend, "model_invoked": record["tool_state"] is None,
                 "request_messages": build_messages(record, "v3", self.prompt_text) if record["tool_state"] is None else None}
                for record in self.records.values()]
        if backend == "qwen":
            for row in rows:
                if row["model_invoked"]:
                    row["rendered_prompt"] = "".join("<|im_start|>" + m["role"] + "\n" + m["content"] + "<|im_end|>\n" for m in row["request_messages"]) + "<|im_start|>assistant\n<think>\n\n</think>\n\n"
        write_jsonl(directory / "results.jsonl", rows)
        write_json(directory / "outcome.json", {"completed": True, "fixture": True})
        return directory

    def mutate_json(self, path, fn):
        value = json.loads(path.read_text())
        fn(value)
        write_json(path, value)


class FreezeTests(FrozenFixture):
    def test_inventory_binds_current_sources_dependencies_and_both_data_files(self):
        self.assertEqual(freeze.verify(), self.manifest)
        for path in (self.root / "fixture.py", self.v1 / "fixture.py", self.v2 / "freeze.json",
                     self.root / "data/test.inputs.jsonl", self.root / "data/test.labels.jsonl"):
            with self.subTest(path=path.name):
                original = path.read_bytes()
                try:
                    path.write_bytes(original + b"\n")
                    with self.assertRaises(ValueError):
                        freeze.verify()
                finally:
                    path.write_bytes(original)

    def test_added_or_removed_source_and_data_inventory_is_rejected(self):
        for name in ("unexpected.py", "data/unexpected.json"):
            path = self.root / name
            path.write_text("{}\n")
            with self.assertRaises(ValueError):
                freeze.verify()
            path.unlink()
        path = self.root / "data/test.labels.jsonl"
        original = path.read_bytes(); path.unlink()
        with self.assertRaises(ValueError):
            freeze.verify()
        path.write_bytes(original)

    def test_verify_run_accepts_fixture_and_rejects_source_and_input_provenance_drift(self):
        directory = self.make_run()
        self.assertEqual(freeze.verify_run(directory)["case_ids"], list(self.records))
        path = directory / "protocol.json"
        original = path.read_bytes()
        mutations = (
            lambda p: p["source_sha256"].update({"fixture.py": "0" * 64}),
            lambda p: p["dependency_sha256"].update({"decision-baseline-v1/fixture.py": "0" * 64}),
            lambda p: p.update(inputs_sha256="0" * 64),
            lambda p: p.update(prompt_sha256="0" * 64),
            lambda p: p.update(training=True),
            lambda p: p.update(adapter="unapproved-adapter"),
            lambda p: p.update(gold_sent_to_inference=True),
            lambda p: p.update(case_ids=list(reversed(p["case_ids"]))),
        )
        for index, mutation in enumerate(mutations):
            with self.subTest(mutation=index):
                path.write_bytes(original); self.mutate_json(path, mutation)
                with self.assertRaises(ValueError):
                    freeze.verify_run(directory)
        path.write_bytes(original)

    def test_visible_snapshot_and_exact_actual_request_messages_are_bound(self):
        directory = self.make_run()
        snapshot = directory / "inputs-visible.json"
        original = snapshot.read_bytes()
        self.mutate_json(snapshot, lambda rows: rows[0]["messages"][0].update(content="改写的开发消息"))
        with self.assertRaises(ValueError):
            freeze.verify_run(directory)
        snapshot.write_bytes(original)
        results = directory / "results.jsonl"
        rows = [json.loads(line) for line in results.read_text().splitlines()]
        rows[0]["request_messages"][0]["content"] += " 额外内容"
        write_jsonl(results, rows)
        with self.assertRaises(ValueError):
            freeze.verify_run(directory)

    def test_result_backend_mismatch_is_rejected(self):
        directory = self.make_run()
        path = directory / "results.jsonl"
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        rows[0]["backend"] = "deepseek"
        write_jsonl(path, rows)
        with self.assertRaises(ValueError):
            freeze.verify_run(directory)

    def test_qwen_chatml_prompt_is_exactly_bound_to_recorded_messages(self):
        directory = self.make_run()
        self.assertEqual(freeze.verify_run(directory)["backend"], "qwen")
        path = directory / "results.jsonl"
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        rows[0]["rendered_prompt"] += "unrecorded suffix"
        write_jsonl(path, rows)
        with self.assertRaises(ValueError):
            freeze.verify_run(directory)

    def test_real_context_verifies_frozen_sources_data_runs_and_identity_hashes(self):
        for backend in reporting.BACKENDS:
            self.make_run(backend)
        with patch.object(reporting, "ROOT", self.root), patch.object(reporting, "evaluate", return_value={"cases": []}) as scorer:
            records, labels, runs, identity = reporting.context()
        self.assertEqual(set(records), set(self.records))
        self.assertEqual(set(labels), set(self.gold))
        self.assertEqual(scorer.call_count, 2)
        self.assertEqual(identity["inputs_sha256"], sha(self.root / "data/test.inputs.jsonl"))
        self.assertEqual(identity["labels_sha256"], sha(self.root / "data/test.labels.jsonl"))
        self.assertEqual(identity["runs"]["qwen"]["results.jsonl"], sha(self.root / "results/qwen/results.jsonl"))
        (self.root / "fixture.py").write_text("# drift\n")
        with patch.object(reporting, "ROOT", self.root), patch.object(reporting, "evaluate") as scorer:
            with self.assertRaises(ValueError):
                reporting.context()
            scorer.assert_not_called()


class ReportingTests(FrozenFixture):
    def install_context(self, mode="success", pure_terminal=False):
        records, gold, rows, cases = fixture_rows(mode, pure_terminal)
        self.records, self.gold = records, gold
        write_jsonl(self.root / "data/test.inputs.jsonl", records.values())
        write_jsonl(self.root / "data/test.labels.jsonl", gold.values())
        self.seal()
        self.fixture_runs = {}
        for backend in reporting.BACKENDS:
            directory = self.make_run(backend)
            actual_rows = deepcopy(rows)
            for row in actual_rows.values():
                row["backend"] = backend
            write_jsonl(directory / "results.jsonl", actual_rows.values())
            self.fixture_runs[backend] = {
                "rows": actual_rows, "protocol": {"backend": backend},
                "assessment": {
                    "cases": deepcopy(cases),
                    "nonterminal": {"planned": sum(not c["terminal"] for c in cases),
                                    "missing_results": sum(not c["terminal"] for c in cases) if mode == "missing" else 0,
                                    "request_failures": sum(not c["terminal"] for c in cases) if mode == "failure" else 0},
                    "execution_audit": {"actual_tool_invocations": 2, "failed_after_invocation": 1, "unsafe_actual_executions": 1},
                },
            }

        def fixture_context():
            runs = deepcopy(self.fixture_runs)
            for backend, run in runs.items():
                directory = self.root / "results" / backend
                run["hashes"] = {name: sha(directory / name) for name in ("protocol.json", "results.jsonl", "inputs-visible.json", "outcome.json")}
            identity = {"inputs_sha256": sha(self.root / "data/test.inputs.jsonl"),
                        "labels_sha256": sha(self.root / "data/test.labels.jsonl"),
                        "freeze_sha256": sha(self.root / "freeze.json"),
                        "runs": {b: r["hashes"] for b, r in runs.items()}}
            return deepcopy(records), deepcopy(gold), runs, identity

        self.fixture_context = fixture_context
        root_patcher = patch.object(reporting, "ROOT", self.root)
        root_patcher.start(); self.addCleanup(root_patcher.stop)
        context_patcher = patch.object(reporting, "context", side_effect=fixture_context)
        context_patcher.start(); self.addCleanup(context_patcher.stop)
        return fixture_context()

    def review(self, judgment=True):
        packet, mapping = reporting.make_packet(*self.fixture_context(), salt="11" * 32)
        semantic = {"packet_digest": reporting.digest(packet), "reviewer": {
            "kind": "independent_agent", "human_expert": False,
            "model_requested": "gpt-6.1-sol", "reasoning_effort_requested": "ultra",
        }, "cases": [{"review_id": p["review_id"], "question_semantics_correct": judgment,
                       "reason": "仅供离线测试的模拟审查，不是真实专家意见。"} for p in packet]}
        write_jsonl(self.root / "review/blind.jsonl", packet)
        write_json(self.root / "review/mapping.json", mapping)
        write_json(self.root / "review/semantic.json", semantic)
        return packet, mapping, semantic

    def test_packet_is_anonymous_deduplicates_same_arm_outputs_and_covers_questions(self):
        context = self.install_context()
        packet, mapping = reporting.make_packet(*context, salt="22" * 32)
        self.assertEqual(len(packet), 4)  # two asking fixtures, two backends; equal arms share one review.
        for row in packet:
            self.assertEqual(set(row), {"review_id", "messages", "facts", "expected", "actual"})
            self.assertEqual(len(row["review_id"]), 24)
            self.assertNotIn("case_id", row["facts"])
            self.assertNotIn("revision", row["facts"])
        encoded = reporting.stable(packet)
        for forbidden in ("qwen", "deepseek", *self.records):
            self.assertNotIn(forbidden, encoded)
        self.assertTrue(all(set(target["arms"]) == set(reporting.ARMS) for target in mapping["cases"].values()))
        self.assertNotIn(mapping["private_salt"], encoded)
        self.assertEqual((packet, mapping), reporting.make_packet(*context, salt="22" * 32))
        changed, _ = reporting.make_packet(*context, salt="33" * 32)
        self.assertNotEqual({p["review_id"] for p in packet}, {p["review_id"] for p in changed})

    def test_anonymous_review_exact_coverage_duplicate_unknown_and_disclosure(self):
        self.install_context(); packet, mapping, semantic = self.review()
        self.assertEqual(set(reporting.validate_reviews(packet, mapping, semantic)), set(mapping["cases"]))
        mutations = (
            lambda d: d["cases"].pop(),
            lambda d: d["cases"].append(deepcopy(d["cases"][0])),
            lambda d: d["cases"][0].update(review_id="unknown-review-id"),
            lambda d: d.update(packet_digest="0" * 64),
            lambda d: d["reviewer"].update(human_expert=True),
            lambda d: d["reviewer"].update(model_requested="unspecified"),
            lambda d: d["reviewer"].update(reasoning_effort_requested="low"),
            lambda d: d["cases"][0].update(question_semantics_correct=1),
            lambda d: d["cases"][0].update(reason="  "),
        )
        for index, mutation in enumerate(mutations):
            with self.subTest(mutation=index):
                changed = deepcopy(semantic); mutation(changed)
                with self.assertRaises(ValueError):
                    reporting.validate_reviews(packet, mapping, changed)

    def test_semantic_failure_is_applied_to_every_shared_output_arm(self):
        self.install_context(); self.review(judgment=False)
        report = reporting.summarize()
        for backend in reporting.BACKENDS:
            asking = report["backends"][backend]["semantic_cases"][:2]
            self.assertTrue(all(row[arm] is False for row in asking for arm in reporting.ARMS))
            metrics = report["backends"][backend]["semantic_slices"]["nonterminal"]["semantics"]
            self.assertTrue(all(metrics[arm]["planned"] == 4 and metrics[arm]["correct"] == 2 for arm in reporting.ARMS))

    def test_changed_input_gold_run_artifact_packet_or_mapping_is_rejected(self):
        self.install_context(); self.review()
        paths = [self.root / "data/test.inputs.jsonl", self.root / "data/test.labels.jsonl",
                 self.root / "results/qwen/results.jsonl", self.root / "results/deepseek/protocol.json",
                 self.root / "results/qwen/inputs-visible.json", self.root / "results/qwen/outcome.json"]
        for path in paths:
            with self.subTest(path=path.name):
                original = path.read_bytes()
                try:
                    path.write_bytes(original + b"\n")
                    with self.assertRaises(ValueError):
                        reporting.summarize()
                finally:
                    path.write_bytes(original)
        for name in ("blind.jsonl", "mapping.json"):
            path = self.root / "review" / name
            original = path.read_bytes()
            try:
                if name == "blind.jsonl":
                    rows = [json.loads(line) for line in path.read_text().splitlines()]
                    rows[0]["actual"]["next_action"]["questions"][0]["text"] = "被改过的问题"
                    write_jsonl(path, rows)
                else:
                    self.mutate_json(path, lambda m: m["cases"][next(iter(m["cases"]))].update(arms=["model"]))
                with self.assertRaises(ValueError):
                    reporting.summarize()
            finally:
                path.write_bytes(original)

    def test_all_missing_nonterminal_results_keep_every_planned_failure(self):
        self.install_context(mode="missing"); self.review(judgment=False)
        report = reporting.summarize()
        for backend in reporting.BACKENDS:
            data = report["backends"][backend]
            model = data["semantic_slices"]["all"]["semantics"]["model"]
            self.assertEqual(model, {"correct": 0, "planned": 6, "applicable": 4, "not_applicable": 2, "rate": 0.0})
            nonterminal = data["semantic_slices"]["nonterminal"]
            self.assertTrue(all(nonterminal["semantics"][a]["planned"] == 4 and nonterminal["semantics"][a]["correct"] == 0 for a in reporting.ARMS))
            self.assertEqual(nonterminal["groups"]["model"]["planned"], 2)
            self.assertEqual(data["assessment"]["nonterminal"]["missing_results"], 4)
        self.assertTrue(all(v["ties"] == 4 for v in report["paired_nonterminal"].values()))

    def test_all_request_failures_and_actual_tool_invocations_remain_in_report(self):
        self.install_context(mode="failure"); self.review(judgment=False)
        report = reporting.summarize()
        for backend in reporting.BACKENDS:
            data = report["backends"][backend]
            model = data["semantic_slices"]["nonterminal"]["semantics"]["model"]
            self.assertEqual((model["correct"], model["planned"], model["applicable"], model["rate"]), (0, 4, 4, 0.0))
            self.assertEqual(data["assessment"]["nonterminal"]["request_failures"], 4)
            self.assertEqual(data["assessment"]["execution_audit"], {"actual_tool_invocations": 2, "failed_after_invocation": 1, "unsafe_actual_executions": 1})
            self.assertEqual(data["provider_usage"], {"prompt_tokens": 36, "completion_tokens": 16})

    def test_pure_program_terminal_model_and_group_scores_are_na(self):
        self.install_context(pure_terminal=True)
        packet, _, _ = self.review()
        self.assertEqual(packet, [])
        report = reporting.summarize()
        for backend in reporting.BACKENDS:
            data = report["backends"][backend]
            metrics = data["semantic_slices"]["terminal"]
            self.assertEqual(metrics["semantics"]["model"], {"correct": 0, "planned": 2, "applicable": 0, "not_applicable": 2, "rate": None})
            self.assertEqual(metrics["groups"]["model"], {"correct": 0, "planned": 1, "applicable": 0, "not_applicable": 1, "rate": None})
            self.assertTrue(all(row["model"] is None for row in data["semantic_cases"]))
            self.assertEqual(data["provider_usage"], {})
        self.assertTrue(all(v == {"qwen_wins": 0, "deepseek_wins": 0, "ties": 0} for v in report["paired_nonterminal"].values()))

    def test_metric_rejects_truthy_numbers_and_handles_empty_na(self):
        for values in ([1], [0], [float("inf")], ["false"]):
            with self.assertRaises(ValueError):
                reporting.metric(values)
        self.assertEqual(reporting.metric([]), {"correct": 0, "planned": 0, "applicable": 0, "not_applicable": 0, "rate": None})
        self.assertEqual(reporting.metric([False, None]), {"correct": 0, "planned": 2, "applicable": 1, "not_applicable": 1, "rate": 0.0})


class ImportAndCliTests(unittest.TestCase):
    def test_four_entrypoints_help_and_fresh_process_reporting_imports_v3(self):
        root = Path(__file__).resolve().parent
        for script in ("run.py", "assess.py", "reporting.py", "freeze.py"):
            with self.subTest(script=script):
                process = subprocess.run([sys.executable, str(root / script), "--help"], text=True, capture_output=True, timeout=20)
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertIn("usage:", process.stdout.lower())
        source = "import sys,inspect,json;sys.path.insert(0,sys.argv[1]);import reporting;print(json.dumps([inspect.getfile(reporting.evaluate),inspect.getfile(reporting.verify)]))"
        process = subprocess.run([sys.executable, "-c", source, str(root)], text=True, capture_output=True, timeout=20)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual([Path(p).resolve() for p in json.loads(process.stdout)], [root / "assess.py", root / "freeze.py"])


if __name__ == "__main__":
    unittest.main()
