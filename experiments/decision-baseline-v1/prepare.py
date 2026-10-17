"""Validate and freeze the pre-training dataset and benchmark sources."""
from collections import Counter
import json
from pathlib import Path

from common import ROOT, calculate, messages, now, read_jsonl, save, sha, validate_output, visible


def main():
    manifest_path = ROOT / "freeze.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for name, expected in manifest["sha256"].items():
            if sha(ROOT / name) != expected:
                raise ValueError("Frozen file changed: " + name)
        print("Frozen hashes verified")
        return
    groups, ids, texts = {}, set(), set()
    counts = {}
    prompt = (ROOT / "prompt.txt").read_text()
    train_sft = []
    for split, count in [("train", 24), ("dev", 12), ("test", 72)]:
        inputs = read_jsonl(ROOT / "data" / (split + ".inputs.jsonl"))
        labels = read_jsonl(ROOT / "data" / (split + ".labels.jsonl"))
        if len(inputs) != count or len(labels) != count:
            raise ValueError("Unexpected split size")
        for record, label in zip(inputs, labels):
            visible(record)
            if record["id"] != label["id"] or record["id"] in ids or label["split"] != split:
                raise ValueError("ID/split mismatch")
            ids.add(record["id"])
            text = json.dumps(record["messages"], ensure_ascii=False)
            if text in texts:
                raise ValueError("Duplicate dialogue")
            texts.add(text)
            group = label["group_id"]
            if groups.setdefault(group, split) != split:
                raise ValueError("Group crosses splits")
            expected = label["expected"]
            if not validate_output(expected) or label["synthetic"] is not True:
                raise ValueError("Invalid/synthetic label")
            if expected["next_action"]["type"] == "call_tool":
                calculate(expected["next_action"]["arguments"])
            if split == "train":
                train_sft.append({"messages": [*messages(record, prompt),
                    {"role": "assistant", "content": json.dumps(expected, ensure_ascii=False)}]})
        counts[split] = {"cases": count, "groups": len({r["group_id"] for r in labels}),
                         "actions": dict(Counter(r["expected"]["next_action"]["type"] for r in labels))}
    (ROOT / "data" / "train.sft.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in train_sft))
    paths = [*ROOT.glob("*.py"), ROOT / "prompt.txt", ROOT / "CONTRACT.md",
             *sorted((ROOT / "data").glob("*.jsonl")), ROOT / "provenance" / "rules-FREEZE.json"]
    manifest = {"frozen_at": now(), "training": False, "synthetic": True,
        "counts": counts, "purpose": "Pre-LoRA one-step diagnostic baseline",
        "test_separation": "Distinct authoring groups; rule implementer excluded test by instruction, not OS sandbox",
        "sha256": {str(p.relative_to(ROOT)): sha(p) for p in paths},
        "comparison": ["frozen_rules", "Qwen3-32B-4bit/no_adapter", "deepseek-v4-pro/nonthinking"],
        "scoring": "Exact action+missing+conflicts+question-field coverage+tool arguments; separate question-text review",
        "primary_unit": "72 test decisions in 36 paired scenario groups; no claim of real-world population accuracy",
        "no_post_test_tuning": True,
        "limits": ["All synthetic, agent authored and reviewed", "Same broad task and authoring style across splits",
                   "No live interactive completion, OCR, RAG or legal evaluation", "No LoRA or RL training"]}
    save(manifest_path, manifest)
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
