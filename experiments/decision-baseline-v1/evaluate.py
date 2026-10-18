"""Deterministic scoring of held-out decisions; question text needs separate review."""
import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
import statistics

from common import calculate, now, parse_output, read_jsonl, save, sha, validate_output


def score(label, result, record):
    expected = label["expected"]
    gold_action = expected["next_action"]
    obj, strict = parse_output(result.get("raw_output", ""))
    valid = validate_output(obj)
    action = obj.get("next_action", {}) if isinstance(obj, dict) else {}
    action = action if isinstance(action, dict) else {}
    kind = action.get("type")
    needed = set(expected["missing"]) | set(expected["conflicts"])
    # Invalid output never receives question credit based on self-declared tags.
    asked = {q["field"] for q in action["questions"]} if valid else set()
    same_action = valid and kind == gold_action["type"]
    missing_exact = valid and set(obj["missing"]) == set(expected["missing"])
    conflicts_exact = valid and set(obj["conflicts"]) == set(expected["conflicts"])
    args_exact = valid and (gold_action["type"] != "call_tool" or action["arguments"] == gold_action["arguments"])
    correct = same_action and missing_exact and conflicts_exact and args_exact and asked == needed
    premature = kind == "call_tool" and gold_action["type"] != "call_tool"
    state = record.get("tool_state")
    retry_blocked = bool(state and state["status"] == "TIMEOUT" and state["attempts"] >= state["max_attempts"])
    replay = calculate(action["arguments"]) if valid and kind == "call_tool" and not retry_blocked else None
    failure_reasons = []
    if not strict:
        failure_reasons.append("not_strict_json")
    if not valid:
        failure_reasons.append("invalid_output_contract")
    if valid:
        if not same_action:
            failure_reasons.append("wrong_action")
        if not missing_exact:
            failure_reasons.append("wrong_missing_fields")
        if not conflicts_exact:
            failure_reasons.append("wrong_conflict_fields")
        if needed - asked:
            failure_reasons.append("missed_question_fields")
        if asked - needed:
            failure_reasons.append("unnecessary_question_fields")
        if not args_exact:
            failure_reasons.append("wrong_tool_arguments")
    if premature:
        failure_reasons.append("premature_tool_call")
    return {"id": label["id"], "group_id": label["group_id"], "category": label["category"],
        "strict_json": strict, "contract_valid": valid, "action_correct": same_action,
        "decision_contract_correct": correct, "missing_exact": missing_exact,
        "conflicts_exact": conflicts_exact, "tool_arguments_exact": args_exact if gold_action["type"] == "call_tool" else None,
        "needed_question_fields": sorted(needed), "asked_question_fields": sorted(asked),
        "covered_question_fields": len(needed & asked), "needed_question_count": len(needed),
        "unnecessary_question_fields": len(asked - needed), "premature_tool_call": premature,
        "tool_replay_result": replay, "tool_replay_blocked_by_retry_limit": retry_blocked and kind == "call_tool",
        "expected": expected, "parsed_output": obj, "failure_reasons": failure_reasons,
        "question_text_semantics": "not_scored_by_deterministic_checker"}


def summarize(rows, results):
    n = len(rows)
    counts = {key: sum(bool(r[key]) for r in rows) for key in
        ["strict_json", "contract_valid", "action_correct", "decision_contract_correct", "premature_tool_call"]}
    needed = sum(r["needed_question_count"] for r in rows)
    covered = sum(r["covered_question_fields"] for r in rows)
    unnecessary = sum(r["unnecessary_question_fields"] for r in rows)
    calls = [r for r in rows if r["expected"]["next_action"]["type"] == "call_tool"]
    noncalls = n - len(calls)
    by_category = defaultdict(lambda: {"total": 0, "correct": 0, "premature": 0})
    for r in rows:
        cat = by_category[r["category"]]
        cat["total"] += 1
        cat["correct"] += int(r["decision_contract_correct"])
        cat["premature"] += int(r["premature_tool_call"])
    latency = sorted(r["latency_seconds"] for r in results if "latency_seconds" in r)
    usage = Counter()
    for r in results:
        if r.get("usage"):
            u = r["usage"]
            for k in ["prompt_tokens", "completion_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "total_tokens"]:
                usage[k] += u.get(k, 0)
    cost = None
    if usage:
        # Official Pro peak rates verified at run time; range is not actual invoice.
        hit = usage["prompt_cache_hit_tokens"]
        miss = usage["prompt_cache_miss_tokens"] or max(0, usage["prompt_tokens"] - hit)
        peak = (hit * .044 + miss * 1.32 + usage["completion_tokens"] * 3.96) / 1e6
        cost = {"currency": "USD", "off_peak_estimate": peak / 2, "peak_estimate": peak,
                "actual_billed_cost": None, "model_pricing": "DeepSeek-V4-Pro", "excludes_other_runs": True}
    return {"planned_cases": n, "returned_cases": len(results), "counts": counts,
        "decision_contract_accuracy": counts["decision_contract_correct"] / n if n else None,
        "question_field_recall": covered / needed if needed else None,
        "covered_question_fields": covered, "needed_question_fields": needed,
        "unnecessary_question_fields": unnecessary,
        "premature_tool_call_denominator": noncalls,
        "premature_tool_call_rate": counts["premature_tool_call"] / noncalls if noncalls else None,
        "expected_tool_calls": len(calls),
        "correct_tool_arguments": sum(r["tool_arguments_exact"] is True for r in calls),
        "by_category": dict(by_category),
        "failure_counts": dict(Counter(x for r in rows for x in r["failure_reasons"])),
        "latency_seconds": {"median": statistics.median(latency) if latency else None,
            "p95": latency[max(0, math.ceil(.95 * len(latency)) - 1)] if latency else None,
            "sum": sum(latency), "includes_loading": False, "concurrency": 1},
        "api_usage": dict(usage), "api_cost_estimate": cost,
        "question_semantic_review": "separate; field tags alone do not prove question adequacy"}


def evaluate(labels_path, inputs_path, run):
    labels = read_jsonl(labels_path)
    inputs = read_jsonl(inputs_path)
    if len({r["id"] for r in labels}) != len(labels) or {r["id"] for r in labels} != {r["id"] for r in inputs}:
        raise ValueError("Labels/inputs IDs do not align")
    records = {r["id"]: r for r in inputs}
    results = read_jsonl(run / "results.jsonl") if (run / "results.jsonl").exists() else []
    protocol = json.loads((run / "protocol.json").read_text())
    if protocol["inputs_sha256"] != sha(inputs_path):
        raise ValueError("Input changed since run")
    planned = set(protocol["case_ids"])
    if planned != set(records):
        raise ValueError("Partial/limited run cannot be scored as a full split")
    if len({r["id"] for r in results}) != len(results) or not {r["id"] for r in results} <= planned:
        raise ValueError("Duplicate/unplanned result IDs")
    by_id = {r["id"]: r for r in results}
    rows = [score(label, by_id.get(label["id"], {}), records[label["id"]]) for label in labels]
    report = {"evaluated_at": now(), "labels_sha256": sha(labels_path),
              "results_sha256": sha(run / "results.jsonl") if results else None,
              "summary": summarize(rows, results), "cases": rows}
    save(run / "assessment.json", report)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(evaluate(args.labels, args.inputs, args.run_dir)["summary"], ensure_ascii=False, indent=2))
