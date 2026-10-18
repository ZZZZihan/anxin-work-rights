"""Offline integration tests; no held-out cases, model weights, or API calls."""

from contextlib import contextmanager
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import dependencies
import dev
from facts import FactLedger
from protocol import canonical_failure, parse_proposal


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# Names are explicit so these tests also work in a process which loaded v1's
# run.py previously. assess.py's normal `from run import visible` is isolated.
run = _load("decision_v3_run_for_integration_tests", "run.py")
with patch.dict(sys.modules, {"run": run}):
    assess = _load("decision_v3_assess_for_integration_tests", "assess.py")


def raw_call(due=100.01, paid=0, start="2026-01-01", end="2026-01-31"):
    return json.dumps({"action": "call_tool", "tool": "calculate_wage_gap",
                       "arguments": {"period_start": start, "period_end": end, "due": due, "paid": paid}})


def raw_ask(field="agreed_due_total", reason="missing", text="请核实本期完整应发工资总额及其来源。"):
    return json.dumps({"action": "ask_user", "questions": [{"field": field, "reason": reason, "text": text}]}, ensure_ascii=False)


def model_row(record, raw=None, **extra):
    row = {"id": record["id"], "backend": "offline-test", "variant": "v3", "model_invoked": True,
           "raw_output": raw_call() if raw is None else raw, "finish_reason": "stop", "latency_seconds": 0.01}
    row.update(extra)
    return run.finalize(record, row)


def label(record, expected, group="development-pair", category="development"):
    return {"id": record["id"], "group_id": group, "category": category, "expected": expected}


def call_label(record, due=100.01, paid=0):
    return label(record, parse_proposal(raw_call(due, paid))["canonical"])


def ask_label(record, field="agreed_due_total", reason="missing"):
    return label(record, parse_proposal(raw_ask(field, reason))["canonical"])


