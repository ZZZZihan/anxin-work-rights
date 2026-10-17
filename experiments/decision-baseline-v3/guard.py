"""Execution-time fact authorization around the unchanged v2 controller."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from threading import Lock
from typing import Any, Callable

from dependencies import ProtocolError, canonical_failure, parse_proposal, validate_proposal, MAX_ATTEMPTS, ToolController, preflight
from facts import FIELDS, FactLedger


def unresolved_questions(facts: dict) -> list[dict]:
    """Program-owned verification requests, covering every unresolved field."""
    questions = []
    labels = {"period": "计算工资的起止日期", "agreed_due_total": "该期间完整的应发工资总额", "wage_paid_total": "该期间完整的已付工资总额（确认未支付时请明确填0）"}
    for field in FIELDS:
        status = facts["fields"][field]["status"]
        if status == "confirmed":
            continue
        if status == "conflict":
            text = f"关于{labels[field]}有相互冲突的记录，请核实并确认正确值。"
            reason = "conflict"
        elif status == "stale":
            text = f"期间已修订，请重新核实并确认{labels[field]}；旧期间的金额不能沿用。"
            reason = "missing"
        elif status == "candidate":
            text = f"现有{labels[field]}只是候选信息，请核实并明确确认。"
            reason = "missing"
        else:
            text = f"请核实并确认{labels[field]}。"
            reason = "missing"
        questions.append({"field": field, "reason": reason, "text": text})
    return questions


def verification_canonical(facts: dict) -> dict | None:
    questions = unresolved_questions(facts)
    return validate_proposal({"action": "ask_user", "questions": questions})[1] if questions else None


def _validated(parsed: Any) -> dict:
    if type(parsed) is not dict or parsed.get("accepted") is not True:
        raise ProtocolError("rejected_proposal", "Only an accepted parsed proposal may be dispatched")
    if "raw" not in parsed:
        raise ProtocolError("missing_parsed_raw", "Dispatch requires parse_proposal's retained raw response")
    reparsed = parse_proposal(parsed["raw"])
    if (not reparsed["accepted"] or reparsed["proposal"] != parsed.get("proposal")
            or reparsed["canonical"] != parsed.get("canonical")):
        raise ProtocolError("parsed_proposal_mismatch", "Parsed proposal or canonical no longer matches its raw response")
    return validate_proposal(parsed["proposal"])[0]


class GuardedController:
    def __init__(self, ledger: FactLedger, tool_state: Any = None) -> None:
        if not isinstance(ledger, FactLedger):
            raise TypeError("ledger must be a FactLedger")
        self._ledger = ledger
        self._controller = ToolController(tool_state)
        self._preflight = preflight(deepcopy(tool_state))
        self._trace_lock = Lock()
        self._dispatch_lock = Lock()
        self._active_facts = ledger.snapshot()
        self._trace: list[dict] = []

    @property
    def snapshot(self) -> dict:
        facts = self._ledger.snapshot()
        state = self._controller.snapshot
        with self._trace_lock:
            state.update(fact_revision=facts["revision"], case_id=facts["case_id"], guard_trace=deepcopy(self._trace))
        return state

    @property
    def trace(self) -> tuple[dict, ...]:
        with self._trace_lock:
            return tuple(deepcopy(self._trace))

    def _finish(self, reply: dict, parsed: Any, facts: dict, expected_revision: Any,
                gate: str, before_attempts: int) -> dict:
        original = parsed if type(parsed) is dict else {}
        result = deepcopy(reply)
        result.update(proposal=deepcopy(original.get("proposal")),
                      proposal_canonical=deepcopy(original.get("canonical")), raw=original.get("raw"),
                      fact_revision=facts["revision"], expected_revision=expected_revision,
                      case_id=facts["case_id"], gate=gate,
                      executed=result["attempts"] > before_attempts)
        with self._trace_lock:
            self._trace.append({"event": "guard_dispatch", **deepcopy(result)})
        return result

    def _blocked(self, status: str, facts: dict, state: dict, error: dict,
                 canonical: dict | None = None) -> dict:
        return {"status": status, "canonical": canonical, "result": None, "error": error,
                "attempts": state["attempts"], "max_attempts": MAX_ATTEMPTS, "reused": False}

    def dispatch(self, parsed: dict, expected_revision: str,
                 tool_fn: Callable[[dict], Any] | None = None) -> dict:
        # Do not queue a simultaneous request into a later implicit retry after
        # a timeout. The original controller exposes IN_PROGRESS in that case.
        if not self._dispatch_lock.acquire(blocking=False):
            with self._trace_lock:
                facts = deepcopy(self._active_facts)
            state = self._controller.snapshot
            reply = self._blocked("IN_PROGRESS", facts, state,
                                  {"code": "tool_in_progress", "message": "A guarded dispatch is already running"})
            return self._finish(reply, parsed, facts, expected_revision, "IN_PROGRESS", state["attempts"])
        try:
            return self._dispatch_locked(parsed, expected_revision, tool_fn)
        finally:
            self._dispatch_lock.release()

    def _dispatch_locked(self, parsed: dict, expected_revision: str,
                         tool_fn: Callable[[dict], Any] | None = None) -> dict:
        # This exact lock is used by every ledger update. It remains held while
        # the original controller invokes the tool, including injected tools.
        with self._ledger.execution_snapshot() as facts:
            with self._trace_lock:
                self._active_facts = deepcopy(facts)
            state = self._controller.snapshot
            before = state["attempts"]
            if self._preflight["error"]:
                reply = self._blocked("REJECTED", facts, state, self._preflight["error"])
                return self._finish(reply, parsed, facts, expected_revision, "TERMINAL", before)
            if state["attempts"] >= MAX_ATTEMPTS and not state["completed"]:
                reply = self._blocked("EXHAUSTED", facts, state,
                                      {"code": "attempts_exhausted", "message": "The hard limit of two attempts has been reached"}, canonical_failure())
                return self._finish(reply, parsed, facts, expected_revision, "TERMINAL", before)
            try:
                proposal = _validated(parsed)
            except ProtocolError:
                reply = self._controller.dispatch(parsed, tool_fn)
                return self._finish(reply, parsed, facts, expected_revision, "PASSTHROUGH", before)
            if proposal["action"] == "ask_user":
                reply = self._controller.dispatch(parsed, tool_fn)
                return self._finish(reply, parsed, facts, expected_revision, "PASSTHROUGH", before)
            if type(expected_revision) is not str or expected_revision != facts["revision"]:
                reply = self._blocked("STALE_FACTS", facts, state,
                                      {"code": "stale_facts", "message": "Refresh the current fact snapshot and obtain a new proposal before calculation"},
                                      verification_canonical(facts))
                return self._finish(reply, parsed, facts, expected_revision, "STALE_FACTS", before)
            if not facts["eligible"]:
                reply = self._blocked("BLOCKED_FACTS", facts, state,
                                      {"code": "blocked_facts", "message": "Every field must be confirmed for the current period before calculation",
                                       "unresolved": {field: facts["fields"][field]["status"] for field in FIELDS if facts["fields"][field]["status"] != "confirmed"}},
                                      verification_canonical(facts))
                return self._finish(reply, parsed, facts, expected_revision, "BLOCKED_FACTS", before)
            fields = facts["fields"]
            args = proposal["arguments"]
            expected = {"period_start": fields["period"]["value"]["start"],
                        "period_end": fields["period"]["value"]["end"],
                        "due": Decimal(fields["agreed_due_total"]["value"]),
                        "paid": Decimal(fields["wage_paid_total"]["value"])}
            mismatches = [key for key in ("period_start", "period_end") if args[key] != expected[key]]
            mismatches += [key for key in ("due", "paid") if Decimal(str(args[key])) != expected[key]]
            if mismatches:
                reply = self._blocked("ARGUMENT_MISMATCH", facts, state,
                                      {"code": "argument_mismatch", "message": "Tool arguments must exactly match the confirmed facts; values were not rewritten", "fields": mismatches})
                return self._finish(reply, parsed, facts, expected_revision, "ARGUMENT_MISMATCH", before)
            try:
                reply = self._controller.dispatch(parsed, tool_fn)
            except BaseException as exc:
                # v2 records the consumed attempt and rethrows cancellation.
                # Preserve its fact revision before unwinding the ledger lock.
                interrupted_state = self._controller.snapshot
                with self._trace_lock:
                    self._trace.append({"event": "guard_dispatch_interrupted", "fact_revision": facts["revision"],
                                        "case_id": facts["case_id"], "expected_revision": expected_revision,
                                        "proposal": deepcopy(proposal), "gate": "ALLOWED",
                                        "attempts": interrupted_state["attempts"],
                                        "executed": interrupted_state["attempts"] > before,
                                        "exception_type": type(exc).__name__})
                raise
            return self._finish(reply, parsed, facts, expected_revision, "ALLOWED", before)
