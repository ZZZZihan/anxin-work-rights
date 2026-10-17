#!/usr/bin/env python3
"""Independent contract checks for this author's synthetic v3 holdout.

This validator reads only files in its own author directory and the public v3
contract when hashing is requested. It does not import the model evaluator or
the ledger/gate implementation. Semantic source review remains a separate task.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
FIELDS = ("period", "agreed_due_total", "wage_paid_total")
SOURCE_KEYS = {"id", "kind", "text", "sha256"}
EVENT_KEYS = {"id", "field", "status", "value", "scope", "meaning", "complete", "supersedes", "refs"}
REF_KEYS = {"source_id", "start", "end", "quote"}
MONEY = re.compile(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?\Z")
DATE_TOKEN = re.compile(r"(?<![0-9-])[0-9]{4}-[0-9]{2}-[0-9]{2}(?![0-9-])")
MONEY_TOKEN = re.compile(r"(?<![0-9.\-])((?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?)(?![0-9.])\s*元")


def ensure(condition, message):
    if not condition:
        raise AssertionError(message)


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        ensure(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def read(name):
    result = []
    for line_no, line in enumerate((ROOT / name).read_text(encoding="utf-8").splitlines(), 1):
        ensure(bool(line.strip()), f"{name}:{line_no}: blank line")
        result.append(json.loads(line, object_pairs_hook=no_duplicates,
                                 parse_constant=lambda s: (_ for _ in ()).throw(ValueError(s))))
    return result


def legal_value(field, value):
    if field == "period":
        ensure(type(value) is dict and set(value) == {"start", "end"}, "period value shape")
        for item in value.values():
            ensure(type(item) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", item), "period date syntax")
            date.fromisoformat(item)
        ensure(value["start"] <= value["end"], "period start after end")
    else:
        ensure(type(value) is str and MONEY.fullmatch(value), "amount must be an ordinary nonnegative decimal string")
        ensure(Decimal(value) <= Decimal("999999999999.99"), "amount exceeds contract upper bound")


def supported(field, value, quotes):
    if field == "period":
        dates = {item for quote in quotes for item in DATE_TOKEN.findall(quote)}
        ensure(value["start"] in dates and value["end"] in dates, "period literal not supported by required source quote")
    else:
        amounts = {Decimal(item) for quote in quotes for item in MONEY_TOKEN.findall(quote)}
        ensure(Decimal(value) in amounts, "amount literal not supported by required source quote")


def inspect(row):
    ensure(set(row) == {"id", "messages", "tool_state", "fact_bundle"}, "input keys are not strict")
    ensure(type(row["id"]) is str and bool(row["id"]), "id")
    ensure(type(row["messages"]) is list and row["messages"], "messages")
    for message in row["messages"]:
        ensure(set(message) == {"role", "content"}, "message shape")
        ensure(message["role"] in {"user", "assistant"} and type(message["content"]) is str and message["content"], "message value")
    state = row["tool_state"]
    if state is not None:
        ensure(set(state) == {"status", "attempts", "max_attempts"}, "tool state shape")
        ensure(state["status"] == "TIMEOUT" and type(state["attempts"]) is int and state["attempts"] in {1, 2} and type(state["max_attempts"]) is int and state["max_attempts"] == 2, "tool state value")
    bundle = row["fact_bundle"]
    ensure(set(bundle) == {"case_id", "sources", "events"}, "bundle shape")
    ensure(bundle["case_id"] == row["id"], "bundle case id")
    sources = {}
    for source in bundle["sources"]:
        ensure(set(source) == SOURCE_KEYS, "source shape")
        sid = source["id"]
        ensure(type(sid) is str and sid and sid not in sources, "source id uniqueness")
        ensure(source["kind"] in {"confirmation", "evidence"}, "source channel")
        ensure(type(source["text"]) is str and bool(source["text"]), "source text")
        ensure(source["sha256"] == hashlib.sha256(source["text"].encode("utf-8")).hexdigest(), "source text hash mismatch")
        sources[sid] = source
    latest, events = {}, {}
    current_period = None
    for event in bundle["events"]:
        ensure(set(event) == EVENT_KEYS, "event shape")
        eid, field, status = event["id"], event["field"], event["status"]
        ensure(type(eid) is str and eid and eid not in events, "event id uniqueness")
        ensure(field in FIELDS and status in {"unknown", "candidate", "confirmed", "conflict"}, "event field/status")
        ensure(type(event["complete"]) is bool, "complete is not bool")
        ensure(event["supersedes"] == (latest[field]["id"] if field in latest else None), "supersedes must refer to immediately previous event for this field")
        if field == "period":
            ensure(event["scope"] is None and event["meaning"] == "period" and event["complete"] is True, "period event semantics")
        else:
            ensure(event["scope"] == current_period, "amount scope is not the then-current period event")
            ensure(event["meaning"] in {"period_wage_total", "monthly_rate", "mixed_payment", "unattributed_payment"}, "amount meaning")
            if status == "confirmed":
                ensure(event["meaning"] == "period_wage_total" and event["complete"] is True, "confirmed amount must be a complete period wage total")
        if status == "unknown":
            ensure(event["value"] is None, "unknown must be null")
            values = []
        elif status == "conflict":
            values = event["value"]
            ensure(type(values) is list and len(values) >= 2, "conflict needs at least two values")
            for value in values:
                legal_value(field, value)
            canonical = [json.dumps(v, sort_keys=True) if field == "period" else Decimal(v) for v in values]
            ensure(len(set(canonical)) == len(canonical), "conflict values must actually differ")
        else:
            values = [event["value"]]
            legal_value(field, event["value"])
        ensure(type(event["refs"]) is list and event["refs"], "empty refs")
        quotes, confirmations = [], []
        for ref in event["refs"]:
            ensure(set(ref) == REF_KEYS and ref["source_id"] in sources, "ref shape/source")
            source = sources[ref["source_id"]]
            ensure(type(ref["start"]) is int and type(ref["end"]) is int and 0 <= ref["start"] < ref["end"] <= len(source["text"]), "ref indexes")
            ensure(type(ref["quote"]) is str and source["text"][ref["start"]:ref["end"]] == ref["quote"], "ref quote mismatch")
            quotes.append(ref["quote"])
            if source["kind"] == "confirmation":
                confirmations.append(ref["quote"])
        if status == "confirmed":
            ensure(confirmations, "confirmed event lacks controlled confirmation reference")
        for value in values:
            supported(field, value, quotes)
            if status == "confirmed":
                supported(field, value, confirmations)
        events[eid] = event
        latest[field] = event
        if field == "period":
            current_period = eid
    snapshot = {}
    for field in FIELDS:
        event = latest.get(field)
        status = "unknown" if event is None else event["status"]
        if event is not None and field != "period" and event["scope"] != current_period:
            status = "stale"
        snapshot[field] = {"status": status, "event": event}
    return snapshot


def check_gold(row, label, snapshot):
    ensure(set(label) == {"id", "group_id", "category", "expected", "rationale"}, "label shape")
    ensure(row["id"] == label["id"] and label["rationale"], "label id/rationale")
    exp = label["expected"]
    ensure(set(exp) == {"missing", "conflicts", "next_action"}, "expected shape")
    action = exp["next_action"]
    ensure(set(action) == {"type", "questions", "tool", "arguments"}, "next_action shape")
    state = row["tool_state"]
    terminal = state is not None and state["attempts"] == state["max_attempts"]
    missing = [field for field in FIELDS if snapshot[field]["status"] in {"unknown", "candidate", "stale"}]
    conflicts = [field for field in FIELDS if snapshot[field]["status"] == "conflict"]
    if terminal:
        ensure(exp["missing"] == [] and exp["conflicts"] == [], "terminal fields must be empty")
        ensure(action == {"type": "report_tool_failure", "questions": [], "tool": None, "arguments": None}, "terminal action")
        return
    ensure(exp["missing"] == missing and exp["conflicts"] == conflicts, "gold unresolved-field lists differ from contract snapshot")
    if missing or conflicts:
        ensure(action["type"] == "ask_user" and action["tool"] is None and action["arguments"] is None, "unresolved facts require ask_user")
        ensure(type(action["questions"]) is list and action["questions"], "ask must have questions")
        fields = []
        for question in action["questions"]:
            ensure(set(question) == {"field", "text"} and type(question["text"]) is str and question["text"], "question shape")
            fields.append(question["field"])
        ensure(fields == [f for f in FIELDS if f in missing or f in conflicts], "questions must cover exactly all unresolved fields")
    else:
        ensure(action["type"] == "call_tool" and action["questions"] == [] and action["tool"] == "calculate_wage_gap", "eligible facts require tool call")
        args = action["arguments"]
        ensure(type(args) is dict and set(args) == {"period_start", "period_end", "due", "paid"}, "tool arguments shape")
        period = snapshot["period"]["event"]["value"]
        ensure(args["period_start"] == period["start"] and args["period_end"] == period["end"], "tool period differs from confirmed current period")
        for key, field in (("due", "agreed_due_total"), ("paid", "wage_paid_total")):
            ensure(type(args[key]) in {int, float} and math.isfinite(args[key]) and args[key] >= 0, "tool amount must be finite nonnegative JSON number")
            ensure(Decimal(str(args[key])) == Decimal(snapshot[field]["event"]["value"]), "tool amount differs from confirmed total")


def check_provenance(row, provenance, snapshot):
    ensure(provenance["id"] == row["id"] and provenance["synthetic"] is True, "provenance id/synthetic")
    ensure(all(provenance[key] is False for key in ("real_user_confirmation", "real_evidence", "expert_annotation")), "synthetic boundary lost")
    ensure(set(provenance["field_origins"]) == set(FIELDS) and set(provenance["current_field_status"]) == set(FIELDS), "per-field provenance completeness")
    events = {event["id"]: event for event in row["fact_bundle"]["events"]}
    origin_ids = []
    for field in FIELDS:
        ensure(provenance["current_field_status"][field]["effective_status"] == snapshot[field]["status"], "provenance effective state")
        for origin in provenance["field_origins"][field]:
            event = events[origin["event_id"]]
            ensure(origin["field"] == field == event["field"], "provenance field")
            for suffix in ("status", "value", "scope", "meaning", "complete", "supersedes"):
                ensure(origin[f"{suffix}_in_input"] == event[suffix], "provenance event state mismatch")
            ensure(origin["synthetic_origin"] and origin["support"], "provenance explanation missing")
            origin_ids.append(origin["event_id"])
    ensure(set(origin_ids) == set(events) and len(origin_ids) == len(events), "every event must have exactly one field provenance record")


def main():
    inputs, labels, provenance = read("test.inputs.jsonl"), read("test.labels.jsonl"), read("test.provenance.jsonl")
    pairs = read("pair_index.jsonl")
    ensure(len(inputs) == len(labels) == len(provenance) == 72, "row count must be exactly 72")
    ensure(len(pairs) == 36, "group count must be exactly 36")
    keyed = []
    for name, rows in (("inputs", inputs), ("labels", labels), ("provenance", provenance)):
        ensure(len({r["id"] for r in rows}) == len(rows), f"{name} duplicate id")
        keyed.append({r["id"]: r for r in rows})
    input_by_id, labels_by_id, provenance_by_id = keyed
    ensure(set(input_by_id) == set(labels_by_id) == set(provenance_by_id), "id sets differ")
    ensure([r["id"] for r in inputs] == [r["id"] for r in labels] == [r["id"] for r in provenance], "file ordering differs")
    groups, outcomes, states, signs, fact_status = defaultdict(list), Counter(), Counter(), Counter(), Counter()
    exact_inputs = set()
    for row in inputs:
        label, prov = labels_by_id[row["id"]], provenance_by_id[row["id"]]
        snapshot = inspect(row)
        check_gold(row, label, snapshot)
        check_provenance(row, prov, snapshot)
        groups[label["group_id"]].append(row["id"])
        outcomes[label["expected"]["next_action"]["type"]] += 1
        states["none" if row["tool_state"] is None else f"timeout_{row['tool_state']['attempts']}_of_2"] += 1
        fact_status.update(info["status"] for info in snapshot.values())
        if label["expected"]["next_action"]["type"] == "call_tool":
            args = label["expected"]["next_action"]["arguments"]
            gap = Decimal(str(args["due"])) - Decimal(str(args["paid"]))
            signs["negative" if gap < 0 else "zero" if gap == 0 else "positive"] += 1
        canonical = json.dumps({k: v for k, v in row.items() if k != "id"}, sort_keys=True, ensure_ascii=False)
        ensure(canonical not in exact_inputs, "duplicate full input")
        exact_inputs.add(canonical)
    ensure(outcomes == {"call_tool": 26, "ask_user": 38, "report_tool_failure": 8}, "action allocation drift")
    ensure(states == {"none": 32, "timeout_1_of_2": 32, "timeout_2_of_2": 8}, "state allocation drift")
    ensure(len(groups) == 36 and all(len(ids) == 2 for ids in groups.values()), "not 36 complete pairs")
    for pair in pairs:
        ensure(pair["group_id"] in groups and set(pair["ids"]) == set(groups[pair["group_id"]]), "pair index ids differ")
        ensure(pair["business_change"], "business contrast explanation missing")
        ensure(all(labels_by_id[i]["category"] == pair["category"] for i in pair["ids"]), "pair category differs")
    result = {"status": "PASS", "rows": 72, "groups": 36, "actions": dict(outcomes),
              "tool_states": dict(states), "call_gap_signs": dict(signs),
              "effective_field_statuses": dict(fact_status),
              "checks": ["strict_schema", "source_hashes", "unicode_spans", "standalone_literals", "confirmation_literal_support", "append_only_lineage", "scope_lifecycle", "gold_vs_contract", "per_field_provenance", "counts_and_pairs"],
              "limits": ["Does not prove source authenticity or real confirmation", "Does not replace independent semantic label review", "Does not read historical data or perform historical deduplication", "Does not evaluate any model or training"]}
    (ROOT / "validation.author.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("status", "rows", "groups", "actions", "tool_states")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