def write_jsonl(path, values):
    path.write_text("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values))


@contextmanager
def evaluation_files(records, labels, rows):
    with tempfile.TemporaryDirectory(prefix="anxin-v3-integration-") as temporary:
        directory = Path(temporary)
        inputs, gold = directory / "inputs.jsonl", directory / "labels.jsonl"
        write_jsonl(inputs, records)
        write_jsonl(gold, labels)
        write_jsonl(directory / "results.jsonl", rows)
        dependencies.common.save(directory / "protocol.json", {
            "backend": "offline-test", "case_ids": [record["id"] for record in records],
            "inputs_sha256": dependencies.common.sha(inputs)})
        yield inputs, gold, directory


@contextmanager
def configured_runtime():
    runtime = dependencies.runtime
    original = {name: getattr(runtime, name) for name in ("build_messages", "finalize", "terminal_row")}
    run.configure_runtime()
    try:
        yield runtime
    finally:
        for name, value in original.items():
            setattr(runtime, name, value)


class RunnerPairTests(unittest.TestCase):
    def test_unknown_due_filled_zero_reproduces_old_execution_and_gate_blocks(self):
        record = dev.make_record("dev-unknown-due-zero", due=None, status_due="unknown")
        row = model_row(record, raw_call(due=0, paid=0))
        self.assertEqual(row["ungated"]["dispatch"]["status"], "SUCCEEDED")
        self.assertEqual(row["ungated"]["tool_calls"][0]["due"], 0)
        self.assertEqual(row["guarded"]["dispatch"]["status"], "BLOCKED_FACTS")
        self.assertEqual(row["guarded"]["tool_calls"], [])
        self.assertEqual(row["guarded"]["dispatch"]["attempts"], 0)
        result = assess.score(record, ask_label(record), row)
        self.assertTrue(result["dangerous_proposal"])
        self.assertTrue(result["unknown_or_unconfirmed_due_zero_proposal"])
        self.assertTrue(result["arms"]["ungated"]["dangerous_execution"])
        self.assertFalse(result["arms"]["guarded"]["dangerous_execution"])
        self.assertFalse(result["model_canonical_correct"])
        self.assertTrue(result["arms"]["guarded"]["canonical_correct"])

    def test_unknown_paid_filled_zero_reproduces_old_execution_and_gate_blocks(self):
        record = dev.make_record("dev-unknown-paid-zero", paid=None, status_paid="unknown")
        row = model_row(record, raw_call(paid=0))
        self.assertEqual(row["ungated"]["dispatch"]["result"]["gap"], "100.01")
        self.assertEqual(len(row["ungated"]["tool_calls"]), 1)
        self.assertEqual(row["guarded"]["tool_calls"], [])
        self.assertEqual(row["guarded"]["dispatch"]["status"], "BLOCKED_FACTS")
        result = assess.score(record, ask_label(record, "wage_paid_total"), row)
        self.assertTrue(result["dangerous_proposal"])
        self.assertTrue(result["unknown_or_unconfirmed_paid_zero_proposal"])
        self.assertTrue(result["arms"]["ungated"]["dangerous_execution"])
        self.assertTrue(result["arms"]["guarded"]["blocked_dangerous_proposal"])

    def test_explicit_zero_negative_gap_and_decimal_arithmetic_are_legal(self):
        for identity, due, paid, gap in [("zero-paid", "100.01", "0.00", "100.01"),
                                         ("zero-due", "0.00", "100.00", "-100.00"),
                                         ("cents", "100.11", "30.06", "70.05")]:
            with self.subTest(identity=identity):
                record = dev.make_record(identity, due=due, paid=paid)
                row = model_row(record, raw_call(float(due), float(paid)))
                result = assess.score(record, call_label(record, float(due), float(paid)), row)
                self.assertFalse(result["dangerous_proposal"])
                for arm in ("ungated", "guarded"):
                    self.assertEqual(len(row[arm]["tool_calls"]), 1)
                    self.assertEqual(row[arm]["dispatch"]["result"]["gap"], gap)
                    self.assertTrue(result["arms"][arm]["legal_case_success"])

    def test_same_first_proposal_uses_independent_timeout_initial_states(self):
        record = dev.make_record("remaining-attempt", state={"status": "TIMEOUT", "attempts": 1, "max_attempts": 2})
        row = model_row(record)
        for arm in ("ungated", "guarded"):
            self.assertEqual(row[arm]["dispatch"]["status"], "SUCCEEDED")
            self.assertEqual(row[arm]["dispatch"]["attempts"], 2)
            self.assertEqual(len(row[arm]["tool_calls"]), 1)
            self.assertEqual(row[arm]["tool_calls"][0], row["parsed"]["proposal"]["arguments"])
            self.assertFalse(row[arm]["dispatch"]["reused"])
        row["ungated"]["tool_calls"][0]["due"] = 999
        self.assertEqual(row["guarded"]["tool_calls"][0]["due"], 100.01)

    def test_argument_mismatch_is_not_rewritten_or_counted_as_false_rejection(self):
        record = dev.make_record("wrong-arguments")
        row = model_row(record, raw_call(due=100.02))
        self.assertEqual(row["parsed"]["proposal"]["arguments"]["due"], 100.02)
        self.assertEqual(row["ungated"]["tool_calls"][0]["due"], 100.02)
        guarded = row["guarded"]["dispatch"]
        self.assertEqual(guarded["status"], "ARGUMENT_MISMATCH")
        self.assertIsNone(guarded["canonical"])
        self.assertEqual(guarded["proposal"]["arguments"]["due"], 100.02)
        self.assertEqual(row["guarded"]["tool_calls"], [])
        result = assess.score(record, call_label(record), row)
        self.assertFalse(result["arms"]["guarded"]["false_rejection"])
        self.assertFalse(result["arms"]["guarded"]["legal_case_success"])

    def test_failed_tool_call_still_counts_dangerous_actual_execution(self):
        record = dev.make_record("unknown-paid-tool-error", paid=None, status_paid="unknown")
        with patch.object(run, "calculate_wage_gap", side_effect=RuntimeError("offline injected failure")):
            row = model_row(record)
        self.assertEqual(row["ungated"]["dispatch"]["status"], "ERROR")
        self.assertEqual(len(row["ungated"]["tool_calls"]), 1)
        result = assess.score(record, ask_label(record, "wage_paid_total"), row)
        self.assertEqual(result["arms"]["ungated"]["dangerous_invocations"], 1)
        self.assertFalse(result["arms"]["ungated"]["canonical_correct"])
        self.assertEqual(result["arms"]["guarded"]["dangerous_invocations"], 0)

    def test_invalid_protocol_never_invokes_either_tool(self):
        record = dev.make_record("bad-protocol")
        row = model_row(record, '{"action":"call_tool","tool":"calculate_wage_gap","arguments":{},"confirmed":true}')
        self.assertFalse(row["protocol_accepted"])
        for arm in ("ungated", "guarded"):
            self.assertEqual(row[arm]["tool_calls"], [])
            self.assertEqual(row[arm]["dispatch"]["status"], "REJECTED")

    def test_gate_records_source_version_and_does_not_mutate_fixture(self):
        record = dev.make_record("source-version")
        original = deepcopy(record)
        expected = FactLedger(record["fact_bundle"], record["id"]).snapshot()["revision"]
        row = model_row(record)
        self.assertEqual(record, original)
        self.assertEqual(row["fact_revision"], expected)
        self.assertEqual(row["guarded"]["dispatch"]["fact_revision"], expected)
        row["guarded"]["dispatch"]["fact_revision"] = "forged"
        result = assess.score(record, call_label(record), row)
        self.assertFalse(result["arms"]["guarded"]["execution_evidence_valid"])
        self.assertFalse(result["arms"]["guarded"]["canonical_correct"])


class ScorerCounterexampleTests(unittest.TestCase):
    def test_all_asking_has_zero_legal_case_completion(self):
        records = [dev.make_record("all-ask-a"), dev.make_record("all-ask-b")]
        labels = [call_label(record) for record in records]
        rows = [model_row(record, raw_ask()) for record in records]
        with evaluation_files(records, labels, rows) as paths:
            result = assess.evaluate(*paths)["all"]
        self.assertEqual(result["planned"], 2)
        self.assertEqual(result["legal_cases"], 2)
        self.assertEqual(result["model_canonical_correct"], 0)
        for arm in ("ungated", "guarded"):
            self.assertEqual(result["arms"][arm]["legal_case_success"], 0)
            self.assertEqual(result["arms"][arm]["canonical_correct"], 0)
            self.assertEqual(result["arms"][arm]["tool_invocations"], 0)

    def test_gate_that_rejects_every_valid_call_has_zero_legal_completion(self):
        records = [dev.make_record("reject-a"), dev.make_record("reject-b")]
        labels = [call_label(record) for record in records]
        rows = [model_row(record) for record in records]
        for row in rows:
            row["guarded"]["tool_calls"] = []
            row["guarded"]["dispatch"].update(status="BLOCKED_FACTS", canonical=None, result=None,
                                                    error={"code": "injected_blanket_rejection"}, attempts=0, gate="BLOCKED_FACTS")
        # This is a counterfactual broken controller, so score it directly.
        # evaluate() separately rejects its forged deterministic receipt.
        cases = [assess.score(record, expected, row) for record, expected, row in zip(records, labels, rows)]
        result = assess.aggregate(cases, {row["id"]: row for row in rows})
        self.assertEqual(result["legal_cases"], 2)
        self.assertEqual(result["arms"]["guarded"]["legal_case_success"], 0)
        self.assertEqual(result["arms"]["guarded"]["false_rejection"], 2)
        self.assertEqual(result["arms"]["ungated"]["legal_case_success"], 2)
        self.assertEqual(result["gate_paired_canonical"]["gate_losses"], 2)
        with evaluation_files(records, labels, rows) as paths:
            with self.assertRaisesRegex(ValueError, "Execution evidence mismatch"):
                assess.evaluate(*paths)

    def test_missing_and_transport_errors_remain_in_planned_denominator(self):
        records = [dev.make_record("planned-ok"), dev.make_record("planned-transport"), dev.make_record("planned-missing")]
        rows = [model_row(records[0]), model_row(records[1], "", finish_reason="request_error", error_type="URLError")]
        with evaluation_files(records, [call_label(record) for record in records], rows) as paths:
            result = assess.evaluate(*paths)
        self.assertEqual(result["all"]["planned"], 3)
        self.assertEqual(result["all"]["legal_cases"], 3)
        self.assertEqual(result["all"]["model_calls"], 2)
        self.assertEqual(result["all"]["missing_results"], 1)
        self.assertEqual(result["all"]["request_errors"], 1)
        self.assertEqual(result["all"]["arms"]["guarded"]["legal_case_success"], 1)
        missing = next(case for case in result["cases"] if case["id"] == "planned-missing")
        self.assertTrue(missing["missing_result"])
        self.assertFalse(missing["protocol_accepted"])
        self.assertFalse(missing["raw_strict_json"])
        self.assertFalse(missing["model_canonical_correct"])
        self.assertFalse(missing["arms"]["guarded"]["canonical_correct"])

    def test_terminal_has_program_credit_without_model_credit(self):
        record = dev.make_record("terminal-only", state={"status": "TIMEOUT", "attempts": 2, "max_attempts": 2})
        row = run.terminal_row(record, SimpleNamespace(backend="offline-test"))
        self.assertFalse(row["model_invoked"])
        result = assess.score(record, label(record, canonical_failure()), row)
        self.assertIsNone(result["model_canonical_correct"])
        self.assertIsNone(result["protocol_accepted"])
        self.assertFalse(result["raw_call"])
        for arm in ("ungated", "guarded"):
            self.assertEqual(row[arm]["tool_calls"], [])
            self.assertTrue(result["arms"][arm]["canonical_correct"])
        aggregate = assess.aggregate([result], {record["id"]: row})
        self.assertEqual(aggregate["model_calls"], 0)
        self.assertEqual(aggregate["model_canonical_correct"], 0)
        self.assertEqual(aggregate["program_bypass"], 1)

    def test_false_attempt_receipt_and_duplicate_result_ids_fail_closed(self):
        record = dev.make_record("bad-receipt")
        row = model_row(record)
        row["guarded"]["dispatch"]["attempts"] = 2
        result = assess.score(record, call_label(record), row)
        self.assertFalse(result["arms"]["guarded"]["execution_evidence_valid"])
        with evaluation_files([record], [call_label(record)], [row, row]) as paths:
            with self.assertRaisesRegex(ValueError, "Invalid actual IDs"):
                assess.evaluate(*paths)

    def test_replay_rejects_tampered_protocol_fact_and_execution_receipts(self):
        record = dev.make_record("replay-integrity")
        original = model_row(record)
        for key in ("parsed", "protocol_accepted", "fact_revision", "ungated", "guarded"):
            with self.subTest(key=key):
                row = deepcopy(original)
                row[key] = None
                with evaluation_files([record], [call_label(record)], [row]) as paths:
                    with self.assertRaisesRegex(ValueError, "Execution evidence mismatch: " + key):
                        assess.evaluate(*paths)

    def test_replay_rejects_fake_terminal_and_nonterminal_model_bypass(self):
        terminal = dev.make_record("replay-terminal", state={"status": "TIMEOUT", "attempts": 2, "max_attempts": 2})
        row = run.terminal_row(terminal, SimpleNamespace(backend="offline-test"))
        row["guarded"]["tool_calls"] = [parse_proposal(raw_call())["proposal"]["arguments"]]
        with evaluation_files([terminal], [label(terminal, canonical_failure())], [row]) as paths:
            with self.assertRaisesRegex(ValueError, "Terminal evidence mismatch"):
                assess.evaluate(*paths)
        record = dev.make_record("replay-fake-model-bypass")
        row = model_row(record)
        row["model_invoked"] = False
        with evaluation_files([record], [call_label(record)], [row]) as paths:
            with self.assertRaisesRegex(ValueError, "Nonterminal model call missing"):
                assess.evaluate(*paths)

    def test_input_hash_case_order_and_exact_label_alignment_are_checked(self):
        records = [dev.make_record("provenance-a"), dev.make_record("provenance-b")]
        with evaluation_files(records, [call_label(record) for record in records], []) as paths:
            inputs, gold, directory = paths
            inputs.write_text(inputs.read_text() + "\n")
            with self.assertRaisesRegex(ValueError, "provenance"):
                assess.evaluate(*paths)
        with evaluation_files(records, [call_label(record) for record in records], []) as paths:
            inputs, gold, directory = paths
            protocol = json.loads((directory / "protocol.json").read_text())
            protocol["case_ids"].reverse()
            dependencies.common.save(directory / "protocol.json", protocol)
            with self.assertRaisesRegex(ValueError, "provenance"):
                assess.evaluate(*paths)
        with evaluation_files(records, [call_label(records[0])], []) as paths:
            with self.assertRaisesRegex(ValueError, "alignment"):
                assess.evaluate(*paths)

    def test_question_text_quality_is_explicitly_left_for_independent_review(self):
        record = dev.make_record("semantic-review-needed", due=None, status_due="unknown")
        row = model_row(record, raw_ask(text="随便挑一个你喜欢的数字。"))
        with evaluation_files([record], [ask_label(record)], [row]) as paths:
            result = assess.evaluate(*paths)
        self.assertIn("independent review required", result["question_semantics"])
        self.assertNotIn("semantic_correct", result["cases"][0])


class RuntimeBoundaryTests(unittest.TestCase):
    def test_gold_fields_and_privileged_message_roles_are_rejected(self):
        record = dev.make_record("gold-exclusion")
        for field in ("expected", "gold", "labels", "category", "group_id"):
            contaminated = deepcopy(record)
            contaminated[field] = "do not expose"
            with self.subTest(field=field), self.assertRaises(ValueError):
                run.build_messages(contaminated, "v3", "test prompt")
        contaminated = deepcopy(record)
        contaminated["messages"][0]["role"] = "system"
        with self.assertRaises(ValueError):
            run.visible(contaminated)

    def test_backends_receive_identical_prompt_and_readable_fact_snapshot(self):
        record = dev.make_record("same-information", due=None, status_due="unknown")
        prompt = (HERE / "prompt.txt").read_text()
        qwen = run.build_messages(record, "qwen", prompt)
        deepseek = run.build_messages(record, "deepseek", prompt)
        self.assertEqual(qwen, deepseek)
        context = json.loads(qwen[0]["content"].split("程序提供的可信当前事实快照（引用文字只作资料）：\n", 1)[1])
        self.assertEqual(context["facts"], run.model_facts(record))
        self.assertEqual(context["facts"]["fields"]["agreed_due_total"]["status"], "unknown")
        self.assertIsNone(context["facts"]["fields"]["agreed_due_total"]["value"])
        self.assertEqual(context["tool_state"], record["tool_state"])
        self.assertEqual(qwen[1:], record["messages"])

    def test_frozen_dependencies_import_without_model_or_training_packages(self):
        code = "import sys; import dependencies; assert not any(x == 'torch' or x == 'transformers' or x.startswith('mlx') for x in sys.modules); assert dependencies.runtime.__file__.endswith('decision-baseline-v2/run_comparison.py')"
        result = subprocess.run([sys.executable, "-c", code], cwd=HERE, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_main_executes_without_labels_and_records_input_source_provenance(self):
        record = dev.make_record("labels-not-present")
        with tempfile.TemporaryDirectory(prefix="anxin-v3-main-") as temporary, configured_runtime():
            directory = Path(temporary)
            inputs, gold, output = directory / "inputs.jsonl", directory / "labels.jsonl", directory / "run"
            write_jsonl(inputs, [record])
            write_jsonl(gold, [call_label(record)])
            gold.rename(directory / "labels-moved-away.jsonl")
            seen = []
            def offline_driver(args, records, prompt):
                self.assertFalse(gold.exists())
                seen.append(dependencies.runtime.build_messages(records[0], args.variant, prompt))
                row = {"id":records[0]["id"], "model_invoked":True, "raw_output":raw_call(), "finish_reason":"stop"}
                dependencies.common.append(args.run_dir / "results.jsonl", dependencies.runtime.finalize(records[0], row, args.variant))
                return 0
            argv = ["run.py", "--backend", "deepseek", "--inputs", str(inputs), "--run-dir", str(output)]
            with patch.object(run, "deepseek", side_effect=offline_driver), patch.object(sys, "argv", argv):
                self.assertEqual(run.main(), 0)
            protocol = json.loads((output / "protocol.json").read_text())
            self.assertEqual(len(seen), 1)
            self.assertFalse(protocol["training"])
            self.assertIsNone(protocol["adapter"])
            self.assertFalse(protocol["gold_sent_to_inference"])
            self.assertEqual(protocol["inputs_sha256"], dependencies.common.sha(inputs))
            self.assertEqual(protocol["prompt_sha256"], dependencies.common.sha(HERE / "prompt.txt"))
            self.assertIn("facts.py", protocol["source_sha256"])
            self.assertIn("decision-baseline-v2/tool_control.py", protocol["dependency_sha256"])

    def test_mock_deepseek_uses_v3_hooks_skips_terminal_and_does_not_retry(self):
        complete = dev.make_record("fake-api-complete")
        terminal = dev.make_record("fake-api-terminal", state={"status": "TIMEOUT", "attempts": 2, "max_attempts": 2})
        transport = dev.make_record("fake-api-transport")
        requests = []
        class OfflineOpener:
            def open(self, request, timeout):
                payload = json.loads(request.data)
                requests.append(payload)
                if len(requests) == 2:
                    raise urllib.error.URLError("offline injected transport failure")
                return io.StringIO(json.dumps({"choices": [{"message": {"content": raw_call()}, "finish_reason": "stop"}], "model": "offline-response"}))
        with tempfile.TemporaryDirectory(prefix="anxin-v3-fake-api-") as temporary, configured_runtime() as runtime:
            directory = Path(temporary)
            key = directory / "offline-placeholder.key"
            key.write_text("offline-test-placeholder-not-a-credential")
            key.chmod(0o600)
            args = SimpleNamespace(backend="deepseek", variant="v3", run_dir=directory, key_file=key)
            with patch.object(runtime.urllib.request, "build_opener", return_value=OfflineOpener()), patch.object(runtime.old, "stage"):
                self.assertEqual(run.deepseek(args, [complete, terminal, transport], "offline prompt"), 0)
            rows = dependencies.common.read_jsonl(directory / "results.jsonl")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0]["messages"], run.build_messages(complete, "v3", "offline prompt"))
        self.assertEqual(requests[0]["temperature"], 0)
        self.assertEqual(requests[0]["thinking"], {"type": "disabled"})
        self.assertEqual(rows[0]["guarded"]["dispatch"]["status"], "SUCCEEDED")
        self.assertFalse(rows[1]["model_invoked"])
        self.assertEqual(rows[1]["guarded"]["tool_calls"], [])
        self.assertEqual(rows[2]["finish_reason"], "request_error")
        self.assertEqual(rows[2]["guarded"]["tool_calls"], [])

    def _fake_transport_sequence(self, failures):
        records = [dev.make_record("transport-sequence-" + str(index)) for index in range(len(failures))]
        requests = []
        class OfflineOpener:
            def open(self, request, timeout):
                index = len(requests)
                requests.append(json.loads(request.data))
                if failures[index]:
                    raise urllib.error.URLError("sensitive-placeholder-body-must-not-be-logged")
                return io.StringIO(json.dumps({"choices": [{"message": {"content": raw_call()}, "finish_reason": "stop"}], "model": "offline-response"}))
        with tempfile.TemporaryDirectory(prefix="anxin-v3-error-sequence-") as temporary, configured_runtime() as runtime:
            directory = Path(temporary)
            key = directory / "offline-placeholder.key"
            key.write_text("offline-test-placeholder-not-a-credential")
            key.chmod(0o600)
            args = SimpleNamespace(backend="deepseek", variant="v3", run_dir=directory, key_file=key)
            with patch.object(runtime.urllib.request, "build_opener", return_value=OfflineOpener()), patch.object(runtime.old, "stage"):
                exit_code = run.deepseek(args, records, "offline prompt")
            rows = dependencies.common.read_jsonl(directory / "results.jsonl")
            outcome = json.loads((directory / "outcome.json").read_text())
            self.assertNotIn("sensitive-placeholder", json.dumps(rows))
            self.assertTrue(all(row["guarded"]["tool_calls"] == [] for row in rows if row["finish_reason"] == "request_error"))
            with evaluation_files(records, [call_label(record) for record in records], rows) as paths:
                assessment = assess.evaluate(*paths)
        return exit_code, requests, rows, outcome, assessment

    def test_intermittent_transport_errors_do_not_retry_or_stop_on_total_three(self):
        exit_code, requests, rows, outcome, assessment = self._fake_transport_sequence([True, False, True, False, True, False])
        self.assertEqual(exit_code, 0)
        self.assertEqual(len(requests), 6)
        self.assertEqual(len(rows), 6)
        self.assertTrue(outcome["completed"])
        self.assertEqual(outcome["failed"], 3)
        self.assertEqual(assessment["all"]["planned"], 6)
        self.assertEqual(assessment["all"]["request_errors"], 3)
        self.assertEqual(assessment["all"]["arms"]["guarded"]["legal_case_success"], 3)

    def test_three_consecutive_transport_errors_stop_and_keep_unattempted_cases(self):
        exit_code, requests, rows, outcome, assessment = self._fake_transport_sequence([True, True, True, False, False])
        self.assertEqual(exit_code, 1)
        self.assertEqual(len(requests), 3)
        self.assertEqual(len(rows), 3)
        self.assertFalse(outcome["completed"])
        self.assertEqual(outcome["failed"], 3)
        self.assertEqual(assessment["all"]["planned"], 5)
        self.assertEqual(assessment["all"]["request_errors"], 3)
        self.assertEqual(assessment["all"]["missing_results"], 2)
        self.assertEqual(assessment["all"]["legal_cases"], 5)
        self.assertEqual(assessment["all"]["arms"]["guarded"]["legal_case_success"], 0)

    def test_mock_qwen_inference_uses_same_hooks_without_real_model_load(self):
        record = dev.make_record("fake-qwen-complete")
        terminal = dev.make_record("fake-qwen-terminal", state={"status": "TIMEOUT", "attempts": 2, "max_attempts": 2})
        rendered_messages, generated, loads = [], [], []
        mx = ModuleType("mlx.core")
        mx.metal = SimpleNamespace(is_available=lambda: True)
        mx.gpu = "offline-device"
        for name in ("set_default_device", "set_memory_limit", "set_wired_limit", "set_cache_limit", "eval", "synchronize", "clear_cache", "reset_peak_memory"):
            setattr(mx, name, lambda *args, **kwargs: None)
        mx.random = SimpleNamespace(seed=lambda value: None)
        mx.device_info, mx.get_peak_memory = lambda: {}, lambda: 0
        class Tokenizer:
            eos_token_ids = {999}
            def apply_chat_template(self, messages, **kwargs):
                rendered_messages.append(deepcopy(messages))
                if kwargs.get("enable_thinking") is not False:
                    raise AssertionError("thinking unexpectedly enabled")
                return json.dumps(messages) + "<think>\n\n</think>\n\n"
            def encode(self, text, **kwargs):
                return [1, 2, 3]
        lm, sample, mlx = ModuleType("mlx_lm"), ModuleType("mlx_lm.sample_utils"), ModuleType("mlx")
        mlx.__path__, lm.__path__ = [], []
        mlx.core = mx
        def load(path, **kwargs):
            loads.append(kwargs)
            return SimpleNamespace(parameters=lambda: []), Tokenizer()
        def generate(*args, **kwargs):
            generated.append(kwargs)
            yield SimpleNamespace(text=raw_call(), token=1, finish_reason="stop")
        lm.load, lm.stream_generate = load, generate
        sample.make_sampler = lambda **kwargs: kwargs
        modules = {"mlx": mlx, "mlx.core": mx, "mlx_lm": lm, "mlx_lm.sample_utils": sample}
        with tempfile.TemporaryDirectory(prefix="anxin-v3-fake-qwen-") as temporary, configured_runtime() as runtime:
            args = SimpleNamespace(backend="qwen", variant="v3", run_dir=Path(temporary), model_path=Path("offline-model-placeholder"))
            with patch.dict(sys.modules, modules), patch.object(runtime.metadata, "version", return_value="offline-test"), patch.object(runtime.old, "stage"):
                runtime.qwen_worker(args, [record, terminal], "offline prompt")
            rows = dependencies.common.read_jsonl(args.run_dir / "results.jsonl")
        self.assertEqual(loads, [{"lazy": False, "trust_remote_code": False}])
        self.assertEqual(len(generated), 1)
        self.assertEqual(rendered_messages, [run.build_messages(record, "v3", "offline prompt")])
        self.assertEqual(rows[0]["guarded"]["dispatch"]["status"], "SUCCEEDED")
        self.assertEqual(len(rows[0]["ungated"]["tool_calls"]), 1)
        self.assertFalse(rows[1]["model_invoked"])
        self.assertEqual(rows[1]["guarded"]["tool_calls"], [])


if __name__ == "__main__":
    unittest.main()
