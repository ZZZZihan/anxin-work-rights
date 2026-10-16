"""Reproduce the report from immutable runs and independent review, without inference.

The semantic review and diagnostics are exploratory, not frozen primary metrics.
No outputs, labels, primary assessments, or freeze manifest are changed here.
"""
from collections import Counter
import json
from pathlib import Path

from common import read_jsonl, save, sha


ROOT = Path(__file__).resolve().parent


def read(path):
    return json.loads(path.read_text())


def validate_review(row, packet):
    """Missing question review is not a successful semantic review."""
    assert type(row["business_action_correct"]) is bool
    quality = row["question_text_adequate"]
    assert quality is None or type(quality) is bool
    if packet["transport_error"]:
        assert row["business_action_correct"] is False and quality is None
        assert packet["output"] is None and not packet["raw_output"]
        return
    obj = packet["output"]
    action = obj.get("next_action") if isinstance(obj, dict) else None
    actual_questions = action.get("questions") if isinstance(action, dict) else None
    if packet["expected"]["next_action"]["type"] == "ask_user" or actual_questions:
        assert type(quality) is bool, "Expected or actual questions require an explicit text judgment"


def summarize(root=ROOT):
    review = {}
    sources = {}
    for batch in (1, 2):
        mapping_path = root / "review" / f"blind-batch{batch}-mapping.json"
        semantic_path = root / "review" / f"semantic-batch{batch}.json"
        packet_path = root / "review" / f"blind-batch{batch}.jsonl"
        mapping = read(mapping_path)
        rows = read(semantic_path)["cases"]
        ids = [r["review_id"] for r in rows]
        assert len(ids) == len(set(ids)) and set(ids) == set(mapping)
        packets = read_jsonl(packet_path)
        assert len(packets) == len(ids) and {r["review_id"] for r in packets} == set(ids)
        packets_by_id = {p["review_id"]: p for p in packets}
        for row in rows:
            target = mapping[row["review_id"]]
            key = (target["backend"], target["id"])
            assert key not in review
            validate_review(row, packets_by_id[row["review_id"]])
            review[key] = row
        for path in (mapping_path, semantic_path, packet_path):
            sources[str(path.relative_to(root))] = sha(path)

    labels = read_jsonl(root / "data/test.labels.jsonl")
    label_ids = {r["id"] for r in labels}
    output = {"scope": "72 synthetic held-out cases, 36 paired groups; no training",
              "semantic_status": "exploratory independent Agent review, not human expert validation",
              "semantic_rule": "action and actual arguments correct AND question_text_adequate is not false",
              "review_source_sha256": sources, "backends": {}}
    consumed = set()
    for backend in ("rules", "qwen", "deepseek"):
        run = root / "results" / f"{backend}-test"
        assessment = read(run / "assessment.json")
        results = read_jsonl(run / "results.jsonl")
        diagnostic = read(run / "diagnostic.json")
        assert assessment["results_sha256"] == sha(run / "results.jsonl")
        assert diagnostic["results_sha256"] == sha(run / "results.jsonl")
        assert len(results) == 72 and {r["id"] for r in results} == label_ids
        assert len(assessment["cases"]) == 72 and {c["id"] for c in assessment["cases"]} == label_ids
        rows = []
        group_pass = {}
        for case in assessment["cases"]:
            key = (backend, case["id"])
            reviewed = review.get(key)
            if reviewed is None:
                # Every question and every primary failure must be independently reviewed.
                assert case["decision_contract_correct"] and not case["asked_question_fields"]
                semantic = True
            else:
                consumed.add(key)
                semantic = reviewed["business_action_correct"] and reviewed["question_text_adequate"] is not False
            rows.append({"id": case["id"], "group_id": case["group_id"],
                         "primary_correct": case["decision_contract_correct"],
                         "business_semantic_correct": semantic,
                         "validation": "independent_blind_agent" if reviewed else "deterministic_non_question",
                         "review": reviewed})
            group_pass.setdefault(case["group_id"], []).append(semantic)
        assert len(group_pass) == 36 and all(len(v) == 2 for v in group_pass.values())
        raw_calls = [c for c in assessment["cases"]
                     if isinstance(c["parsed_output"], dict)
                     and isinstance(c["parsed_output"].get("next_action"), dict)
                     and c["parsed_output"]["next_action"].get("type") == "call_tool"]
        raw_numerical = [c for c in raw_calls if c["expected"]["next_action"]["type"] == "call_tool"
                         and c["parsed_output"]["next_action"].get("arguments") == c["expected"]["next_action"]["arguments"]]
        protocol_issues = Counter()
        for c in assessment["cases"]:
            obj = c["parsed_output"]
            if isinstance(obj, dict) and isinstance(obj.get("next_action"), dict):
                if "questions" not in obj["next_action"]:
                    protocol_issues["missing_questions_key"] += 1
                if obj["next_action"].get("type") == "ask_user" and obj.get("missing") == [] and c["expected"]["missing"]:
                    protocol_issues["ask_despite_empty_missing_metadata"] += 1
        output["backends"][backend] = {
            "primary": assessment["summary"],
            "raw_strict_json_and_primary_correct": sum(c["strict_json"] and c["decision_contract_correct"] for c in assessment["cases"]),
            "exploratory_action_and_declared_fields": diagnostic["summary"]["correct_action_and_declared_question_fields"],
            "business_semantic_correct": sum(r["business_semantic_correct"] for r in rows),
            "both_cases_in_group_semantically_correct": sum(all(v) for v in group_pass.values()),
            "independently_reviewed_rows": sum(r["review"] is not None for r in rows),
            "raw_actual_call_count": len(raw_calls),
            "raw_numerically_correct_calls_on_expected_call_cases": len(raw_numerical),
            "selected_protocol_issue_counts": dict(protocol_issues), "cases": rows,
        }
    recovery_key = ("deepseek-recovery", "c_3b94df86700a")
    assert recovery_key in review
    recovery = read_jsonl(root / "results/deepseek-recovery/results.jsonl")
    assert len(recovery) == 1 and recovery[0]["id"] == recovery_key[1]
    consumed.add(recovery_key)
    assert consumed == set(review)
    output["separate_recovery"] = {"review": review[recovery_key], "latency_seconds": recovery[0]["latency_seconds"],
                                   "included_in_primary_or_business_test_score": False}
    usage = Counter()
    attempts = success = 0
    for name in ("deepseek-dev-preflight", "deepseek-dev", "deepseek-test", "deepseek-recovery"):
        for row in read_jsonl(root / "results" / name / "results.jsonl"):
            attempts += 1
            if row.get("usage"):
                success += 1
                usage.update({k: v for k, v in row["usage"].items() if isinstance(v, int)})
    peak = (usage["prompt_cache_miss_tokens"] * 1.32 + usage["prompt_cache_hit_tokens"] * .044
            + usage["completion_tokens"] * 3.96) / 1_000_000
    output["all_deepseek_runs"] = {"attempts": attempts, "successful_responses": success,
        "reported_usage": dict(usage), "estimated_usd_peak": peak, "estimated_usd_off_peak": peak / 2,
        "actual_billing": "not inspected; failed request billing unknown",
        "pricing_source": "https://api-docs.deepseek.com/quick_start/pricing/"}
    save(root / "comparison.json", output)
    print(json.dumps({k: {"primary": v["primary"]["counts"]["decision_contract_correct"],
                         "semantic": v["business_semantic_correct"], "reviewed": v["independently_reviewed_rows"],
                         "group_both": v["both_cases_in_group_semantically_correct"],
                         "protocol_issues": v["selected_protocol_issue_counts"]}
                      for k, v in output["backends"].items()}, ensure_ascii=False))
    print(json.dumps(output["all_deepseek_runs"]))


if __name__ == "__main__":
    summarize()
