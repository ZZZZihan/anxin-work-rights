"""Strict, deterministic parsing of the two model-facing decision proposals.

This module does not inspect messages, labels, or tool state and never repairs
meaning. Its canonical output is the frozen v1 decision shape.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal, InvalidOperation
import json
import math
import re
from typing import Any

FIELDS = frozenset({"period", "agreed_due_total", "wage_paid_total"})
TOOL = "calculate_wage_gap"
MAX_RAW_CHARS = 32_768
MAX_NUMBER_CHARS = 128
MAX_EXPANDED_DIGITS = 256
_WHOLE_FENCE = re.compile(
    r"\A[ \t\r\n]*```(?:json)?[ \t]*\r?\n(?P<body>[\s\S]*?)\r?\n```[ \t\r\n]*\Z"
)


class ProtocolError(ValueError):
    def __init__(self, code: str, message: str, path: str = "$") -> None:
        super().__init__(message)
        self.detail = {"code": code, "message": message, "path": path}


def _fail(code: str, message: str, path: str = "$") -> None:
    raise ProtocolError(code, message, path)


def _pairs(pairs: list[tuple[str, Any]]) -> dict:
    obj: dict = {}
    for key, value in pairs:
        if key in obj:
            _fail("duplicate_json_key", f"Duplicate JSON key: {key}")
        obj[key] = value
    return obj


def _number(token: str) -> Decimal:
    if len(token) > MAX_NUMBER_CHARS:
        _fail("numeric_representation_too_large", "JSON number token is too long")
    try:
        value = Decimal(token)
    except InvalidOperation:
        _fail("invalid_number", "Invalid decimal number")
    if not value.is_finite():
        _fail("nonfinite_number", "Money must be finite")
    # Bound expansion before int conversion or arithmetic. A short exponent such
    # as 1e999999999 must not allocate an enormous integer or decimal string.
    if abs(value.as_tuple().exponent) > MAX_EXPANDED_DIGITS or value.adjusted() >= MAX_EXPANDED_DIGITS:
        _fail("numeric_representation_too_large", "Expanded JSON number is too large")
    return value


def _constant(token: str) -> None:
    _fail("nonfinite_number", f"Non-standard JSON number is forbidden: {token}")


def _loads(raw: str) -> Any:
    return json.loads(raw, object_pairs_hook=_pairs, parse_int=_number,
                      parse_float=_number, parse_constant=_constant)


def _keys(value: Any, expected: set[str], path: str) -> dict:
    if type(value) is not dict:
        _fail("invalid_object", "Expected an object", path)
    if set(value) != expected:
        _fail("invalid_keys", f"Required keys are exactly: {', '.join(sorted(expected))}", path)
    return value


def _money(value: Any, path: str) -> int | float:
    # This also validates native dictionaries defensively at the dispatch boundary.
    if type(value) not in (int, float, Decimal):
        _fail("invalid_money_type", "Money must be a JSON number, not a boolean or string", path)
    if isinstance(value, float) and not math.isfinite(value):
        _fail("nonfinite_number", "Money must be finite", path)
    # Native ints may be an exact expansion of an allowed exponent token. Do
    # not apply the raw-token length cap again to that expanded representation.
    if type(value) is int and value.bit_length() > MAX_EXPANDED_DIGITS * 4:
        _fail("numeric_representation_too_large", "Expanded money number is too large", path)
    number = value if isinstance(value, Decimal) else Decimal(value) if type(value) is int else Decimal(str(value))
    if not number.is_finite():
        _fail("nonfinite_number", "Money must be finite", path)
    if number < 0:
        _fail("negative_money", "Due and paid must be nonnegative", path)
    if number.as_tuple().exponent < -2:
        _fail("money_precision", "Money may have at most two decimal places", path)
    if abs(number.as_tuple().exponent) > MAX_EXPANDED_DIGITS or number.adjusted() >= MAX_EXPANDED_DIGITS:
        _fail("numeric_representation_too_large", "Expanded money number is too large", path)
    if number == number.to_integral_value():
        return int(number)
    native = float(number)
    if not math.isfinite(native) or Decimal(str(native)) != number:
        _fail("unsupported_numeric_precision", "Number cannot be represented without changing its value", path)
    return native


def _date(value: Any, path: str) -> dt.date:
    if type(value) is not str or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None:
        _fail("invalid_date", "Date must have the exact YYYY-MM-DD form", path)
    try:
        parsed = dt.date.fromisoformat(value)
    except ValueError:
        _fail("invalid_date", "Date is not a real calendar date", path)
    return parsed


def canonical_failure() -> dict:
    """The program-owned terminal decision; never an accepted model proposal."""
    return {"missing": [], "conflicts": [], "next_action": {
        "type": "report_tool_failure", "questions": [], "tool": None, "arguments": None}}


def validate_proposal(proposal: Any) -> tuple[dict, dict]:
    """Return fresh validated proposal and canonical dictionaries, or raise.

    Public dispatch reuses this check and recomputes canonical data instead of
    trusting a caller-supplied accepted flag or canonical decision.
    """
    if type(proposal) is not dict:
        _fail("invalid_object", "Proposal must be an object")
    action = proposal.get("action")
    if type(action) is not str or action not in {"ask_user", "call_tool"}:
        _fail("invalid_action", "Model action must be ask_user or call_tool", "$.action")
    if action == "ask_user":
        _keys(proposal, {"action", "questions"}, "$")
        questions = proposal["questions"]
        if type(questions) is not list or not questions:
            _fail("invalid_questions", "ask_user requires at least one question", "$.questions")
        if len(questions) > len(FIELDS):
            _fail("duplicate_question_field", "Only one question per field is permitted", "$.questions")
        seen: set[str] = set()
        normalized: list[dict] = []
        missing: list[str] = []
        conflicts: list[str] = []
        for index, item in enumerate(questions):
            path = f"$.questions[{index}]"
            q = _keys(item, {"field", "reason", "text"}, path)
            if type(q["field"]) is not str or q["field"] not in FIELDS:
                _fail("invalid_question_field", "Unknown question field", path + ".field")
            if q["field"] in seen:
                _fail("duplicate_question_field", "Only one question per field is permitted", path + ".field")
            if type(q["reason"]) is not str or q["reason"] not in {"missing", "conflict"}:
                _fail("invalid_question_reason", "Question reason must be missing or conflict", path + ".reason")
            if type(q["text"]) is not str or not q["text"].strip():
                _fail("invalid_question_text", "Question text must be nonempty", path + ".text")
            seen.add(q["field"])
            normalized.append(dict(q))
            (missing if q["reason"] == "missing" else conflicts).append(q["field"])
        result = {"action": action, "questions": normalized}
        canonical = {"missing": missing, "conflicts": conflicts, "next_action": {
            "type": action, "questions": [{"field": q["field"], "text": q["text"]} for q in normalized],
            "tool": None, "arguments": None}}
        return result, canonical

    _keys(proposal, {"action", "tool", "arguments"}, "$")
    if type(proposal["tool"]) is not str or proposal["tool"] != TOOL:
        _fail("invalid_tool", "Only calculate_wage_gap is allowed", "$.tool")
    args = _keys(proposal["arguments"], {"period_start", "period_end", "due", "paid"}, "$.arguments")
    start = _date(args["period_start"], "$.arguments.period_start")
    end = _date(args["period_end"], "$.arguments.period_end")
    if start > end:
        _fail("reversed_period", "Period start must not be after period end", "$.arguments")
    normalized_args = {"period_start": args["period_start"], "period_end": args["period_end"],
                       "due": _money(args["due"], "$.arguments.due"),
                       "paid": _money(args["paid"], "$.arguments.paid")}
    result = {"action": action, "tool": TOOL, "arguments": normalized_args}
    canonical = {"missing": [], "conflicts": [], "next_action": {
        "type": action, "questions": [], "tool": TOOL, "arguments": dict(normalized_args)}}
    return result, canonical


def parse_proposal(raw: str) -> dict:
    """Parse one complete response, with at most whole-response fence removal.

    strict_json describes the original response's JSON syntax, independently of
    schema acceptance. raw is retained exactly, and every normalization is logged.
    All returned structures are directly JSON serializable.
    """
    answer = {"accepted": False, "strict_json": False, "normalization": [],
              "proposal": None, "canonical": None, "error": None,
              "raw": raw if isinstance(raw, str) else None}
    if type(raw) is not str:
        answer["error"] = {"code": "invalid_raw_type", "message": "Raw output must be a string", "path": "$"}
        return answer
    if len(raw) > MAX_RAW_CHARS:
        answer["error"] = {"code": "response_too_large", "message": "Raw output exceeds the character limit", "path": "$"}
        return answer
    source = raw
    fence = _WHOLE_FENCE.fullmatch(raw)
    if fence:
        source = fence.group("body")
        answer["normalization"].append("remove_whole_response_json_fence")
    try:
        obj = _loads(source)
        answer["strict_json"] = fence is None
        proposal, canonical = validate_proposal(obj)
        answer.update(accepted=True, proposal=proposal, canonical=canonical)
    except ProtocolError as exc:
        answer["error"] = exc.detail
    except (ValueError, TypeError, RecursionError) as exc:
        answer["error"] = {"code": "invalid_json", "message": f"Invalid JSON ({type(exc).__name__})", "path": "$"}
    return answer
