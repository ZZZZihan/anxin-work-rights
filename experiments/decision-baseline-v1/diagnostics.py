"""Exploratory post-development diagnostics; never replaces the frozen primary score.

Introduced after dev exposed correct actions with omitted redundant empty fields.
No new inference, repair prompt, inferred money, or altered raw result is used.
Actual question text still requires the independent review, not just field tags.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

from common import FIELDS, parse_output, read_jsonl, save, sha, validate_output


def diagnose(label, result):
    expected = label["expected"]
    want = expected["next_action"]
    obj, _ = parse_output(result.get("raw_output", ""))
    a = obj.get("next_action") if isinstance(obj, dict) else None
    a = a if isinstance(a, dict) else {}
    qs = a.get("questions", [])
    questions_valid = isinstance(qs, list) and all(isinstance(q, dict) and
        isinstance(q.get("field"), str) and q["field"] in FIELDS and
        isinstance(q.get("text"), str) and q["text"].strip() for q in qs)
    asked = {q["field"] for q in qs} if questions_valid else set()
    needed = set(expected["missing"]) | set(expected["conflicts"])
    kind_correct = a.get("type") == want["type"]
    reasons = []
    correct = False
    if not kind_correct:
        reasons.append("wrong_action")
    if want["type"] == "ask_user":
        correct = (kind_correct and questions_valid and asked == needed and
                   len(qs) == len(needed) and a.get("tool") is None and a.get("arguments") is None)
        if not questions_valid:
            reasons.append("unreadable_questions")
        if needed - asked:
            reasons.append("missed_question_fields")
        if asked - needed:
            reasons.append("unnecessary_question_fields")
    elif want["type"] == "call_tool":
        # Use an explicit canonical shell only to validate tool arguments; do not
        # rewrite saved output or award credit for invented/mended argument values.
        shell = {"missing": [], "conflicts": [], "next_action": {"type": "call_tool",
                 "questions": [], "tool": a.get("tool"), "arguments": a.get("arguments")}}
        correct = kind_correct and validate_output(shell) and a.get("arguments") == want["arguments"] and qs == []
        if not correct and kind_correct:
            reasons.append("wrong_tool_arguments_or_extra_questions")
    else:
        correct = kind_correct and qs == [] and a.get("tool") is None and a.get("arguments") is None
    return {"id": label["id"], "next_action_diagnostic_correct": bool(correct),
            "reasons": reasons, "question_text_review_required": bool(qs),
            "note": "Exploratory action/field-tag diagnostic; ignores redundant missing/conflicts metadata and absent empty fields."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    args = parser.parse_args()
    labels = read_jsonl(args.labels)
    results = read_jsonl(args.run_dir / "results.jsonl")
    by_id = {r["id"]: r for r in results}
    rows = [diagnose(label, by_id.get(label["id"], {})) for label in labels]
    save(args.run_dir / "diagnostic.json", {"status": "exploratory_not_preregistered_primary",
        "reason": "dev exposed correct actions with omitted empty fields; separate these from business errors",
        "source_sha256": sha(Path(__file__)), "labels_sha256": sha(args.labels),
        "results_sha256": sha(args.run_dir / "results.jsonl"), "cases": rows,
        "summary": {"correct_action_and_declared_question_fields": sum(r["next_action_diagnostic_correct"] for r in rows),
            "total": len(rows), "reasons": dict(Counter(x for r in rows for x in r["reasons"])),
            "independent_question_text_review": "pending"}})
    print(json.dumps({"correct": sum(r["next_action_diagnostic_correct"] for r in rows), "total": len(rows)}))


if __name__ == "__main__":
    main()
