"""Freeze sources and sealed dataset before opening the fresh holdout."""
import argparse
import json
from pathlib import Path
from legacy import V1, common

ROOT = Path(__file__).resolve().parent


def sources():
    paths = list(ROOT.glob("*.py")) + [ROOT / p for p in ["prompt.txt", "DESIGN.md", "CONTROL.md", "METRICS.md"]]
    paths += list(V1.glob("*.py")) + [V1 / "prompt.txt", V1 / "CONTRACT.md", V1 / "freeze.json"]
    return {str(p.relative_to(ROOT.parent)): common.sha(p) for p in sorted(paths)}


def verify():
    frozen = json.loads((ROOT / "freeze.json").read_text())
    for rel, expected in frozen["source_sha256"].items():
        if common.sha(ROOT.parent / rel) != expected:
            raise ValueError("Frozen source changed: " + rel)
    for name, expected in frozen["data_sha256"].items():
        if common.sha(ROOT / "data" / name) != expected:
            raise ValueError("Frozen data changed: " + name)
    return frozen


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seal-data", type=Path)
    args = ap.parse_args()
    if args.seal_data:
        if (ROOT / "freeze.json").exists():
            raise ValueError("Freeze already exists; never overwrite")
        value = {"frozen_at": common.now(), "source_sha256": sources(),
            "data_sha256": {p.name: common.sha(p) for p in sorted(args.seal_data.glob("*")) if p.is_file()},
            "implementation_author_has_read_fresh_cases": False,
            "training": False, "source_changes_after_first_test_forbidden": True}
        common.save(ROOT / "freeze.json", value)
        print("Sources and sealed data hashes recorded")
    else:
        value = verify()
        print(json.dumps({"verified_sources": len(value["source_sha256"]), "verified_data": len(value["data_sha256"])}))
