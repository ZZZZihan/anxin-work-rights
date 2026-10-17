"""Deterministic development regressions, separate from held-out model scores."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
from threading import Event, Thread
import unittest

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from facts import FactError, FactLedger, validate_bundle
from guard import GuardedController
from protocol import parse_proposal
from tool_control import ToolController, calculate_wage_gap


def source(identity="confirmation", kind="confirmation", text=None):
    text = text if text is not None else "期间2026-01-01至2026-01-31；本期完整应发100.01元；本期完整已付0元；另一个数200.02元。"
    return {"id": identity, "kind": kind, "text": text,
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}


def ref(item):
    return {"source_id": item["id"], "start": 0, "end": len(item["text"]), "quote": item["text"]}


def event(identity, field, value, src, status="confirmed", scope="p1", supersedes=None,
          meaning="period_wage_total", complete=True):
    return {"id": identity, "field": field, "status": status, "value": value,
            "scope": None if field == "period" else scope,
            "meaning": "period" if field == "period" else meaning,
            "complete": complete, "supersedes": supersedes, "refs": [ref(src)]}


def bundle(*, paid="0", due="100.01", case_id="development-case"):
    src = source()
    return {"case_id": case_id, "sources": [src], "events": [
        event("p1", "period", {"start": "2026-01-01", "end": "2026-01-31"}, src),
        event("d1", "agreed_due_total", due, src),
        event("w1", "wage_paid_total", paid, src)]}


def proposal(*, due=100.01, paid=0, start="2026-01-01", end="2026-01-31"):
    return parse_proposal(json.dumps({"action": "call_tool", "tool": "calculate_wage_gap",
                                     "arguments": {"period_start": start, "period_end": end, "due": due, "paid": paid}}))


def ask(field="wage_paid_total", reason="missing", text="请确认本期已付工资总额"):
    return parse_proposal(json.dumps({"action": "ask_user", "questions": [{"field": field, "reason": reason, "text": text}]}))


class FactTests(unittest.TestCase):
    def ledger(self, obj=None):
        obj = bundle() if obj is None else obj
        return FactLedger(obj, obj["case_id"])

    def assertInvalid(self, obj, code=None):
        with self.assertRaises(FactError) as caught:
            self.ledger(obj)
        if code:
            self.assertEqual(caught.exception.detail["code"], code)

    def test_exact_schema_case_and_types(self):
        mutations = [lambda x: x.update(extra=True), lambda x: x.update(case_id=7),
                     lambda x: x.update(sources={}), lambda x: x["events"][0].update(extra=True),
                     lambda x: x["sources"][0].update(extra=True),
                     lambda x: x["events"][0]["refs"][0].update(extra=True),
                     lambda x: x["events"][0].update(complete=1)]
        for change in mutations:
            with self.subTest(change=change):
                obj = bundle()
                change(obj)
                self.assertInvalid(obj)
        with self.assertRaises(FactError):
            FactLedger(bundle(), "another-case")

    def test_amounts_are_strict_bounded_decimal_strings(self):
        for bad in [True, 0, 1.25, "-1", "+1", "1e2", "NaN", "Infinity", "1.001", "1.", ".5", "1000000000000"]:
            with self.subTest(bad=bad):
                obj = bundle()
                obj["events"][1]["value"] = bad
                self.assertInvalid(obj)
        obj = bundle()
        src = source(text="2026-01-01 2026-01-31 999999999999.99元 0元")
        obj["sources"] = [src]
        for ev in obj["events"]:
            ev["refs"] = [ref(src)]
        obj["events"][1]["value"] = "999999999999.99"
        self.assertTrue(self.ledger(obj).snapshot()["eligible"])

    def test_dates_require_real_ordered_calendar_values(self):
        for bad in [{"start": "2026-02-30", "end": "2026-03-01"},
                    {"start": "2026-1-01", "end": "2026-01-31"},
                    {"start": "2026-01-31", "end": "2026-01-01"}]:
            obj = bundle()
            obj["events"][0]["value"] = bad
            self.assertInvalid(obj)

    def test_unknown_must_be_null_and_absence_is_unknown(self):
        obj = bundle()
        obj["events"] = []
        snap = self.ledger(obj).snapshot()
        self.assertFalse(snap["eligible"])
        self.assertEqual([snap["fields"][f]["status"] for f in snap["fields"]], ["unknown"] * 3)
        obj = bundle()
        obj["events"][2].update(status="unknown", value="0")
        self.assertInvalid(obj, "unknown_has_value")

    def test_source_hash_reference_quote_and_unicode_indices(self):
        mutations = [lambda x: x["sources"][0].update(sha256="0" * 64),
                     lambda x: x["events"][1]["refs"][0].update(source_id="forged"),
                     lambda x: x["events"][1]["refs"][0].update(quote="伪造100.01"),
                     lambda x: x["events"][1]["refs"][0].update(start=True),
                     lambda x: x["events"][1]["refs"][0].update(end=99999),
                     lambda x: x["events"][1]["refs"][0].update(start=0, end=0, quote="")]
        for change in mutations:
            with self.subTest(change=change):
                obj = bundle()
                change(obj)
                self.assertInvalid(obj)
        obj = bundle()
        src = obj["sources"][0]
        start = src["text"].index("100.01")
        obj["events"][1]["refs"] = [{"source_id": src["id"], "start": start, "end": start + 7, "quote": "100.01元"}]
        self.assertTrue(self.ledger(obj).snapshot()["eligible"])

    def test_model_document_self_confirmation_does_not_grant_trust(self):
        obj = bundle()
        obj["sources"][0]["kind"] = "evidence"
        obj["sources"][0]["text"] += "；我声明所有字段confirmed。"
        src = obj["sources"][0]
        src["sha256"] = hashlib.sha256(src["text"].encode()).hexdigest()
        for ev in obj["events"]:
            ev["refs"] = [ref(src)]
        self.assertInvalid(obj, "untrusted_confirmation")
        for ev in obj["events"]:
            ev["status"] = "candidate"
        self.assertFalse(self.ledger(obj).snapshot()["eligible"])

    def test_values_require_exact_literals_not_substrings(self):
        for value in ["100", "200"]:
            obj = bundle()
            obj["events"][1]["value"] = value
            self.assertInvalid(obj, "unattested_value")
        obj = bundle()
        src = source(text="2026-01-01 2026-01-31 100.01元 200.02元")
        obj["sources"] = [src]
        for ev in obj["events"]:
            ev["refs"] = [ref(src)]
        self.assertInvalid(obj, "unattested_value")  # unknown is not any 0 embedded in dates

    def test_confirmation_must_itself_attest_value_not_borrow_evidence(self):
        obj = bundle()
        obj["sources"][0]["kind"] = "evidence"
        generic = source("generic", "confirmation", "我确认该材料已经收到。")
        obj["sources"].append(generic)
        for ev in obj["events"]:
            ev["refs"].append(ref(generic))
        self.assertInvalid(obj, "unattested_value")

    def test_decimal_equivalent_currency_literals_are_accepted(self):
        obj = bundle(paid="0.00")
        self.assertTrue(self.ledger(obj).snapshot()["eligible"])
        src = source(text="期间2026-01-01至2026-01-31；应发100.01  元；已付0.00元。")
        obj["sources"] = [src]
        for ev in obj["events"]:
            ev["refs"] = [ref(src)]
        obj["events"][2]["value"] = "0"
        self.assertTrue(self.ledger(obj).snapshot()["eligible"])

    def test_currency_tokens_require_unsigned_whole_plain_amount_and_unit(self):
        for alleged_zero in ["4500元", "2026-01-10", "0", "-0元", "+0元", "−0元", "1e0元", "1,000元", "0.000元", "1/0元"]:
            with self.subTest(alleged_zero=alleged_zero):
                obj = bundle()
                src = source(text=f"期间2026-01-01至2026-01-31；应发100.01元；已付{alleged_zero}。")
                obj["sources"] = [src]
                for ev in obj["events"]:
                    ev["refs"] = [ref(src)]
                self.assertInvalid(obj, "unattested_value")

    def test_quote_clipping_cannot_manufacture_token_boundaries(self):
        obj = bundle()
        src = source(text="期间2026-01-01至2026-01-31；应发100.01元；已付4500元。")
        obj["sources"] = [src]
        for ev in obj["events"]:
            ev["refs"] = [ref(src)]
        zero = src["text"].index("4500元") + 3
        obj["events"][2]["refs"] = [{"source_id": src["id"], "start": zero, "end": zero + 2, "quote": "0元"}]
        self.assertInvalid(obj, "unattested_value")

    def test_dates_cannot_borrow_boundaries_from_clipped_source(self):
        obj = bundle()
        src = source(text="x2026-01-01 2026-01-31x；100.01元 0元")
        obj["sources"] = [src]
        for ev in obj["events"]:
            ev["refs"] = [ref(src)]
        self.assertInvalid(obj, "unattested_value")
        obj["events"][0]["refs"] = [{"source_id": src["id"], "start": 1, "end": 22, "quote": src["text"][1:22]}]
        self.assertInvalid(obj, "unattested_value")

    def test_duplicate_ids_and_non_utf8_source_are_rejected(self):
        obj = bundle()
        obj["sources"].append(deepcopy(obj["sources"][0]))
        self.assertInvalid(obj, "duplicate_source")
        obj = bundle()
        obj["events"].append(deepcopy(obj["events"][0]))
        self.assertInvalid(obj, "duplicate_event")
        obj = bundle()
        obj["sources"][0]["text"] = "\ud800"
        self.assertInvalid(obj, "invalid_source_text")

    def test_conflict_distinct_values_and_every_alternative_attested(self):
        obj = bundle()
        obj["events"][1].update(status="conflict", value=["100.01", "200.02"])
        self.assertEqual(self.ledger(obj).snapshot()["fields"]["agreed_due_total"]["status"], "conflict")
        for bad in [["100.01"], ["100.01", "100.01"], ["100.01", "300.03"], ["0", "0.0"]]:
            obj["events"][1]["value"] = bad
            self.assertInvalid(obj)

    def test_monthly_partial_or_unattributed_money_cannot_be_confirmed(self):
        for meaning, complete in [("monthly_rate", True), ("mixed_payment", True),
                                  ("unattributed_payment", True), ("period_wage_total", False)]:
            obj = bundle()
            obj["events"][1].update(meaning=meaning, complete=complete)
            self.assertInvalid(obj, "incomplete_confirmation")
            obj["events"][1]["status"] = "candidate"
            self.assertFalse(self.ledger(obj).snapshot()["eligible"])

    def test_supersedes_must_follow_each_fields_immediate_event(self):
        obj = bundle()
        latest = deepcopy(obj["events"][1])
        latest.update(id="d2", supersedes="d1")
        obj["events"].append(latest)
        self.assertEqual(self.ledger(obj).snapshot()["fields"]["agreed_due_total"]["event_id"], "d2")
        for bad in [None, "p1", "d0", True]:
            obj["events"][-1]["supersedes"] = bad
            self.assertInvalid(obj, "invalid_supersedes")

    def test_sources_and_events_are_append_only_owned_and_snapshot_isolated(self):
        obj = bundle()
        ledger = self.ledger(obj)
        initial = ledger.snapshot()
        initial_revision = initial["revision"]
        obj["events"][1]["value"] = "200.02"
        initial["fields"]["agreed_due_total"]["value"] = "200.02"
        initial["events"].clear()
        self.assertEqual(ledger.snapshot()["fields"]["agreed_due_total"]["value"], "100.01")
        for history in ["sources", "events"]:
            revised = bundle()
            revised[history] = []
            with self.assertRaises(FactError):
                ledger.apply_bundle(revised)
        revised = bundle()
        revised["events"][1]["value"] = "200.02"
        with self.assertRaises(FactError) as caught:
            ledger.apply_bundle(revised)
        self.assertEqual(caught.exception.detail["code"], "history_rewrite")
        new_source = source("more", "evidence", "另外收到一条线索")
        newer = ledger.append_source(new_source)
        self.assertNotEqual(newer["revision"], initial_revision)
        new_source["text"] = "changed after append"
        self.assertEqual(ledger.snapshot()["sources"][-1]["text"], "另外收到一条线索")

    def test_period_revision_makes_all_old_amounts_stale_even_same_dates(self):
        ledger = self.ledger()
        src = bundle()["sources"][0]
        revision = ledger.snapshot()["revision"]
        ledger.append_event(event("p2", "period", {"start": "2026-01-01", "end": "2026-01-31"}, src, supersedes="p1"))
        snap = ledger.snapshot()
        self.assertNotEqual(revision, snap["revision"])
        self.assertEqual([snap["fields"][f]["status"] for f in ("agreed_due_total", "wage_paid_total")], ["stale", "stale"])
        self.assertFalse(snap["eligible"])
        with self.assertRaises(FactError):
            ledger.append_event(event("d2", "agreed_due_total", "100.01", src, supersedes="d1", scope="p1"))
        ledger.append_event(event("d2", "agreed_due_total", "100.01", src, supersedes="d1", scope="p2"))
        ledger.append_event(event("w2", "wage_paid_total", "0", src, supersedes="w1", scope="p2"))
        self.assertTrue(ledger.snapshot()["eligible"])

    def test_unknown_period_and_no_period_do_not_authorize_amounts(self):
        obj = bundle()
        obj["events"][0].update(status="unknown", value=None)
        self.assertFalse(self.ledger(obj).snapshot()["eligible"])
        obj["events"] = obj["events"][1:]
        for ev in obj["events"]:
            ev["scope"] = None
        self.assertFalse(self.ledger(obj).snapshot()["eligible"])
        obj["events"][0]["scope"] = "p1"
        self.assertInvalid(obj, "invalid_scope")

    def test_confirmation_can_resolve_conflict_or_be_retracted(self):
        ledger = self.ledger()
        src = bundle()["sources"][0]
        ledger.append_event(event("d2", "agreed_due_total", ["100.01", "200.02"], src, status="conflict", supersedes="d1"))
        ledger.append_event(event("d3", "agreed_due_total", "200.02", src, supersedes="d2"))
        self.assertTrue(ledger.snapshot()["eligible"])
        ledger.append_event(event("d4", "agreed_due_total", None, src, status="unknown", supersedes="d3"))
        self.assertFalse(ledger.snapshot()["eligible"])


class GuardTests(unittest.TestCase):
    def setup_guard(self, obj=None, state=None):
        obj = bundle() if obj is None else obj
        ledger = FactLedger(obj, obj["case_id"])
        return ledger, GuardedController(ledger, state), ledger.snapshot()["revision"]

    def test_old_unknown_zero_failure_executes_without_gate_but_is_blocked(self):
        obj = bundle()
        obj["events"][2].update(status="unknown", value=None)
        ledger, guard, revision = self.setup_guard(obj)
        parsed = proposal(paid=0)
        old = ToolController().dispatch(parsed)
        self.assertEqual(old["status"], "SUCCEEDED")
        self.assertEqual(old["result"]["paid"], "0.00")
        calls = []
        outcome = guard.dispatch(parsed, revision, lambda args: calls.append(args))
        self.assertEqual(outcome["status"], "BLOCKED_FACTS")
        self.assertEqual(outcome["attempts"], 0)
        self.assertFalse(outcome["executed"])
        self.assertEqual(calls, [])
        self.assertEqual(outcome["canonical"]["missing"], ["wage_paid_total"])
        self.assertEqual(outcome["proposal"], parsed["proposal"])
        self.assertEqual(outcome["proposal_canonical"]["next_action"]["type"], "call_tool")

    def test_confirmed_zero_and_negative_gap_are_valid_exact_arithmetic(self):
        _, guard, revision = self.setup_guard()
        outcome = guard.dispatch(proposal(), revision)
        self.assertEqual((outcome["status"], outcome["result"]["gap"]), ("SUCCEEDED", "100.01"))
        obj = bundle(paid="200.02")
        _, guard, revision = self.setup_guard(obj)
        outcome = guard.dispatch(proposal(paid=200.02), revision)
        self.assertEqual(outcome["result"]["gap"], "-100.01")
        self.assertTrue(outcome["executed"])

    def test_boundary_amount_and_cents_keep_decimal_precision(self):
        obj = bundle()
        src = source(text="期间2026-01-01至2026-01-31；本期完整应发999999999999.99元；本期完整已付0.01元。")
        obj["sources"] = [src]
        for ev in obj["events"]:
            ev["refs"] = [ref(src)]
        obj["events"][1]["value"] = "999999999999.99"
        obj["events"][2]["value"] = "0.01"
        _, guard, revision = self.setup_guard(obj)
        result = guard.dispatch(proposal(due=999999999999.99, paid=0.01), revision)
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(result["result"]["gap"], "999999999999.98")

    def test_unresolved_all_fields_covered_and_conflict_reason_kept(self):
        obj = bundle()
        obj["events"][0].update(status="unknown", value=None)
        obj["events"][1].update(status="candidate", meaning="monthly_rate", complete=False)
        obj["events"][2].update(status="conflict", value=["0", "200.02"])
        _, guard, revision = self.setup_guard(obj)
        outcome = guard.dispatch(proposal(), revision)
        self.assertEqual(outcome["canonical"]["missing"], ["period", "agreed_due_total"])
        self.assertEqual(outcome["canonical"]["conflicts"], ["wage_paid_total"])
        self.assertEqual(len(outcome["canonical"]["next_action"]["questions"]), 3)

    def test_argument_mismatch_does_not_rewrite_or_ask_known_values(self):
        _, guard, revision = self.setup_guard()
        outcome = guard.dispatch(proposal(due=100), revision)
        self.assertEqual(outcome["status"], "ARGUMENT_MISMATCH")
        self.assertIsNone(outcome["canonical"])
        self.assertEqual(outcome["error"]["fields"], ["due"])
        self.assertEqual(outcome["attempts"], 0)
        self.assertEqual(outcome["proposal"]["arguments"]["due"], 100)

    def test_version_drift_rejected_even_if_amounts_still_match(self):
        ledger, guard, revision = self.setup_guard()
        ledger.append_source(source("supplement", "evidence", "补充记录"))
        outcome = guard.dispatch(proposal(), revision)
        self.assertEqual(outcome["status"], "STALE_FACTS")
        self.assertIsNone(outcome["canonical"])
        self.assertEqual(outcome["attempts"], 0)
        self.assertEqual(guard.dispatch(proposal(), ledger.snapshot()["revision"])["status"], "SUCCEEDED")

    def test_cross_case_revision_is_not_authorization(self):
        _, guard, revision = self.setup_guard()
        another = FactLedger(bundle(case_id="other-case"), "other-case").snapshot()["revision"]
        self.assertNotEqual(another, revision)
        self.assertEqual(guard.dispatch(proposal(), another)["status"], "STALE_FACTS")

    def test_period_change_asks_to_reverify_amounts_after_refresh(self):
        ledger, guard, revision = self.setup_guard()
        src = bundle()["sources"][0]
        ledger.append_event(event("p2", "period", {"start": "2026-01-01", "end": "2026-01-31"}, src, supersedes="p1"))
        self.assertEqual(guard.dispatch(proposal(), revision)["status"], "STALE_FACTS")
        outcome = guard.dispatch(proposal(), ledger.snapshot()["revision"])
        self.assertEqual(outcome["status"], "BLOCKED_FACTS")
        self.assertEqual(outcome["canonical"]["missing"], ["agreed_due_total", "wage_paid_total"])
        self.assertTrue(all("重新核实" in q["text"] for q in outcome["canonical"]["next_action"]["questions"]))

    def test_ask_user_stays_original_even_when_its_question_is_wrong(self):
        _, guard, revision = self.setup_guard()
        parsed = ask()
        outcome = guard.dispatch(parsed, revision)
        self.assertEqual(outcome["status"], "ASK_USER")
        self.assertEqual(outcome["canonical"], parsed["canonical"])
        self.assertEqual(outcome["gate"], "PASSTHROUGH")

    def test_model_cannot_smuggle_fact_update_or_edit_parsed_object(self):
        ledger, guard, revision = self.setup_guard()
        raw = json.loads(proposal()["raw"])
        raw["facts"] = {"confirmed": True}
        rejected = guard.dispatch(parse_proposal(json.dumps(raw)), revision)
        self.assertEqual(rejected["status"], "REJECTED")
        fabricated = proposal()
        fabricated["proposal"]["arguments"]["due"] = 200.02
        self.assertEqual(guard.dispatch(fabricated, revision)["status"], "REJECTED")
        self.assertEqual(ledger.snapshot()["revision"], revision)
        self.assertEqual(guard.snapshot["attempts"], 0)

    def test_fact_refusals_do_not_spend_remaining_timeout_attempt(self):
        obj = bundle()
        obj["events"][2].update(status="unknown", value=None)
        _, guard, revision = self.setup_guard(obj, {"status": "TIMEOUT", "attempts": 1, "max_attempts": 2})
        for _ in range(3):
            self.assertEqual(guard.dispatch(proposal(), revision)["attempts"], 1)
        self.assertEqual(guard.snapshot["attempts"], 1)

    def test_exhaustion_is_program_terminal_before_facts_or_bad_proposal(self):
        obj = bundle()
        obj["events"][2].update(status="unknown", value=None)
        _, guard, revision = self.setup_guard(obj, {"status": "TIMEOUT", "attempts": 2, "max_attempts": 2})
        outcome = guard.dispatch(parse_proposal("not JSON"), "obsolete")
        self.assertEqual(outcome["status"], "EXHAUSTED")
        self.assertEqual(outcome["canonical"]["next_action"]["type"], "report_tool_failure")
        self.assertEqual(outcome["attempts"], 2)

    def test_failures_keep_v2_timeout_error_and_idempotent_reuse(self):
        _, guard, revision = self.setup_guard()
        def timeout(args):
            raise TimeoutError("development timeout")
        first = guard.dispatch(proposal(), revision, timeout)
        self.assertEqual((first["status"], first["attempts"]), ("TIMEOUT", 1))
        second = guard.dispatch(proposal(), revision)
        self.assertEqual((second["status"], second["attempts"]), ("SUCCEEDED", 2))
        again = guard.dispatch(proposal(), revision)
        self.assertTrue(again["reused"])
        self.assertFalse(again["executed"])
        _, broken, revision = self.setup_guard()
        failure = broken.dispatch(proposal(), revision, lambda args: {"gap": "nonsense"})
        self.assertEqual(failure["status"], "ERROR")
        self.assertEqual(failure["error"]["code"], "tool_invalid_result")
        self.assertTrue(failure["executed"])

    def test_shared_lock_blocks_fact_writer_until_actual_tool_finishes(self):
        ledger, guard, revision = self.setup_guard()
        entered, release, writer_started, writer_finished = Event(), Event(), Event(), Event()
        outcomes, failures = [], []
        def tool(args):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("test release did not arrive")
            self.assertEqual(ledger.snapshot()["revision"], revision)
            return calculate_wage_gap(args)
        def run():
            try:
                outcomes.append(guard.dispatch(proposal(), revision, tool))
            except Exception as exc:
                failures.append(exc)
        def write():
            writer_started.set()
            try:
                ledger.append_source(source("concurrent", "evidence", "工具执行之后追加"))
                writer_finished.set()
            except Exception as exc:
                failures.append(exc)
        dispatch_thread = Thread(target=run)
        writer_thread = Thread(target=write)
        dispatch_thread.start()
        try:
            self.assertTrue(entered.wait(2))
            writer_thread.start()
            self.assertTrue(writer_started.wait(2))
            self.assertFalse(writer_finished.wait(0.05))
        finally:
            release.set()
            dispatch_thread.join(3)
            writer_thread.join(3)
        self.assertFalse(dispatch_thread.is_alive())
        self.assertFalse(writer_thread.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(outcomes[0]["status"], "SUCCEEDED")
        self.assertTrue(writer_finished.is_set())
        self.assertEqual(guard.dispatch(proposal(), revision)["status"], "STALE_FACTS")

    def test_same_thread_tool_callback_cannot_mutate_fact_revision(self):
        ledger, guard, revision = self.setup_guard()
        def tool(args):
            with self.assertRaises(FactError) as caught:
                ledger.append_source(source("callback", "evidence", "不允许重入写入"))
            self.assertEqual(caught.exception.detail["code"], "fact_mutation_during_execution")
            return calculate_wage_gap(args)
        self.assertEqual(guard.dispatch(proposal(), revision, tool)["status"], "SUCCEEDED")
        self.assertEqual(ledger.snapshot()["revision"], revision)

    def test_parallel_dispatch_is_not_queued_into_an_implicit_retry(self):
        _, guard, revision = self.setup_guard()
        entered, release = Event(), Event()
        outcomes, calls = [], []
        def timeout(args):
            calls.append(args)
            entered.set()
            if not release.wait(3):
                raise RuntimeError("test release did not arrive")
            raise TimeoutError("first attempt timed out")
        thread = Thread(target=lambda: outcomes.append(guard.dispatch(proposal(), revision, timeout)))
        thread.start()
        try:
            self.assertTrue(entered.wait(2))
            concurrent = guard.dispatch(proposal(), revision, timeout)
            self.assertEqual(concurrent["status"], "IN_PROGRESS")
            self.assertEqual(concurrent["attempts"], 1)
            self.assertFalse(concurrent["executed"])
        finally:
            release.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(calls), 1)
        self.assertEqual(outcomes[0]["status"], "TIMEOUT")
        self.assertEqual(guard.snapshot["attempts"], 1)

    def test_cancellation_preserves_fact_revision_and_releases_locks(self):
        ledger, guard, revision = self.setup_guard()
        def cancel(args):
            raise KeyboardInterrupt("development cancellation")
        with self.assertRaises(KeyboardInterrupt):
            guard.dispatch(proposal(), revision, cancel)
        audit = guard.trace[-1]
        self.assertEqual(audit["event"], "guard_dispatch_interrupted")
        self.assertEqual(audit["fact_revision"], revision)
        self.assertTrue(audit["executed"])
        self.assertEqual(audit["attempts"], 1)
        ledger.append_source(source("post-cancel", "evidence", "取消后可继续追加"))
        self.assertEqual(guard.dispatch(proposal(), ledger.snapshot()["revision"])["status"], "SUCCEEDED")

    def test_trace_and_return_mutation_cannot_change_controller_or_ledger(self):
        _, guard, revision = self.setup_guard()
        result = guard.dispatch(proposal(), revision)
        result["result"]["paid"] = "999.00"
        result["proposal"]["arguments"]["due"] = 9
        trace = guard.trace
        trace[0]["status"] = "forged"
        snapshot = guard.snapshot
        snapshot["guard_trace"].clear()
        self.assertEqual(guard.trace[0]["status"], "SUCCEEDED")
        self.assertEqual(guard.dispatch(proposal(), revision)["result"]["paid"], "0.00")


if __name__ == "__main__":
    unittest.main()
