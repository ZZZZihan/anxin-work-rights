"""Trusted, in-process tool state and bounded Decimal arithmetic dispatch.

No user/assistant text is parsed for state. This controller deliberately provides
neither durable state nor distributed idempotency or a wall-clock timeout engine.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, localcontext
from threading import Lock
from typing import Any, Callable

from protocol import ProtocolError, TOOL, canonical_failure, parse_proposal, validate_proposal

MAX_ATTEMPTS = 2


def preflight(tool_state: Any) -> dict:
    """Check trusted program data before a runner makes any model request."""
    if tool_state is None:
        return {"allow_model": True, "canonical": None, "error": None}
    valid = (type(tool_state) is dict
             and set(tool_state) == {"status", "attempts", "max_attempts"}
             and type(tool_state["status"]) is str and tool_state["status"] == "TIMEOUT"
             and type(tool_state["attempts"]) is int and tool_state["attempts"] in (1, 2)
             and type(tool_state["max_attempts"]) is int and tool_state["max_attempts"] == MAX_ATTEMPTS)
    if not valid:
        return {"allow_model": False, "canonical": None, "error": {
            "code": "invalid_tool_state", "message": "Trusted tool_state must be null or exact TIMEOUT state with attempts 1 or 2 and max_attempts 2"}}
    if tool_state["attempts"] == MAX_ATTEMPTS:
        return {"allow_model": False, "canonical": canonical_failure(), "error": None}
    return {"allow_model": True, "canonical": None, "error": None}


def _expected_result(args: dict) -> dict:
    """Pure arithmetic used independently to check a tool return value."""
    due, paid = Decimal(str(args["due"])), Decimal(str(args["paid"]))
    # A wider context is necessary even when input integer tokens are exact.
    with localcontext() as ctx:
        ctx.prec = max(28, max(due.adjusted(), paid.adjusted(), 0) + 4)
        gap = due - paid
    if gap == 0:
        gap = Decimal(0)
    return {"period_start": args["period_start"], "period_end": args["period_end"],
            "due": format(due, ".2f"), "paid": format(paid, ".2f"), "gap": format(gap, ".2f")}


def calculate_wage_gap(arguments: dict) -> dict:
    """Real local arithmetic only; no legal conclusion, database, or network."""
    checked, _ = validate_proposal({"action": "call_tool", "tool": TOOL, "arguments": arguments})
    return _expected_result(checked["arguments"])


class _ToolResultError(ValueError):
    pass


def _validate_result(result: Any, arguments: dict) -> dict:
    expected = _expected_result(arguments)
    if type(result) is not dict or set(result) != set(expected):
        raise _ToolResultError("Tool result must have exactly period_start, period_end, due, paid and gap")
    if any(type(value) is not str for value in result.values()) or result != expected:
        raise _ToolResultError("Tool result must match the exact two-decimal arithmetic result and period")
    return deepcopy(result)


class ToolController:
    """One session, one argument identity, and at most two explicit attempts.

    tool_fn receives a copy of validated arguments. It must raise TimeoutError
    for a timeout or another Exception for failure. It is called once at most per
    dispatch. A separate dispatch is required to retry a failed first attempt.
    """

    def __init__(self, tool_state: Any = None) -> None:
        self._lock = Lock()
        state = deepcopy(tool_state)
        self._preflight = preflight(state)
        valid_state = self._preflight["error"] is None and state is not None
        self._attempts = state["attempts"] if valid_state else 0
        self._status = ("INVALID_STATE" if self._preflight["error"] else
                        "EXHAUSTED" if self._attempts == MAX_ATTEMPTS else
                        "TIMEOUT" if self._attempts else "READY")
        self._arguments: dict | None = None
        self._in_flight = False
        self._success: dict | None = None
        self._trace: list[dict] = []
        self._trace.append({"event": "initialized", "status": self._status, "attempts": self._attempts})

    @property
    def snapshot(self) -> dict:
        with self._lock:
            return deepcopy({"status": self._status, "attempts": self._attempts,
                             "max_attempts": MAX_ATTEMPTS, "arguments": self._arguments,
                             "in_flight": self._in_flight, "completed": self._success is not None,
                             "trace": self._trace})

    @property
    def trace(self) -> tuple[dict, ...]:
        with self._lock:
            return tuple(deepcopy(self._trace))

    def _reply(self, status: str, canonical: dict | None = None, result: Any = None,
               error: dict | None = None, reused: bool = False) -> dict:
        # Called while locked; every returned payload is independent of state.
        return deepcopy({"status": status, "canonical": canonical, "result": result,
                         "error": error, "attempts": self._attempts,
                         "max_attempts": MAX_ATTEMPTS, "reused": reused})

    def dispatch(self, parsed: dict, tool_fn: Callable[[dict], Any] | None = None) -> dict:
        """Revalidate, register an attempt, then invoke an allowlisted local tool."""
        try:
            if type(parsed) is not dict or parsed.get("accepted") is not True:
                raise ProtocolError("rejected_proposal", "Only an accepted parsed proposal may be dispatched")
            # Require the retained raw result and reparse it so a fabricated or
            # edited accepted dictionary cannot bypass lexical/schema checks.
            if "raw" not in parsed:
                raise ProtocolError("missing_parsed_raw", "Dispatch requires parse_proposal's retained raw response")
            reparsed = parse_proposal(parsed["raw"])
            if (not reparsed["accepted"] or reparsed["proposal"] != parsed.get("proposal")
                    or reparsed["canonical"] != parsed.get("canonical")):
                raise ProtocolError("parsed_proposal_mismatch", "Parsed proposal or canonical decision no longer matches its raw response")
            proposal, canonical = validate_proposal(parsed.get("proposal"))
        except ProtocolError as exc:
            with self._lock:
                self._trace.append({"event": "proposal_rejected", "error": exc.detail, "attempts": self._attempts})
                return self._reply("REJECTED", error=exc.detail)

        with self._lock:
            if self._preflight["error"]:
                return self._reply("REJECTED", error=self._preflight["error"])
            if self._in_flight:
                return self._reply("IN_PROGRESS", error={"code": "tool_in_progress", "message": "An attempt is already running"})
            if proposal["action"] == "call_tool" and self._arguments is not None and proposal["arguments"] != self._arguments:
                return self._reply("REJECTED", error={"code": "session_arguments_changed", "message": "A tool session cannot change its bound arguments"})
            if self._success is not None:
                if proposal["action"] != "call_tool":
                    return self._reply("REJECTED", error={"code": "session_completed", "message": "The completed session only accepts the original tool proposal"})
                self._trace.append({"event": "success_reused", "attempts": self._attempts})
                return self._reply("SUCCEEDED", canonical, self._success["result"], reused=True)
            if self._attempts >= MAX_ATTEMPTS:
                return self._reply("EXHAUSTED", canonical_failure(), error={"code": "attempts_exhausted", "message": "The hard limit of two attempts has been reached"})
            if proposal["action"] == "ask_user":
                self._trace.append({"event": "ask_user", "attempts": self._attempts})
                return self._reply("ASK_USER", canonical)
            if tool_fn is not None and not callable(tool_fn):
                return self._reply("REJECTED", error={"code": "invalid_tool_function", "message": "tool_fn must be callable"})
            arguments = deepcopy(proposal["arguments"])
            self._arguments = deepcopy(arguments)
            self._attempts += 1
            self._status = "RUNNING"
            self._in_flight = True
            self._trace.append({"event": "attempt_started", "attempts": self._attempts,
                                "tool": TOOL, "arguments": deepcopy(arguments)})

        # Never hold the lock while calling injected code. Concurrent dispatches
        # can observe RUNNING and return without consuming another attempt.
        try:
            function = calculate_wage_gap if tool_fn is None else tool_fn
            result = function(deepcopy(arguments))
            result = _validate_result(result, arguments)
        except BaseException as exc:
            timed_out = isinstance(exc, TimeoutError)
            status = "TIMEOUT" if timed_out else "ERROR"
            detail = {"code": "tool_timeout" if timed_out else
                      "tool_invalid_result" if isinstance(exc, _ToolResultError) else "tool_error",
                      "type": type(exc).__name__, "message": str(exc)}
            with self._lock:
                self._in_flight = False
                self._status = status
                self._trace.append({"event": "attempt_finished", "status": status,
                                    "attempts": self._attempts, "error": detail})
                reply = self._reply(status, canonical_failure(), error=detail)
            if not isinstance(exc, Exception):
                raise
            return reply

        with self._lock:
            self._in_flight = False
            self._status = "SUCCEEDED"
            self._success = {"result": result}
            self._trace.append({"event": "attempt_finished", "status": "SUCCEEDED", "attempts": self._attempts})
            return self._reply("SUCCEEDED", canonical, result)
