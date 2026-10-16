"""Scoring boundary tests using only small, hand-written temporary fixtures."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import assess
import run_comparison as runner


ARGS = {"period_start": "2026-04-03", "period_end": "2026-04-12", "due": 80.25, "paid": 0.10}
CALL_CANONICAL = {"missing": [], "conflicts": [], "next_action": {
    "type": "call_tool", "questions": [], "tool": "calculate_wage_gap", "arguments": ARGS}}
FAILURE_CANONICAL = {"missing": [], "conflicts": [], "next_action": {
    "type": "report_tool_failure", "questions": [], "tool": None, "arguments": None}}
ASK_CANONICAL = {"missing": ["period"], "conflicts": [], "next_action": {
    "type": "ask_user", "questions": [{"field": "period", "text": "请提供对应期间的起止日期和年份。"}],
    "tool": None, "arguments": None}}
CALL_RAW = json.dumps({"action": "call_tool", "tool": "calculate_wage_gap", "arguments": ARGS})


def record(case_id="manual", terminal=False):
    return {"id": case_id, "messages": [{"role": "user", "content": "这是评分单元测试的手写对话。"}],
            "tool_state": {"status": "TIMEOUT", "attempts": 2, "max_attempts": 2} if terminal else None}


def label(case_id="manual", expected=None, group="manual-group"):
    return {"id": case_id, "group_id": group, "category": "handwritten",
            "expected": deepcopy(CALL_CANONICAL if expected is None else expected)}


def successful(case_id="manual", variant="v2"):
    row = {"id": case_id, "model_invoked": True, "raw_output": CALL_RAW if variant == "v2" else json.dumps(CALL_CANONICAL),
           "finish_reason": "stop", "latency_seconds": 1.0}
    return runner.finalize(record(case_id), row, variant)


class AssessmentTests(unittest.TestCase):
    def run_fixture(self, records, labels, results=None, variant="v2", protocol_changes=None):
        directory = tempfile.TemporaryDirectory(prefix="anxin-assess-unit-")
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        inputs_path, labels_path = root / "inputs.jsonl", root / "labels.jsonl"
        def write_jsonl(path, values):
            path.write_text("".join(json.dumps(value, ensure_ascii=False) + "\n" for value in values))
        write_jsonl(inputs_path, records)
        write_jsonl(labels_path, labels)
        protocol = {"backend": "offline-test", "variant": variant,
                    "case_ids": [item["id"] for item in records],
                    "inputs_sha256": hashlib.sha256(inputs_path.read_bytes()).hexdigest()}
        protocol.update(protocol_changes or {})
        (root / "protocol.json").write_text(json.dumps(protocol))
        if results is not None:
            write_jsonl(root / "results.jsonl", results)
        return assess.evaluate(inputs_path, labels_path, root)

    def test_network_failure_and_missing_result_stay_in_planned_denominator(self):
        records = [record("ok"), record("transport"), record("missing")]
        labels = [label(item["id"]) for item in records]
        failed = {"id": "transport", "model_invoked": True, "raw_output": "", "finish_reason": "request_error",
                  "latency_seconds": 0.25, "dispatch": {"status": "REJECTED"}}
        report = self.run_fixture(records, labels, [successful("ok"), failed])
        totals = report["all"]
        self.assertEqual(3, totals["planned"])
        self.assertEqual(2, totals["model_calls"])
        self.assertEqual(1, totals["missing_results"])
        self.assertEqual(1, totals["request_errors"])
        self.assertEqual(1, totals["canonical_correct"])
        self.assertEqual(3, totals["by_category"]["handwritten"]["total"])
        self.assertEqual(0, totals["program_bypass"])
        self.assertEqual(1.25, totals["model_latency_seconds"]["sum"])
        cases = {case["id"]: case for case in report["cases"]}
        self.assertFalse(cases["missing"]["canonical_correct"])
        self.assertTrue(cases["missing"]["missing_result"])
        self.assertFalse(cases["transport"]["missing_result"])
        self.assertFalse(cases["transport"]["canonical_correct"])

    def test_missing_results_file_keeps_all_planned_cases(self):
        for variant in ("v1", "v2"):
            with self.subTest(variant=variant):
                report = self.run_fixture([record("a"), record("b")], [label("a"), label("b")], variant=variant)
                self.assertEqual(2, report["all"]["planned"])
                self.assertEqual(2, report["all"]["missing_results"])
                self.assertEqual(0, report["all"]["canonical_correct"])
                self.assertEqual(0, report["all"]["program_bypass"])

    def test_exhausted_program_decision_is_system_credit_not_model_credit(self):
        terminal = {"id": "terminal", "model_invoked": False, "raw_output": "", "finish_reason": "program_terminal",
                    "canonical_output": FAILURE_CANONICAL, "latency_seconds": 0.0}
        report = self.run_fixture([record("terminal", True)], [label("terminal", FAILURE_CANONICAL)], [terminal])
        case, totals = report["cases"][0], report["all"]
        self.assertTrue(case["canonical_correct"])
        self.assertFalse(case["model_invoked"])
        self.assertIsNone(case["protocol_accepted"])
        self.assertIsNone(case["raw_strict_json"])
        self.assertIsNone(case["raw_action_fields_correct"])
        self.assertTrue(case["system_action_fields_correct"])
        self.assertEqual(1, totals["canonical_correct"])
        self.assertEqual(1, totals["program_bypass"])
        self.assertEqual(0, totals["model_calls"])
        self.assertEqual(0, totals["protocol_accepted"])
        self.assertEqual(0, totals["raw_action_fields_correct"])
        self.assertEqual(1, totals["system_action_fields_correct"])
        self.assertEqual(0, report["nonterminal"]["planned"])
        self.assertEqual(1, report["terminal"]["planned"])

    def test_wrong_terminal_program_output_is_not_credited(self):
        result = {"id": "manual", "model_invoked": False, "raw_output": "", "canonical_output": CALL_CANONICAL}
        score = assess.score_case(label(expected=FAILURE_CANONICAL), result, record(terminal=True), "v2")
        self.assertFalse(score["canonical_correct"])
        self.assertFalse(score["execution_ok"])

    def test_dispatch_failure_cannot_become_canonical_success(self):
        for status in ("TIMEOUT", "ERROR", "REJECTED", "IN_PROGRESS", "EXHAUSTED", None):
            with self.subTest(status=status):
                result = successful()
                result["dispatch"] = {"status": status}
                score = assess.score_case(label(), result, record(), "v2")
                self.assertTrue(score["decision_contract_correct"])
                self.assertTrue(score["protocol_accepted"])
                self.assertTrue(score["raw_action_fields_correct"])
                self.assertFalse(score["execution_ok"])
                self.assertFalse(score["canonical_correct"])

    def test_successful_canonical_call_requires_successful_dispatch(self):
        score = assess.score_case(label(), successful(), record(), "v2")
        self.assertTrue(score["canonical_correct"])
        self.assertTrue(score["execution_ok"])
        self.assertTrue(score["raw_strict_json"])

    def test_forged_success_status_with_wrong_result_or_attempt_receipt_is_rejected(self):
        alterations = [
            {"result": {"period_start": ARGS["period_start"], "period_end": ARGS["period_end"],
                        "due": "80.25", "paid": "0.10", "gap": "80.16"}},
            {"result": None}, {"attempts": 0}, {"attempts": True}, {"attempts": 2},
            {"max_attempts": 3}, {"reused": True}, {"error": {"code": "tool_error"}},
            {"canonical": FAILURE_CANONICAL},
        ]
        for alteration in alterations:
            with self.subTest(alteration=alteration):
                result = successful()
                result["dispatch"].update(alteration)
                score = assess.score_case(label(), result, record(), "v2")
                self.assertTrue(score["decision_contract_correct"])
                self.assertFalse(score["execution_ok"])
                self.assertFalse(score["canonical_correct"])

    def test_v1_whole_fence_is_legacy_contract_valid_but_not_uniform_raw_json(self):
        result = successful(variant="v1")
        result["raw_output"] = "```json\n" + result["raw_output"] + "\n```"
        score = assess.score_case(label(), result, record(), "v1")
        self.assertTrue(score["contract_valid"])
        self.assertTrue(score["protocol_accepted"])
        self.assertTrue(score["canonical_correct"])
        self.assertFalse(score["legacy_parser_strict_json"])
        self.assertFalse(score["raw_strict_json"])

    def test_v2_whole_fence_has_the_same_uniform_raw_json_penalty(self):
        result = successful()
        result["raw_output"] = "```json\n" + CALL_RAW + "\n```"
        score = assess.score_case(label(), result, record(), "v2")
        self.assertTrue(score["protocol_accepted"])
        self.assertTrue(score["canonical_correct"])
        self.assertFalse(score["raw_strict_json"])
        self.assertIsNone(score["legacy_parser_strict_json"])

    def test_uniform_raw_json_rejects_duplicate_keys_and_nonfinite_in_both_arms(self):
        for variant in ("v1", "v2"):
            valid = json.dumps(CALL_CANONICAL) if variant == "v1" else CALL_RAW
            duplicate = valid.replace('"due": 80.25', '"due": 0, "due": 80.25')
            escaped_duplicate = valid.replace('"due": 80.25', '"d\\u0075e": 0, "due": 80.25')
            for raw in (duplicate, escaped_duplicate, valid.replace("80.25", "NaN"),
                        valid.replace("80.25", "Infinity"), valid.replace("80.25", "-Infinity")):
                with self.subTest(variant=variant, raw=raw):
                    result = successful(variant=variant)
                    result["raw_output"] = raw
                    self.assertFalse(assess.neutral_json(raw))
                    self.assertFalse(assess.score_case(label(), result, record(), variant)["raw_strict_json"])
        self.assertTrue(assess.neutral_json('{"text":"NaN and Infinity inside quoted text"}'))

    def test_uniform_raw_syntax_handles_huge_numbers_without_numeric_conversion(self):
        for numeric_token in ("1e" + "9" * 200, "1e-" + "9" * 200, "7" * 6000):
            with self.subTest(numeric_token=numeric_token[:40]):
                self.assertTrue(assess.neutral_json('{"amount":' + numeric_token + '}'))
                # Raw syntax credit does not imply protocol acceptance: the v2
                # implementation's independent representation guard still applies.
                result = successful()
                result["raw_output"] = CALL_RAW.replace("80.25", numeric_token)
                score = assess.score_case(label(), result, record(), "v2")
                self.assertTrue(score["raw_strict_json"])
                self.assertFalse(score["protocol_accepted"])
                self.assertFalse(score["canonical_correct"])

    def test_diagnostic_ignores_reason_but_canonical_scoring_keeps_it(self):
        for reason in ("conflict", "unsupported_reason"):
            with self.subTest(reason=reason):
                row = {"id": "manual", "model_invoked": True, "raw_output": json.dumps({
                    "action": "ask_user", "questions": [{"field": "period", "reason": reason,
                    "text": "请提供对应期间的起止日期和年份。"}]})}
                result = runner.finalize(record(), row, "v2")
                score = assess.score_case(label(expected=ASK_CANONICAL), result, record(), "v2")
                self.assertTrue(score["raw_action_fields_correct"])
                self.assertFalse(score["decision_contract_correct"])
                self.assertFalse(score["canonical_correct"])
                self.assertEqual(reason == "conflict", score["protocol_accepted"])
                self.assertEqual(reason == "conflict", score["execution_ok"])

    def test_nonterminal_slice_counts_complete_pairs_separately_from_singletons(self):
        # Three complete pairs in the planned set. Cutting one terminal member
        # leaves two complete pairs plus one singleton in the nonterminal slice.
        records = [record("a1"), record("a2"), record("b1"), record("b2"), record("c1"), record("c2", True)]
        labels = [label(item["id"], FAILURE_CANONICAL if item["id"] == "c2" else None,
                        group=item["id"][0]) for item in records]
        results = [successful(item["id"]) for item in records[:-1]]
        results[3]["raw_output"] = "malformed response"
        results.append({"id": "c2", "model_invoked": False, "raw_output": "", "canonical_output": FAILURE_CANONICAL})
        report = self.run_fixture(records, labels, results)
        self.assertEqual(3, report["all"]["complete_pairs"])
        self.assertEqual(2, report["all"]["all_correct_complete_pairs"])
        self.assertEqual(0, report["all"]["singleton_groups"])
        self.assertEqual(5, report["nonterminal"]["planned"])
        self.assertEqual(2, report["nonterminal"]["complete_pairs"])
        self.assertEqual(1, report["nonterminal"]["all_correct_complete_pairs"])
        self.assertEqual(1, report["nonterminal"]["singleton_groups"])
        self.assertEqual(1, report["terminal"]["singleton_groups"])
        self.assertEqual(0, report["terminal"]["complete_pairs"])

    def test_duplicate_or_mismatched_input_label_and_result_ids_are_rejected(self):
        base_records = [record("a"), record("b")]
        base_labels = [label("a"), label("b")]
        base_results = [successful("a"), successful("b")]
        cases = [
            ([record("a"), record("a")], base_labels, base_results),
            (base_records, [label("a"), label("a")], base_results),
            (base_records, [label("a"), label("outside")], base_results),
            (base_records, base_labels, [successful("a"), successful("a")]),
            (base_records, base_labels, [successful("outside")]),
        ]
        for records, labels, results in cases:
            with self.subTest(records=[r["id"] for r in records], labels=[r["id"] for r in labels], results=[r["id"] for r in results]):
                with self.assertRaises(ValueError):
                    self.run_fixture(records, labels, results)

    def test_planned_subset_reordering_or_changed_input_hash_is_rejected(self):
        for changes in ({"case_ids": ["a"]}, {"case_ids": ["b", "a"]}, {"inputs_sha256": "0" * 64}):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    self.run_fixture([record("a"), record("b")], [label("a"), label("b")],
                                     [successful("a"), successful("b")], protocol_changes=changes)


if __name__ == "__main__":
    unittest.main()
