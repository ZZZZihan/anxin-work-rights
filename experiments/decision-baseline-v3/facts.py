"""Append-only synthetic trusted facts; model text is never an update channel.

The caller is the trusted program boundary. A valid offline confirmation bundle
does not authenticate an internet client or prove that its evidence is true.
"""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import datetime as dt
from decimal import Decimal
import hashlib
import json
import re
from threading import RLock
from typing import Any, Iterator

FIELDS = ("period", "agreed_due_total", "wage_paid_total")
STATUSES = frozenset({"unknown", "candidate", "confirmed", "conflict"})
MONEY_MEANINGS = frozenset({"period_wage_total", "monthly_rate", "mixed_payment", "unattributed_payment"})
MAX_MONEY = Decimal("999999999999.99")
_EVENT_KEYS = {"id", "field", "status", "value", "scope", "meaning", "complete", "supersedes", "refs"}


class FactError(ValueError):
    def __init__(self, code: str, message: str, path: str = "$") -> None:
        super().__init__(message)
        self.detail = {"code": code, "message": message, "path": path}


def _fail(code: str, message: str, path: str) -> None:
    raise FactError(code, message, path)


def _keys(value: Any, expected: set[str], path: str) -> dict:
    if type(value) is not dict or set(value) != expected:
        _fail("invalid_keys", "Required object keys are exactly: " + ", ".join(sorted(expected)), path)
    return value


def _identifier(value: Any, path: str) -> str:
    if type(value) is not str or not value.strip():
        _fail("invalid_identifier", "Identifiers must be nonempty strings", path)
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        _fail("invalid_identifier", "Identifiers must encode as valid UTF-8", path)
    return value


def _date(value: Any, path: str) -> str:
    if type(value) is not str or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None:
        _fail("invalid_date", "Date must have exact YYYY-MM-DD form", path)
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        _fail("invalid_date", "Date must be a real calendar date", path)
    return value


def _value(value: Any, field: str, path: str) -> tuple[Any, list[str]]:
    """Return semantic identity plus the literal tokens requiring provenance."""
    if field == "period":
        obj = _keys(value, {"start", "end"}, path)
        start, end = _date(obj["start"], path + ".start"), _date(obj["end"], path + ".end")
        if start > end:
            _fail("reversed_period", "Period start must not follow period end", path)
        return (start, end), [start, end]
    if type(value) is not str or re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", value) is None:
        _fail("invalid_money", "Money must be a nonnegative decimal string with at most two fractional digits", path)
    number = Decimal(value)
    if number > MAX_MONEY:
        _fail("money_out_of_range", "Money exceeds 999999999999.99", path)
    return number, [value]


def _has_literal(text: str, literal: str, field: str, start: int, end: int) -> bool:
    if field == "period":
        matches = re.finditer(r"(?<![\dA-Za-z_.+\-])" + re.escape(literal) + r"(?![\dA-Za-z_.+\-])", text)
        return any(start <= match.start() and match.end() <= end for match in matches)
    # Match a whole ordinary decimal currency token. The prefix boundary also
    # prevents borrowing digits from signed values, dates or exponent tokens.
    tokens = re.finditer(r"(?<![\dA-Za-z_.,+\-/−－＋])([0-9]+(?:\.[0-9]{1,2})?)\s*元", text)
    return any(start <= match.start() and match.end() <= end
               and Decimal(match.group(1)) == Decimal(literal) for match in tokens)


