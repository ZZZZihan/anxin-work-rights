"""Predeclared paired evaluation; labels are never imported by inference."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import statistics

from legacy import common, evaluation, diagnostics
from protocol import parse_proposal
from tool_control import preflight, calculate_wage_gap


def execution_valid(record, parsed, result):
    if not parsed["accepted"]:
        return False
    dispatch = result.get("dispatch")
    if not isinstance(dispatch, dict):
        return False
    initial = record["tool_state"]["attempts"] if record["tool_state"] else 0
    action = parsed["proposal"]["action"]
    expected_attempts = initial + int(action == "call_tool")
    if (dispatch.get("canonical") != parsed["canonical"] or dispatch.get("error") is not None
            or type(dispatch.get("attempts")) is not int or dispatch["attempts"] != expected_attempts
            or dispatch.get("max_attempts") != 2 or expected_attempts > 2
            or dispatch.get("reused") is not False):
        return False
    if action == "ask_user":
        return dispatch.get("status") == "ASK_USER" and dispatch.get("result") is None
    return (dispatch.get("status") == "SUCCEEDED" and
            dispatch.get("result") == calculate_wage_gap(parsed["proposal"]["arguments"]))


def neutral_json(raw):
    def pairs(items):
        obj = {}
        for key, value in items:
            if key in obj:
                raise ValueError("duplicate key")
            obj[key] = value
        return obj
    def constant(value):
        raise ValueError("nonfinite")
    try:
        # Syntax only: retain numeric lexemes instead of allocating enormous
        # integers or raising Decimal exponent errors. Protocols check money.
        return isinstance(json.loads(raw, object_pairs_hook=pairs, parse_float=str,
                                     parse_int=str, parse_constant=constant), dict)
    except (ValueError, TypeError, RecursionError):
        return False


def diagnostic_raw(row, variant):
    """Diagnostic extraction only, never used for execution or canonical score."""
    if not row.get("model_invoked", True):
        return json.dumps(row.get("canonical_output"))
    if variant == "v1":
        return row.get("raw_output", "")
    obj, _ = common.parse_output(row.get("raw_output", ""))
    if not isinstance(obj, dict):
        return ""
    qs = obj.get("questions", [])
    if isinstance(qs, list):
        qs = [{"field": q.get("field"), "text": q.get("text")} if isinstance(q, dict) else q for q in qs]
    return json.dumps({"next_action": {"type": obj.get("action"), "questions": qs,
        "tool": obj.get("tool"), "arguments": obj.get("arguments")}}, ensure_ascii=False)


def score_case(label, result, record, variant):
    exhausted = not preflight(record["tool_state"])["allow_model"]
    invoked = result.get("model_invoked", False) if result else False
    if variant == "v1":
        base = evaluation.score(label, result, record)
        accepted = base["contract_valid"] if invoked else False
        execution_ok = True  # v1 only replays; no claim of live dispatch.
    else:
        if exhausted and result and result.get("model_invoked") is False:
            canonical = result.get("canonical_output")
            execution_ok = canonical == preflight(record["tool_state"])["canonical"]
            accepted = None
        else:
            parsed = parse_proposal(result.get("raw_output", ""))
            canonical = parsed["canonical"]
            accepted = parsed["accepted"] if invoked else False
            execution_ok = execution_valid(record, parsed, result)
        base = evaluation.score(label, {"raw_output": json.dumps(canonical)}, record)
    candidate = diagnostics.diagnose(label, {"raw_output": diagnostic_raw(result, variant)})
    base.update(model_invoked=invoked, terminal_case=exhausted,
        raw_strict_json=neutral_json(result.get("raw_output")) if invoked else None,
        protocol_accepted=accepted, execution_ok=execution_ok,
        canonical_correct=bool(base["decision_contract_correct"] and execution_ok and bool(result)),
        raw_action_fields_correct=candidate["next_action_diagnostic_correct"] if invoked else None,
        system_action_fields_correct=candidate["next_action_diagnostic_correct"] and bool(result),
        request_error=result.get("finish_reason") == "request_error",
        missing_result=not bool(result), diagnostic_reasons=candidate["reasons"])
    # The inherited strict_json describes the canonical serialization for v2,
    # not the original response. Never expose it under a cross-arm metric name.
    base["legacy_parser_strict_json"] = base.pop("strict_json") if variant == "v1" else None
    base.pop("strict_json", None)
    return base


def aggregate(cases, results):
    by_id = {r["id"]: r for r in results}
    groups = defaultdict(list)
    cats = defaultdict(lambda: {"total": 0, "canonical_correct": 0, "raw_action_fields_correct": 0})
    for c in cases:
        groups[c["group_id"]].append(c["canonical_correct"])
        cat = cats[c["category"]]
        cat["total"] += 1
        cat["canonical_correct"] += int(c["canonical_correct"])
        cat["raw_action_fields_correct"] += int(c["raw_action_fields_correct"] is True)
    invoked = [c for c in cases if c["model_invoked"]]
    lat = [by_id[c["id"]]["latency_seconds"] for c in invoked if "latency_seconds" in by_id[c["id"]]]
    return {"planned": len(cases), "model_calls": len(invoked),
        "program_bypass": sum(not c["model_invoked"] and not c["missing_result"] for c in cases),
        "missing_results": sum(c["missing_result"] for c in cases),
        "request_errors": sum(c["request_error"] for c in cases),
        "raw_strict_json": sum(c["raw_strict_json"] is True for c in invoked),
        "protocol_accepted": sum(c["protocol_accepted"] is True for c in invoked),
        "canonical_correct": sum(c["canonical_correct"] for c in cases),
        "raw_action_fields_correct": sum(c["raw_action_fields_correct"] is True for c in cases),
        "system_action_fields_correct": sum(c["system_action_fields_correct"] for c in cases),
        "premature_calls": sum(c["premature_tool_call"] for c in cases),
        "all_correct_complete_pairs": sum(all(v) for v in groups.values() if len(v) == 2),
        "complete_pairs": sum(len(v) == 2 for v in groups.values()),
        "singleton_groups": sum(len(v) == 1 for v in groups.values()), "groups": len(groups),
        "by_category": dict(cats),
        "model_latency_seconds": {"median": statistics.median(lat) if lat else None, "sum": sum(lat),
            "excludes_model_loading_and_program_bypass": True},
        "question_semantics": "requires independent blind text review"}


def evaluate(inputs_path, labels_path, run_dir):
    inputs, labels = common.read_jsonl(inputs_path), common.read_jsonl(labels_path)
    protocol = json.loads((run_dir / "protocol.json").read_text())
    ids = [r["id"] for r in inputs]
    if len(set(ids)) != len(ids) or len({r["id"] for r in labels}) != len(labels) or set(ids) != {r["id"] for r in labels}:
        raise ValueError("Dataset IDs invalid")
    if protocol["case_ids"] != ids or protocol["inputs_sha256"] != common.sha(inputs_path):
        raise ValueError("Planned input mismatch; cannot silently score a subset")
    results = common.read_jsonl(run_dir / "results.jsonl") if (run_dir / "results.jsonl").exists() else []
    if len({r["id"] for r in results}) != len(results) or not {r["id"] for r in results} <= set(ids):
        raise ValueError("Invalid result IDs")
    by_id, records = {r["id"]: r for r in results}, {r["id"]: r for r in inputs}
    cases = [score_case(l, by_id.get(l["id"], {}), records[l["id"]], protocol["variant"]) for l in labels]
    output = {"backend": protocol["backend"], "variant": protocol["variant"],
        "inputs_sha256": common.sha(inputs_path), "labels_sha256": common.sha(labels_path),
        "results_sha256": common.sha(run_dir / "results.jsonl") if results else None,
        "all": aggregate(cases, results),
        "nonterminal": aggregate([c for c in cases if not c["terminal_case"]], results),
        "terminal": aggregate([c for c in cases if c["terminal_case"]], results), "cases": cases}
    common.save(run_dir / "assessment.json", output)
    return output


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--run-dir", type=Path, required=True)
    args = ap.parse_args()
    report = evaluate(args.inputs, args.labels, args.run_dir)
    print(json.dumps({k: report[k] for k in ["backend", "variant", "all", "nonterminal", "terminal"]}, ensure_ascii=False, indent=2))
