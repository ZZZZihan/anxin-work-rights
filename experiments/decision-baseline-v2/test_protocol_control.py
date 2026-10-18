"""Synthetic protocol/controller checks; no model, training, or held-out files."""

from copy import deepcopy
from decimal import Decimal
import json
from threading import Event, Thread
import unittest
from unittest.mock import patch

from protocol import MAX_RAW_CHARS, canonical_failure, parse_proposal
from tool_control import ToolController, calculate_wage_gap, preflight


def call_raw(due="100.25", paid="0.29", start="2026-01-01", end="2026-01-31"):
    return ('{"action":"call_tool","tool":"calculate_wage_gap","arguments":'
            '{"period_start":' + json.dumps(start) + ',"period_end":' + json.dumps(end)
            + ',"due":' + due + ',"paid":' + paid + '}}')


def ask_raw():
    return json.dumps({"action": "ask_user", "questions": [
        {"field": "period", "reason": "missing", "text": "请提供含年份的起止日期。"},
        {"field": "wage_paid_total", "reason": "conflict", "text": "请核对这段期间的工资实收总额。"}]}, ensure_ascii=False)


class ProposalTests(unittest.TestCase):
    def test_call_proposal_and_exact_canonical_shape(self):
        parsed = parse_proposal(call_raw())
        self.assertTrue(parsed["accepted"])
        self.assertTrue(parsed["strict_json"])
        self.assertEqual([], parsed["normalization"])
        self.assertIsNone(parsed["error"])
        self.assertEqual(call_raw(), parsed["raw"])
        self.assertEqual({"missing": [], "conflicts": [], "next_action": {
            "type": "call_tool", "questions": [], "tool": "calculate_wage_gap",
            "arguments": {"period_start": "2026-01-01", "period_end": "2026-01-31", "due": 100.25, "paid": 0.29}}},
            parsed["canonical"])
        json.dumps(parsed, allow_nan=False)

    def test_ask_canonical_derived_only_from_explicit_reasons(self):
        parsed = parse_proposal(ask_raw())
        self.assertTrue(parsed["accepted"])
        self.assertEqual(["period"], parsed["canonical"]["missing"])
        self.assertEqual(["wage_paid_total"], parsed["canonical"]["conflicts"])
        self.assertEqual("请核对这段期间的工资实收总额。", parsed["canonical"]["next_action"]["questions"][1]["text"])
        self.assertIsNone(parsed["canonical"]["next_action"]["tool"])

    def test_complete_fence_only_and_logged(self):
        for fence in ("```json\n", "```\n", " \n```json\r\n"):
            with self.subTest(fence=fence):
                raw = fence + call_raw() + "\n``` \n"
                parsed = parse_proposal(raw)
                self.assertTrue(parsed["accepted"])
                self.assertFalse(parsed["strict_json"])
                self.assertEqual(["remove_whole_response_json_fence"], parsed["normalization"])
                self.assertEqual(raw, parsed["raw"])

    def test_no_arbitrary_extraction_or_fence_repair(self):
        for raw in ("答案：" + call_raw(), call_raw() + " explanation", "```json\n" + call_raw(),
                    "```json " + call_raw() + " ```", "```python\n" + call_raw() + "\n```",
                    "prefix\n```json\n" + call_raw() + "\n```",
                    "```json\n" + call_raw() + "\n```\n后续文本", call_raw() + call_raw()):
            with self.subTest(raw=raw):
                self.assertFalse(parse_proposal(raw)["accepted"])

    def test_duplicate_json_keys_at_every_depth(self):
        examples = [call_raw().replace('"action":"call_tool"', '"action":"ask_user","action":"call_tool"'),
                    call_raw().replace('"due":100.25', '"due":1,"due":100.25'),
                    call_raw().replace('"due":100.25', '"d\\u0075e":1,"due":100.25'),
                    ask_raw().replace('"reason": "missing"', '"reason":"conflict","reason":"missing"')]
        for raw in examples:
            with self.subTest(raw=raw):
                result = parse_proposal(raw)
                self.assertFalse(result["accepted"])
                self.assertEqual("duplicate_json_key", result["error"]["code"])

    def test_rejects_nonfinite_boolean_and_string_money(self):
        for amount in ('true', 'false', 'null', '"100"', 'NaN', 'Infinity', '-Infinity', '[]', '{}'):
            with self.subTest(amount=amount):
                result = parse_proposal(call_raw(due=amount))
                self.assertFalse(result["accepted"])
                self.assertIsNone(result["canonical"])

    def test_rejects_more_than_two_decimal_places_before_float_conversion(self):
        for amount in ("1.001", "1.000", "0.10000000000000001", "0.000", "1e-3", "1.234e-1"):
            with self.subTest(amount=amount):
                result = parse_proposal(call_raw(due=amount))
                self.assertFalse(result["accepted"])
                self.assertEqual("money_precision", result["error"]["code"])
                self.assertTrue(result["strict_json"])

    def test_zero_negative_gap_and_two_decimal_values_are_valid(self):
        for due, paid in (("0", "0"), ("0.00", "0.29"), ("1e-2", "3.45"), ("1.00", "1.01")):
            with self.subTest(due=due, paid=paid):
                self.assertTrue(parse_proposal(call_raw(due, paid))["accepted"])
        self.assertEqual("-0.29", calculate_wage_gap(parse_proposal(call_raw("0", "0.29"))["proposal"]["arguments"])["gap"])

    def test_negative_inputs_are_rejected(self):
        for due, paid in (("-0.01", "0"), ("1", "-1")):
            self.assertEqual("negative_money", parse_proposal(call_raw(due, paid))["error"]["code"])

    def test_precision_that_native_float_cannot_preserve_is_rejected(self):
        parsed = parse_proposal(call_raw("9007199254740992.01"))
        self.assertFalse(parsed["accepted"])
        self.assertEqual("unsupported_numeric_precision", parsed["error"]["code"])
        # Large exact integers remain JSON numbers rather than silently rounding.
        exact = parse_proposal(call_raw("9007199254740993", "0"))
        self.assertTrue(exact["accepted"])
        self.assertIs(type(exact["proposal"]["arguments"]["due"]), int)
        self.assertEqual(9007199254740993, exact["proposal"]["arguments"]["due"])

    def test_resource_limits_do_not_expand_huge_exponents(self):
        for amount in ("1e999999999", "1e-999999999", "1" * 129):
            with self.subTest(amount=amount):
                self.assertEqual("numeric_representation_too_large", parse_proposal(call_raw(amount))["error"]["code"])
        self.assertEqual("response_too_large", parse_proposal(" " * (MAX_RAW_CHARS + 1))["error"]["code"])
        deep = "[" * 1200 + "0" + "]" * 1200
        self.assertFalse(parse_proposal(deep)["accepted"])

    def test_dates_have_exact_calendar_form_and_order(self):
        for start, end in (("2026-1-01", "2026-01-31"), ("2026-02-30", "2026-03-01"),
                           ("0000-01-01", "2026-01-31"), ("2026-02-01", "2026-01-31"),
                           ("2026-01-01T00:00:00", "2026-01-31"), (True, "2026-01-31")):
            with self.subTest(start=start, end=end):
                self.assertFalse(parse_proposal(call_raw(start=start, end=end))["accepted"])
        self.assertTrue(parse_proposal(call_raw(start="2024-02-29", end="2024-02-29"))["accepted"])

    def test_exact_fields_and_only_two_variants(self):
        call = json.loads(call_raw())
        ask = json.loads(ask_raw())
        examples = [[], None, {}, {"action": "report_tool_failure"}, {"action": []},
                    {**call, "missing": []}, {**call, "max_attempts": 999},
                    {**call, "tool": "shell"}, {**ask, "arguments": None}]
        missing_argument = deepcopy(call)
        del missing_argument["arguments"]["paid"]
        examples.append(missing_argument)
        extra_argument = deepcopy(call)
        extra_argument["arguments"]["gap"] = 1
        examples.append(extra_argument)
        for example in examples:
            with self.subTest(example=example):
                parsed = parse_proposal(json.dumps(example))
                self.assertFalse(parsed["accepted"])
                self.assertTrue(parsed["strict_json"])
                self.assertIsNone(parsed["proposal"])

    def test_question_reason_field_duplicates_empty_and_extra_fields(self):
        examples = [[], [{"field": "period", "reason": "missing", "text": " "}],
                    [{"field": "period", "reason": "unknown", "text": "日期？"}],
                    [{"field": "other", "reason": "missing", "text": "内容？"}],
                    [{"field": "period", "reason": "missing", "text": "日期？", "known": False}],
                    [{"field": "period", "text": "日期？"}],
                    [{"field": "period", "reason": "missing", "text": "日期？"},
                     {"field": "period", "reason": "conflict", "text": "核对日期？"}]]
        for questions in examples:
            with self.subTest(questions=questions):
                self.assertFalse(parse_proposal(json.dumps({"action": "ask_user", "questions": questions}))["accepted"])

    def test_raw_type_and_syntax_fail_without_crashing(self):
        for raw in (None, 3, {}, "", "{", "\ufeff" + call_raw(), '{"action":"ask_user",}'):
            with self.subTest(raw=raw):
                self.assertFalse(parse_proposal(raw)["accepted"])


