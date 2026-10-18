import copy
import json
import unittest

from common import calculate, messages, parse_output, validate_output, visible
from evaluate import score


def output(kind="call_tool"):
    return {"missing": [], "conflicts": [], "next_action": {"type": kind, "questions": [],
        "tool": "calculate_wage_gap", "arguments": {"period_start": "2026-04-01",
        "period_end": "2026-04-30", "due": 9000, "paid": 4000}}}


class EvaluationTests(unittest.TestCase):
    def test_no_gold_fields_can_enter_inference(self):
        r = {"id": "x", "messages": [{"role": "user", "content": "known"}], "tool_state": None}
        self.assertEqual(len(messages(r, "system")), 2)
        with self.assertRaises(ValueError):
            visible(dict(r, expected=output()))

    def test_known_zero_not_missing(self):
        o = output()
        o["next_action"]["arguments"]["paid"] = 0
        self.assertTrue(validate_output(o))

    def test_nonfinite_and_boolean_are_not_money(self):
        for v in [float("nan"), float("inf"), True, None, -1]:
            o = output()
            o["next_action"]["arguments"]["due"] = v
            self.assertFalse(validate_output(o))

    def test_date_and_argument_validation(self):
        for v in ["2026-02-30", "2026-05-01", "20260401"]:
            o = output()
            o["next_action"]["arguments"]["period_start"] = v
            self.assertFalse(validate_output(o))

    def test_fence_recovery_is_not_strict_json(self):
        raw = "```json\n" + json.dumps(output()) + "\n```"
        parsed, strict = parse_output(raw)
        self.assertFalse(strict)
        self.assertTrue(validate_output(parsed))
        self.assertEqual(parse_output("answer: " + json.dumps(output())), (None, False))

    def test_decimal_and_negative_difference(self):
        self.assertEqual(calculate({"due": 100.1, "paid": 0.2}), "99.9")
        self.assertEqual(calculate({"due": 0, "paid": 50}), "-50")

    def test_wrong_money_is_not_correct_even_if_action_matches(self):
        gold = output()
        got = copy.deepcopy(gold)
        got["next_action"]["arguments"]["paid"] = 5000
        row = score({"id": "x", "group_id": "g", "category": "complete", "expected": gold},
                    {"raw_output": json.dumps(got)}, {"tool_state": None})
        self.assertTrue(row["action_correct"])
        self.assertFalse(row["decision_contract_correct"])
        self.assertIn("wrong_tool_arguments", row["failure_reasons"])

    def test_timeout_program_guard_blocks_valid_but_disallowed_call(self):
        gold = {"missing": [], "conflicts": [], "next_action": {"type": "report_tool_failure",
            "questions": [], "tool": None, "arguments": None}}
        row = score({"id": "x", "group_id": "g", "category": "tool_failure", "expected": gold},
                    {"raw_output": json.dumps(output())},
                    {"tool_state": {"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}})
        self.assertTrue(row["premature_tool_call"])
        self.assertTrue(row["tool_replay_blocked_by_retry_limit"])
        self.assertIsNone(row["tool_replay_result"])

    def test_missing_result_counts_as_failure(self):
        row = score({"id": "x", "group_id": "g", "category": "complete", "expected": output()},
                    {}, {"tool_state": None})
        self.assertFalse(row["decision_contract_correct"])


if __name__ == "__main__":
    unittest.main()