def validate_bundle(bundle: Any, case_id: str) -> dict:
    """Strictly validate a complete append history and return an owned copy."""
    _identifier(case_id, "$.case_id")
    # Validate an owned snapshot, so mutations to caller-owned nested objects
    # after this boundary cannot change already-validated provenance.
    obj = deepcopy(_keys(bundle, {"case_id", "sources", "events"}, "$"))
    if type(obj["case_id"]) is not str or obj["case_id"] != case_id:
        _fail("case_mismatch", "The trusted bundle must belong to this exact case", "$.case_id")
    if type(obj["sources"]) is not list or type(obj["events"]) is not list:
        _fail("invalid_history", "sources and events must be arrays", "$")
    sources: dict[str, dict] = {}
    for index, item in enumerate(obj["sources"]):
        path = f"$.sources[{index}]"
        source = _keys(item, {"id", "kind", "text", "sha256"}, path)
        identity = _identifier(source["id"], path + ".id")
        if identity in sources:
            _fail("duplicate_source", "Source ids must be unique", path + ".id")
        if type(source["kind"]) is not str or source["kind"] not in {"confirmation", "evidence"}:
            _fail("invalid_source_kind", "Source kind must be confirmation or evidence", path + ".kind")
        if type(source["text"]) is not str:
            _fail("invalid_source_text", "Source text must be a string", path + ".text")
        try:
            digest = hashlib.sha256(source["text"].encode("utf-8")).hexdigest()
        except UnicodeEncodeError:
            _fail("invalid_source_text", "Source text must encode as valid UTF-8", path + ".text")
        if type(source["sha256"]) is not str or source["sha256"] != digest:
            _fail("source_hash_mismatch", "Source SHA256 must exactly match its UTF-8 text", path + ".sha256")
        sources[identity] = source

    previous: dict[str, str] = {}
    ids: set[str] = set()
    for index, item in enumerate(obj["events"]):
        path = f"$.events[{index}]"
        event = _keys(item, _EVENT_KEYS, path)
        identity = _identifier(event["id"], path + ".id")
        if identity in ids:
            _fail("duplicate_event", "Event ids must be unique", path + ".id")
        field, status = event["field"], event["status"]
        if type(field) is not str or field not in FIELDS:
            _fail("invalid_field", "Unknown fact field", path + ".field")
        if type(status) is not str or status not in STATUSES:
            _fail("invalid_status", "Unknown fact status", path + ".status")
        if event["supersedes"] != previous.get(field) or (event["supersedes"] is not None and type(event["supersedes"]) is not str):
            _fail("invalid_supersedes", "An event must supersede its field's immediately preceding event", path + ".supersedes")
        if type(event["complete"]) is not bool:
            _fail("invalid_complete", "complete must be a boolean", path + ".complete")
        if field == "period":
            if event["scope"] is not None or event["meaning"] != "period" or event["complete"] is not True:
                _fail("invalid_period_metadata", "Period requires scope=null, meaning=period and complete=true", path)
        else:
            if event["scope"] != previous.get("period") or (event["scope"] is not None and type(event["scope"]) is not str):
                _fail("invalid_scope", "Money must reference the period event current at append time", path + ".scope")
            if type(event["meaning"]) is not str or event["meaning"] not in MONEY_MEANINGS:
                _fail("invalid_meaning", "Unknown money meaning", path + ".meaning")
            if status == "confirmed" and (event["meaning"] != "period_wage_total" or event["complete"] is not True):
                _fail("incomplete_confirmation", "Confirmed money requires the complete total for this period", path)

        literals: list[str] = []
        if status == "unknown":
            if event["value"] is not None:
                _fail("unknown_has_value", "Unknown must have value=null; unknown is not zero", path + ".value")
        elif status == "conflict":
            values = event["value"]
            if type(values) is not list or len(values) < 2:
                _fail("invalid_conflict", "Conflict requires at least two distinct legal values", path + ".value")
            identities = []
            for value_index, value in enumerate(values):
                semantic, tokens = _value(value, field, f"{path}.value[{value_index}]")
                identities.append(semantic)
                literals.extend(tokens)
            if len(set(identities)) < 2:
                _fail("invalid_conflict", "Conflict requires at least two semantically distinct values", path + ".value")
        else:
            _, literals = _value(event["value"], field, path + ".value")

        refs = event["refs"]
        if type(refs) is not list or not refs:
            _fail("invalid_refs", "Every event needs at least one source reference", path + ".refs")
        quote_contexts: list[tuple[str, int, int]] = []
        confirmation_contexts: list[tuple[str, int, int]] = []
        confirmed_channel = False
        for ref_index, item_ref in enumerate(refs):
            ref_path = f"{path}.refs[{ref_index}]"
            ref = _keys(item_ref, {"source_id", "start", "end", "quote"}, ref_path)
            if type(ref["source_id"]) is not str or ref["source_id"] not in sources:
                _fail("unknown_source", "Reference must identify a known immutable source", ref_path + ".source_id")
            source = sources[ref["source_id"]]
            start, end, quote = ref["start"], ref["end"], ref["quote"]
            if (type(start) is not int or type(end) is not int or not 0 <= start < end <= len(source["text"])
                    or type(quote) is not str or quote != source["text"][start:end]):
                _fail("invalid_quote", "Reference must exactly match a nonempty Unicode-indexed source slice", ref_path)
            quote_contexts.append((source["text"], start, end))
            confirmed_channel |= source["kind"] == "confirmation"
            if source["kind"] == "confirmation":
                confirmation_contexts.append((source["text"], start, end))
        if status == "confirmed" and not confirmed_channel:
            _fail("untrusted_confirmation", "A confirmed event requires a controlled confirmation source", path + ".refs")
        supporting_contexts = confirmation_contexts if status == "confirmed" else quote_contexts
        if any(not any(_has_literal(text, literal, field, start, end) for text, start, end in supporting_contexts) for literal in literals):
            _fail("unattested_value", "Every value must appear explicitly in a referenced quote", path + ".value")
        previous[field] = identity
        ids.add(identity)
    return deepcopy(obj)