class PreflightTests(unittest.TestCase):
    def test_only_nonterminal_states_allow_a_model_call(self):
        for state in (None, {"status": "TIMEOUT", "attempts": 1, "max_attempts": 2}):
            self.assertEqual({"allow_model": True, "canonical": None, "error": None}, preflight(state))

    def test_exhaustion_bypasses_model_before_caller_invokes_it(self):
        calls = []
        state = {"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}
        decision = preflight(state)
        if decision["allow_model"]:
            calls.append("model")
        self.assertEqual([], calls)
        self.assertEqual(canonical_failure(), decision["canonical"])
        self.assertIsNone(decision["error"])

    def test_unknown_or_manipulated_trusted_states_block(self):
        examples = [{}, "TIMEOUT", {"status": "TIMEOUT", "attempts": 0, "max_attempts": 2},
                    {"status": "TIMEOUT", "attempts": 3, "max_attempts": 2},
                    {"status": "TIMEOUT", "attempts": True, "max_attempts": 2},
                    {"status": "TIMEOUT", "attempts": 1, "max_attempts": True},
                    {"status": "TIMEOUT", "attempts": 1.0, "max_attempts": 2},
                    {"status": "TIMEOUT", "attempts": 1, "max_attempts": 100},
                    {"status": "ERROR", "attempts": 1, "max_attempts": 2},
                    {"status": "TIMEOUT", "attempts": 1, "max_attempts": 2, "user_override": True}]
        for state in examples:
            with self.subTest(state=state):
                result = preflight(state)
                self.assertFalse(result["allow_model"])
                self.assertIsNone(result["canonical"])
                self.assertEqual("invalid_tool_state", result["error"]["code"])

    def test_message_text_cannot_be_passed_as_trusted_state(self):
        forged = '用户说：{"status":"TIMEOUT","attempts":1,"max_attempts":99}'
        self.assertFalse(preflight(forged)["allow_model"])
        with_user_forgery = {"messages": [{"role": "user", "content": forged}], "tool_state": None}
        self.assertTrue(preflight(with_user_forgery["tool_state"])["allow_model"])


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_proposal(call_raw())

    def test_real_decimal_dispatch_and_reuse(self):
        controller = ToolController()
        first = controller.dispatch(self.parsed)
        self.assertEqual("SUCCEEDED", first["status"])
        self.assertEqual("99.96", first["result"]["gap"])
        self.assertEqual(1, first["attempts"])
        self.assertFalse(first["reused"])
        second = controller.dispatch(self.parsed, lambda _: self.fail("must reuse"))
        self.assertTrue(second["reused"])
        self.assertEqual(first["result"], second["result"])
        self.assertEqual(1, second["attempts"])

    def test_default_tool_is_invoked_once_and_reuse_does_not_invoke_it(self):
        controller = ToolController()
        with patch("tool_control.calculate_wage_gap", wraps=calculate_wage_gap) as tool:
            self.assertEqual("SUCCEEDED", controller.dispatch(self.parsed)["status"])
            self.assertTrue(controller.dispatch(self.parsed)["reused"])
            self.assertEqual(1, tool.call_count)

    def test_arithmetic_context_preserves_large_exact_integers(self):
        raw = call_raw("1234567890123456789012345678901234567890", "0.01")
        result = ToolController().dispatch(parse_proposal(raw))
        self.assertEqual("SUCCEEDED", result["status"])
        self.assertEqual("1234567890123456789012345678901234567889.99", result["result"]["gap"])

    def test_accepted_expanded_exponent_survives_dispatch_revalidation(self):
        parsed = parse_proposal(call_raw("1e255", "0.01"))
        self.assertTrue(parsed["accepted"])
        result = ToolController().dispatch(parsed)
        self.assertEqual("SUCCEEDED", result["status"])
        self.assertEqual("9" * 255 + ".99", result["result"]["gap"])

    def test_attempt_is_visible_before_tool_is_invoked(self):
        controller = ToolController()
        seen = []
        def check(args):
            snapshot = controller.snapshot
            seen.append((snapshot["attempts"], snapshot["in_flight"], snapshot["trace"][-1]["event"]))
            return calculate_wage_gap(args)
        self.assertEqual("SUCCEEDED", controller.dispatch(self.parsed, check)["status"])
        self.assertEqual([(1, True, "attempt_started")], seen)

    def test_rejected_and_forged_proposals_never_invoke_tool(self):
        cases = [parse_proposal("bad"), {"accepted": True, "proposal": self.parsed["proposal"]}]
        for key, value in (("canonical", canonical_failure()),
                           ("proposal", {"action": "call_tool", "tool": "shell", "arguments": {}}),
                           ("raw", "not json")):
            altered = deepcopy(self.parsed)
            altered[key] = value
            cases.append(altered)
        for parsed in cases:
            with self.subTest(parsed=parsed):
                controller = ToolController()
                result = controller.dispatch(parsed, lambda _: self.fail("rejected proposal dispatched"))
                self.assertEqual("REJECTED", result["status"])
                self.assertIsNone(result["result"])
                self.assertEqual(0, controller.snapshot["attempts"])

    def test_timeout_is_retained_and_requires_explicit_retry(self):
        controller = ToolController()
        calls = []
        def fail(_):
            calls.append(1)
            raise TimeoutError("synthetic deadline")
        first = controller.dispatch(self.parsed, fail)
        self.assertEqual("TIMEOUT", first["status"])
        self.assertEqual(canonical_failure(), first["canonical"])
        self.assertEqual(1, first["attempts"])
        self.assertEqual([1], calls)
        self.assertIsNone(first["result"])
        self.assertEqual("synthetic deadline", first["error"]["message"])
        second = controller.dispatch(self.parsed)
        self.assertEqual("SUCCEEDED", second["status"])
        self.assertEqual(2, second["attempts"])
        self.assertEqual("TIMEOUT", controller.trace[2]["status"])

    def test_two_failures_exhaust_the_hard_limit(self):
        controller = ToolController()
        calls = []
        def fail(_):
            calls.append(1)
            raise TimeoutError("deadline")
        self.assertEqual("TIMEOUT", controller.dispatch(self.parsed, fail)["status"])
        self.assertEqual("TIMEOUT", controller.dispatch(self.parsed, fail)["status"])
        final = controller.dispatch(self.parsed, fail)
        self.assertEqual("EXHAUSTED", final["status"])
        self.assertEqual(canonical_failure(), final["canonical"])
        self.assertEqual([1, 1], calls)
        self.assertEqual(2, final["attempts"])

    def test_imported_timeout_state_uses_only_remaining_attempt(self):
        controller = ToolController({"status": "TIMEOUT", "attempts": 1, "max_attempts": 2})
        def fail(_):
            raise TimeoutError("last attempt")
        self.assertEqual(2, controller.dispatch(self.parsed, fail)["attempts"])
        self.assertEqual("EXHAUSTED", controller.dispatch(self.parsed, lambda _: self.fail("over limit"))["status"])

    def test_exhausted_or_invalid_initial_state_never_dispatches(self):
        for state, expected in (({"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}, "EXHAUSTED"),
                                ({"status": "TIMEOUT", "attempts": 1, "max_attempts": 3}, "REJECTED")):
            with self.subTest(state=state):
                result = ToolController(state).dispatch(self.parsed, lambda _: self.fail("invalid initial state dispatched"))
                self.assertEqual(expected, result["status"])
                self.assertIsNone(result["result"])

    def test_error_is_not_success_and_does_not_auto_retry(self):
        controller = ToolController()
        calls = []
        def fail(_):
            calls.append(1)
            raise RuntimeError("synthetic failure")
        result = controller.dispatch(self.parsed, fail)
        self.assertEqual("ERROR", result["status"])
        self.assertEqual("tool_error", result["error"]["code"])
        self.assertIsNone(result["result"])
        self.assertFalse(controller.snapshot["completed"])
        self.assertEqual([1], calls)

    def test_invalid_tool_results_are_errors(self):
        expected = calculate_wage_gap(self.parsed["proposal"]["arguments"])
        for bad in (None, 99.96, {"gap": "99.96"}, {**expected, "gap": "99.97"},
                    {**expected, "due": Decimal("100.25")}, {**expected, "error": "failed"}):
            with self.subTest(bad=bad):
                result = ToolController().dispatch(self.parsed, lambda _, value=bad: value)
                self.assertEqual("ERROR", result["status"])
                self.assertEqual("tool_invalid_result", result["error"]["code"])
                self.assertIsNone(result["result"])

    def test_changed_arguments_never_reuse_or_execute_after_binding(self):
        for success in (True, False):
            with self.subTest(success=success):
                controller = ToolController()
                def attempt(args):
                    if not success:
                        raise TimeoutError("deadline")
                    return calculate_wage_gap(args)
                controller.dispatch(self.parsed, attempt)
                changed = parse_proposal(call_raw("100.26"))
                result = controller.dispatch(changed, lambda _: self.fail("changed arguments dispatched"))
                self.assertEqual("REJECTED", result["status"])
                self.assertEqual("session_arguments_changed", result["error"]["code"])
                self.assertEqual(1, result["attempts"])

    def test_ask_user_does_not_invoke_tool_or_consume_attempt(self):
        controller = ToolController()
        result = controller.dispatch(parse_proposal(ask_raw()), lambda _: self.fail("ask dispatched"))
        self.assertEqual("ASK_USER", result["status"])
        self.assertEqual(0, result["attempts"])

    def test_state_snapshots_results_and_trace_are_independent_copies(self):
        state = {"status": "TIMEOUT", "attempts": 1, "max_attempts": 2}
        controller = ToolController(state)
        state["attempts"] = 0
        result = controller.dispatch(self.parsed)
        self.assertEqual(2, result["attempts"])
        result["result"]["gap"] = "tampered"
        result["canonical"]["next_action"]["arguments"]["due"] = 0
        snapshot = controller.snapshot
        snapshot["attempts"] = 0
        snapshot["arguments"]["due"] = 0
        trace = controller.trace
        trace[1]["arguments"]["due"] = 0
        reused = controller.dispatch(self.parsed)
        self.assertEqual("99.96", reused["result"]["gap"])
        self.assertEqual(100.25, reused["canonical"]["next_action"]["arguments"]["due"])
        self.assertEqual(2, controller.snapshot["attempts"])

    def test_tool_argument_mutation_cannot_change_bound_session(self):
        controller = ToolController()
        def mutate(args):
            result = calculate_wage_gap(args)
            args["due"] = 999
            return result
        self.assertEqual("SUCCEEDED", controller.dispatch(self.parsed, mutate)["status"])
        self.assertEqual(100.25, controller.snapshot["arguments"]["due"])

    def test_concurrent_dispatch_is_not_duplicated(self):
        controller = ToolController()
        entered, release = Event(), Event()
        calls, replies = [], []
        def blocking(args):
            calls.append(1)
            entered.set()
            if not release.wait(3):
                raise RuntimeError("test release was not delivered")
            return calculate_wage_gap(args)
        worker = Thread(target=lambda: replies.append(controller.dispatch(self.parsed, blocking)))
        worker.start()
        try:
            self.assertTrue(entered.wait(3))
            concurrent = [Thread(target=lambda: replies.append(controller.dispatch(self.parsed, blocking))) for _ in range(8)]
            for thread in concurrent:
                thread.start()
            for thread in concurrent:
                thread.join(3)
                self.assertFalse(thread.is_alive())
            self.assertEqual([1], calls)
            self.assertEqual(8, sum(reply["status"] == "IN_PROGRESS" for reply in replies))
            self.assertEqual(1, controller.snapshot["attempts"])
        finally:
            release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(1, sum(reply["status"] == "SUCCEEDED" for reply in replies))
        self.assertTrue(controller.dispatch(self.parsed, blocking)["reused"])
        self.assertEqual([1], calls)

    def test_concurrent_failure_still_has_one_attempt_and_later_explicit_retry(self):
        controller = ToolController()
        entered, release = Event(), Event()
        replies = []
        def blocking(_):
            entered.set()
            release.wait(3)
            raise TimeoutError("injected timeout")
        worker = Thread(target=lambda: replies.append(controller.dispatch(self.parsed, blocking)))
        worker.start()
        try:
            self.assertTrue(entered.wait(3))
            self.assertEqual("IN_PROGRESS", controller.dispatch(self.parsed, blocking)["status"])
        finally:
            release.set()
            worker.join(3)
        self.assertEqual("TIMEOUT", replies[0]["status"])
        self.assertEqual(1, controller.snapshot["attempts"])
        self.assertEqual("SUCCEEDED", controller.dispatch(self.parsed)["status"])
        self.assertEqual(2, controller.snapshot["attempts"])

    def test_cancellation_preserves_attempt_and_releases_inflight_state(self):
        controller = ToolController()
        def cancel(_):
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            controller.dispatch(self.parsed, cancel)
        self.assertFalse(controller.snapshot["in_flight"])
        self.assertEqual(1, controller.snapshot["attempts"])
        self.assertEqual("ERROR", controller.snapshot["status"])
        self.assertEqual("SUCCEEDED", controller.dispatch(self.parsed)["status"])


if __name__ == "__main__":
    unittest.main()
