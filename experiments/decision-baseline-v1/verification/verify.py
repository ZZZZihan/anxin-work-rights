"""Read-only verification around the unchanged, frozen v1 scorer and report.

This lives below verification/ because v2/v3 seal the v1 top-level Python
inventory. It checks stored assessments and review joins before invoking the
historical summarizer in a disposable copy, never rewriting archived evidence.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parents[1]
sys.path.insert(0, str(ROOT))

import common
import diagnostics
import evaluate
import summarize


ARTIFACTS = tuple("experiments/" + name for name in (
    "decision-baseline-v1/freeze.json",
    "decision-baseline-v1/comparison.json",
    "decision-baseline-v2/freeze.json",
    "decision-baseline-v2/comparison.json",
    "decision-baseline-v3/freeze.json",
    "decision-baseline-v3/comparison.json",
    "decision-baseline-v3/replication/freeze.json",
    "decision-baseline-v3/replication/comparison.json",
))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def read(path: Path):
    return json.loads(path.read_text())


def indexed(rows: list[dict], key: str, label: str) -> dict:
    result = {row[key]: row for row in rows}
    require(len(rows) == len(result), "Duplicate ids: " + label)
    return result


def verify_tracked_artifacts(repository: Path = REPOSITORY) -> None:
    result = subprocess.run(
        ["git", "-C", str(repository), "ls-files", "--error-unmatch", "--", *ARTIFACTS],
        capture_output=True, text=True, check=False,
    )
    require(result.returncode == 0, "Required baseline artifacts must remain tracked: " + result.stderr.strip())
    for name in ARTIFACTS:
        require((repository / name).is_file(), "Required baseline artifact is missing: " + name)


def verify_reports(root: Path = ROOT) -> dict:
    frozen = read(root / "freeze.json")
    for name, digest in frozen["sha256"].items():
        require(common.sha(root / name) == digest, "Frozen v1 file changed: " + name)

    labels_path, inputs_path = root / "data/test.labels.jsonl", root / "data/test.inputs.jsonl"
    labels, inputs = common.read_jsonl(labels_path), common.read_jsonl(inputs_path)
    label_by_id = indexed(labels, "id", "test labels")
    input_by_id = indexed(inputs, "id", "test inputs")
    require(len(labels) == 72 and set(label_by_id) == set(input_by_id), "Incomplete test labels/inputs")
    runs = {}
    for backend in ("rules", "qwen", "deepseek"):
        folder = root / "results" / (backend + "-test")
        results = common.read_jsonl(folder / "results.jsonl")
        by_id = indexed(results, "id", backend + " results")
        require(set(by_id) == set(label_by_id), "Incomplete/unplanned results: " + backend)
        protocol = read(folder / "protocol.json")
        require(protocol["inputs_sha256"] == common.sha(inputs_path)
                and protocol["case_ids"] == [row["id"] for row in inputs], "Run input provenance mismatch: " + backend)
        require(all(row["backend"] == backend for row in results), "Run backend mismatch: " + backend)
        cases = [evaluate.score(label, by_id[label["id"]], input_by_id[label["id"]]) for label in labels]
        assessment = read(folder / "assessment.json")
        diagnostic = read(folder / "diagnostic.json")
        for report in (assessment, diagnostic):
            require(report["results_sha256"] == common.sha(folder / "results.jsonl")
                    and report["labels_sha256"] == common.sha(labels_path), "Stored report provenance mismatch: " + backend)
        require(assessment["cases"] == cases, "Stored assessment cases differ from raw results: " + backend)
        require(assessment["summary"] == evaluate.summarize(cases, results), "Stored assessment summary differs from raw results: " + backend)
        diagnosed = [diagnostics.diagnose(label, by_id[label["id"]]) for label in labels]
        require(diagnostic["source_sha256"] == common.sha(Path(diagnostics.__file__)), "Diagnostic source mismatch: " + backend)
        require(diagnostic["cases"] == diagnosed, "Stored diagnostic cases differ from raw results: " + backend)
        expected = {
            "correct_action_and_declared_question_fields": sum(row["next_action_diagnostic_correct"] for row in diagnosed),
            "total": len(diagnosed),
            "reasons": dict(Counter(reason for row in diagnosed for reason in row["reasons"])),
            "independent_question_text_review": "pending",
        }
        require(diagnostic["summary"] == expected, "Stored diagnostic summary differs from raw results: " + backend)
        runs[backend] = by_id

    recovery = common.read_jsonl(root / "results/deepseek-recovery/results.jsonl")
    require(len(recovery) == 1, "Recovery must remain separate from the full runs")
    runs["deepseek-recovery"] = indexed(recovery, "id", "recovery")
    joined = set()
    for batch in (1, 2):
        folder = root / "review"
        mapping = read(folder / f"blind-batch{batch}-mapping.json")
        packets = indexed(common.read_jsonl(folder / f"blind-batch{batch}.jsonl"), "review_id", "review packets")
        semantic = indexed(read(folder / f"semantic-batch{batch}.json")["cases"], "review_id", "semantic reviews")
        require(set(mapping) == set(packets) == set(semantic), "Review ids do not align")
        for review_id, target in mapping.items():
            backend, case_id = target["backend"], target["id"]
            require(backend in runs and case_id in runs[backend] and case_id in label_by_id,
                    "Review target does not identify a raw result: " + review_id)
            require((backend, case_id) not in joined, "Duplicate review target: " + review_id)
            packet, original = packets[review_id], runs[backend][case_id]
            expected = {
                "review_id": review_id,
                "input": input_by_id[case_id],
                "expected": label_by_id[case_id]["expected"],
                "output": common.parse_output(original["raw_output"])[0],
                "raw_output": original["raw_output"],
                "transport_error": bool(original.get("error_type")),
            }
            require(packet == expected and type(packet["transport_error"]) is bool,
                    "Review packet does not match mapped input/label/raw result: " + review_id)
            summarize.validate_review(semantic[review_id], packet)
            joined.add((backend, case_id))
    return {"recomputed_assessment_cases": 216, "recomputed_diagnostic_cases": 216,
            "bound_review_packets": len(joined), "frozen_files": len(frozen["sha256"])}


def verify(root: Path = ROOT) -> dict:
    counts = verify_reports(root)
    # The frozen summarizer writes comparison.json. Run it only after all
    # source joins have passed, and contain that write in a temporary snapshot.
    with tempfile.TemporaryDirectory(prefix="anxin-v1-report-check-") as directory:
        snapshot = Path(directory) / "decision-baseline-v1"
        shutil.copytree(root, snapshot)
        with redirect_stdout(io.StringIO()):
            summarize.summarize(snapshot)
        require((snapshot / "comparison.json").read_bytes() == (root / "comparison.json").read_bytes(),
                "Stored comparison differs from verified raw results and review")
    return {"status": "passed", **counts, "comparison_sha256": common.sha(root / "comparison.json"),
            "models_loaded": False, "api_called": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracked-only", action="store_true", help="Check all v1/v2/v3 artifacts before any generator runs")
    args = parser.parse_args()
    verify_tracked_artifacts()
    print(json.dumps({"tracked_artifacts": len(ARTIFACTS)} if args.tracked_only else verify()))