class FactLedger:
    """Owned, append-only history with a content revision and isolated snapshots.

    Only trusted application code calls update methods. Dispatch never extracts
    an update from a model proposal, message, or a document's self-description.
    """

    def __init__(self, bundle: Any, case_id: str) -> None:
        self._lock = RLock()
        self._executions = 0
        self._case_id = case_id
        self._bundle = validate_bundle(bundle, case_id)

    def _snapshot_locked(self) -> dict:
        latest = {event["field"]: event for event in self._bundle["events"]}
        period_id = latest.get("period", {}).get("id")
        fields = {}
        for field in FIELDS:
            event = latest.get(field)
            if event is None:
                fields[field] = {"status": "unknown", "value": None, "event_id": None,
                                 "scope": None, "meaning": "period" if field == "period" else "period_wage_total",
                                 "complete": field == "period", "supersedes": None, "refs": []}
                continue
            state = {key: deepcopy(event[key]) for key in ("status", "value", "scope", "meaning", "complete", "supersedes", "refs")}
            state["event_id"] = event["id"]
            state["recorded_status"] = event["status"]
            if field != "period" and event["scope"] != period_id:
                state["status"] = "stale"
            fields[field] = state
        canonical = json.dumps(self._bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        eligible = all(fields[field]["status"] == "confirmed" for field in FIELDS)
        # A confirmed period necessarily has an event id and legal dates; the
        # explicit scope/meaning checks also make eligibility self-contained.
        eligible = eligible and period_id is not None and all(
            fields[field]["scope"] == period_id and fields[field]["meaning"] == "period_wage_total"
            and fields[field]["complete"] is True for field in FIELDS[1:])
        return {"case_id": self._case_id, "revision": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
                "fields": fields, "sources": deepcopy(self._bundle["sources"]),
                "events": deepcopy(self._bundle["events"]), "eligible": bool(eligible)}

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot_locked()

    def _apply_locked(self, bundle: Any) -> dict:
        if self._executions:
            raise FactError("fact_mutation_during_execution", "Facts cannot change inside an active guarded execution")
        owned = validate_bundle(bundle, self._case_id)
        for collection in ("sources", "events"):
            old = self._bundle[collection]
            if len(owned[collection]) < len(old) or owned[collection][:len(old)] != old:
                raise FactError("history_rewrite", f"{collection} must retain the exact existing append-only prefix", "$." + collection)
        self._bundle = owned
        return self._snapshot_locked()

    def apply_bundle(self, bundle: Any) -> dict:
        with self._lock:
            return self._apply_locked(bundle)

    def append_source(self, source: dict) -> dict:
        with self._lock:
            bundle = deepcopy(self._bundle)
            bundle["sources"].append(deepcopy(source))
            return self._apply_locked(bundle)

    def append_event(self, event: dict) -> dict:
        with self._lock:
            bundle = deepcopy(self._bundle)
            bundle["events"].append(deepcopy(event))
            return self._apply_locked(bundle)

    @contextmanager
    def execution_snapshot(self) -> Iterator[dict]:
        """Hold this ledger's mutation lock through validation AND execution.

        Same-thread callbacks may read snapshots, but cannot append a revision
        while the lock is reentered. Other writers wait until execution ends.
        """
        with self._lock:
            self._executions += 1
            try:
                yield self._snapshot_locked()
            finally:
                self._executions -= 1
