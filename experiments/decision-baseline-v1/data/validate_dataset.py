"""Validate frozen synthetic records; this is not semantic model evaluation."""
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIELDS = {"period", "agreed_due_total", "wage_paid_total"}
CATEGORIES = {"missing_period", "missing_due", "payment_attribution", "complete",
              "mixed_payment", "conflict", "multi_turn", "tool_failure"}

def main():
    seen_ids, seen_messages = set(), set()
    group_splits = defaultdict(set)
    report = {"scope": "structural_and_deterministic_arithmetic_validation_only", "splits": {}, "tool_replay": [], "files": {}}
    all_amounts = []
    for split, wanted in (("train", 24), ("dev", 12), ("test", 72)):
        paths = [ROOT / f"{split}.{kind}.jsonl" for kind in ("inputs", "labels")]
        inputs, labels = [[json.loads(line) for line in p.read_text(encoding="utf-8").splitlines()] for p in paths]
        assert len(inputs) == len(labels) == wanted
        assert [x["id"] for x in inputs] == [x["id"] for x in labels]
        counts = Counter()
        groups = Counter()
        actions = Counter()
        for record, label in zip(inputs, labels):
            assert set(record) == {"id", "messages", "tool_state"}
            assert record["id"] not in seen_ids
            seen_ids.add(record["id"])
            assert record["messages"] and all(set(m) == {"role", "content"} and m["role"] in {"user", "assistant"}
                                              and isinstance(m["content"], str) and m["content"].strip() for m in record["messages"])
            message_key = json.dumps(record["messages"], ensure_ascii=False, sort_keys=True)
            assert message_key not in seen_messages
            seen_messages.add(message_key)
            assert record["tool_state"] is None or record["tool_state"] == {"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}
            assert set(label) == {"id", "split", "group_id", "category", "synthetic", "provenance", "expected", "rationale"}
            assert label["split"] == split and label["category"] in CATEGORIES
            assert label["synthetic"] is True and label["provenance"] == "agent_authored_synthetic"
            assert isinstance(label["rationale"], str) and label["rationale"].strip()
            group_splits[label["group_id"]].add(split)
            groups[label["group_id"]] += 1
            counts[label["category"]] += 1
            e = label["expected"]
            assert set(e) == {"missing", "conflicts", "next_action"}
            assert isinstance(e["missing"], list) and isinstance(e["conflicts"], list)
            missing, conflicts = set(e["missing"]), set(e["conflicts"])
            assert missing <= FIELDS and conflicts <= FIELDS and not missing & conflicts
            assert len(missing) == len(e["missing"]) and len(conflicts) == len(e["conflicts"])
            a = e["next_action"]
            assert set(a) == {"type", "questions", "tool", "arguments"}
            assert isinstance(a["questions"], list)
            actions[a["type"]] += 1
            if a["type"] == "ask_user":
                assert record["tool_state"] is None
                assert missing or conflicts
                assert a["tool"] is None and a["arguments"] is None
                assert {q["field"] for q in a["questions"]} == missing | conflicts
                assert len(a["questions"]) == len(missing | conflicts)
                assert all(set(q) == {"field", "text"} and isinstance(q["text"], str) and q["text"].strip() for q in a["questions"])
            elif a["type"] == "call_tool":
                assert record["tool_state"] is None
                assert not (missing or conflicts or a["questions"])
                assert a["tool"] == "calculate_wage_gap"
                args = a["arguments"]
                assert set(args) == {"period_start", "period_end", "due", "paid"}
                start, end = date.fromisoformat(args["period_start"]), date.fromisoformat(args["period_end"])
                assert start <= end
                assert start.isoformat() == args["period_start"] and end.isoformat() == args["period_end"]
                for key in ("due", "paid"):
                    value = args[key]
                    assert type(value) in {int, float} and math.isfinite(value)
                    dec = Decimal(str(value))
                    assert dec >= 0 and dec == dec.quantize(Decimal("0.01"))
                    all_amounts.append(dec)
                gap = Decimal(str(args["due"])) - Decimal(str(args["paid"]))
                report["tool_replay"].append({"id": record["id"], "split": split, "gap": str(gap.quantize(Decimal("0.01")))})
            elif a["type"] == "report_tool_failure":
                assert record["tool_state"] == {"status": "TIMEOUT", "attempts": 2, "max_attempts": 2}
                assert not (missing or conflicts or a["questions"])
                assert a["tool"] is None and a["arguments"] is None
            else:
                raise AssertionError(a["type"])
        assert all(2 <= count <= 3 for count in groups.values())
        if split == "test":
            assert len(groups) >= 30
        report["splits"][split] = {"records": len(inputs), "groups": len(groups), "categories": dict(sorted(counts.items())), "actions": dict(sorted(actions.items()))}
        for p in paths:
            report["files"][p.name] = {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size}
    assert all(len(splits) == 1 for splits in group_splits.values())
    report["checks"] = {"one_to_one_input_label_ids": True, "unique_ids": True,
                        "no_duplicate_conversations": True, "strict_schema": True,
                        "groups_do_not_cross_splits": True, "question_fields_exact": True,
                        "calendar_dates_valid": True, "amounts_have_at_most_two_decimals": True,
                        "retry_limit_observed_in_gold": True, "explicit_zero_values": all_amounts.count(Decimal(0)),
                        "negative_tool_gaps": sum(Decimal(row["gap"]) < 0 for row in report["tool_replay"])}
    report["status"] = "passed"
    (ROOT / "validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "splits": report["splits"], "checks": report["checks"]}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
