"""Read-only count arithmetic and byte binding; never imports the scorer/runner."""
import hashlib
import json
import math
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
base = root / "experiments/material-facts-v7"
sha = lambda value: hashlib.sha256(value).hexdigest()
read = lambda path: json.loads(path.read_bytes())
historical = {
    "freeze.json": "0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2",
    "result-manifest.json": "3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee",
    "corrections/manifest.json": "eb5d86b831a8a6df99b52a02cd062fe977a2a03ed5ef5ef168406c1a10a010de",
    "corrections-v2/manifest.json": "1bb6add63ec732bca31dfe65c50844411e7fba45d0addc45b0f69a11a3175f80",
    "corrections-v3/manifest.json": "72e07756ce1901dd1060d4b03c53fb443eebd9048bf7f6bece6c6cbf3ec0c841",
    "corrections-v4/manifest.json": "3bceefdb375173567fa7ce60c662eae991957ade70bb89f0da989edb7ebd9db6",
    "corrections-v5/manifest.json": "eb79da00daa92966f081a2eba35d7355e258a45d18411570834efc62d632e32e",
    "corrections-v6/manifest.json": "0c9ef56e30e278c816e088a934df1cb8f0cdc944c262b9bd9f88be146909ee69",
    "corrections-v7/manifest.json": "1fb40b4c0694744f5a83c6b9ddc87bfd1958a2b85185fb178273cec13b422e31",
    "corrections-v8/manifest.json": "8fa3100c348a94af0471e93a5a2dab8d405df2dd4debc603b3fe3dbe89fac06b",
    "corrections-v9/manifest.json": "ccb4dce9e91f74fd24f5115133db468288b9c988f76ce28136bfd61e00bce764",
    "corrections-v10/manifest.json": "c403c8c44146e78b4b15d775d0701cbb94455f0f33a3ebecce939092596f1718",
    "corrections-v11/manifest.json": "42f13c238e7f88c044de27c858327b92ffd20a576970c836b1a52654421b1345",
}
for path, digest in historical.items():
    assert sha((base / path).read_bytes()) == digest, path
for directory in ["corrections"] + [f"corrections-v{version}" for version in range(2, 12)]:
    for path, digest in read(base / directory / "manifest.json")["files"].items():
        assert sha((base / directory / path).read_bytes()) == digest, (directory, path)
original_files = read(base / "result-manifest.json")["files"]
assert len(original_files) == 60
for path, digest in original_files.items():
    assert sha((base / path).read_bytes()) == digest, path
labels = {row["id"]: row for row in (json.loads(line) for line in (base / "data/holdout.labels.provisional.jsonl").read_text().splitlines())}
assert len(labels) == 12 and sum(len(row["expected"]) for row in labels.values()) == 43
manifest_bytes = (base / "corrections-v12/manifest.json").read_bytes()
manifest = json.loads(manifest_bytes)
assert manifest["previous_correction_manifest_sha256"] == historical["corrections-v11/manifest.json"]
assert manifest["first_result_manifest_sha256"] == historical["result-manifest.json"]
assert manifest["freeze_sha256"] == historical["freeze.json"]
assert len(manifest["code_sha256"]) == 55
previous = read(base / "corrections-v11/manifest.json")
archive = read(base / "correction-code-v11/manifest.json")
assert sha((base / "correction-code-v11/manifest.json").read_bytes()) == "0b73e0c901031446c4becce678a3ec77dfcb2b4314285d4ddb583b631afca681"
assert archive["correction_manifest_sha256"] == historical["corrections-v11/manifest.json"]
assert set(archive["files"]) == set(previous["code_sha256"])
assert len(archive["files"]) == 52
for path, digest in archive["files"].items():
    assert previous["code_sha256"][path] == digest
    assert sha((base / "correction-code-v11" / (path + ".snapshot")).read_bytes()) == digest, path
for key, path in [("input_sha256", "data/holdout.inputs.jsonl"), ("labels_sha256", "data/holdout.labels.provisional.jsonl")]:
    assert manifest[key] == previous[key] == sha((base / path).read_bytes())
for backend in ("rules", "qwen", "deepseek"):
    for key, name in [("raw_sha256", "results.jsonl"), ("first_report_sha256", "report.json")]:
        assert manifest["evidence"][backend][key] == previous["evidence"][backend][key] == sha((base / f"results/holdout-{backend}-1" / name).read_bytes())
for path in ["lib/material-fact-range-review.ts", "experiments/material-facts-v7/experiment-lock.mjs", "experiments/material-facts-v7/verify-correction-v11.mjs", "experiments/material-facts-v7/corrective-assessment-v12.mjs", "experiments/material-facts-v7/historical-execution-v1.mjs", "experiments/material-facts-v7/historical-execution-policy-v1.mjs", "experiments/material-facts-v7/historical-v11-execution.mjs", "lib/material-fact-arithmetic-review.ts", "lib/material-fact-currency-review.ts", "experiments/material-facts-v7/run.mjs", "experiments/material-facts-v7/verify.mjs"]:
    assert path in manifest["code_sha256"], path
for path, digest in manifest["code_sha256"].items():
    assert sha((root / path).read_bytes()) == digest, path
assert set(path.name for path in (base / "corrections-v12").iterdir()) == set(manifest["files"]) | {"manifest.json"}
for path, digest in manifest["files"].items():
    assert sha((base / "corrections-v12" / path).read_bytes()) == digest, path

models = {}
layers = [f"{scope}_{mode}" for scope in ("raw", "accepted") for mode in ("basic", "relational", "strict")]
for backend in ("rules", "qwen", "deepseek"):
    name = f"report-{backend}.json"
    old_bytes = (base / "corrections-v11" / name).read_bytes()
    new_bytes = (base / "corrections-v12" / name).read_bytes()
    report = json.loads(new_bytes)
    assert len(report["cases"]) == 12 and report["expected_facts"] == 43
    assert {case["id"] for case in report["cases"]} == set(labels)
    totals = {}
    for layer in layers:
        tp = fp = fn = 0
        for case in report["cases"]:
            row = case[layer]
            pairs, missing, extra = row["pairs"], row["missing"], row["extra"]
            paired_expected = [pair["expected"] for pair in pairs]
            paired_actual = [pair["actual"] for pair in pairs]
            expected_count = len(labels[case["id"]]["expected"])
            candidate_count = case["raw_count" if layer.startswith("raw_") else "accepted_count"]
            # Completeness and disjointness, not just trusting the stored TP/FP/FN.
            assert sorted(paired_expected + missing) == list(range(expected_count))
            assert sorted(paired_actual + extra) == list(range(candidate_count))
            actual = (len(pairs), len(extra), len(missing))
            assert actual == (row["tp"], row["fp"], row["fn"])
            tp += actual[0]
            fp += actual[1]
            fn += actual[2]
        precision = tp / (tp + fp) if tp + fp else 0
        recall = tp / (tp + fn) if tp + fn else 0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        totals[layer] = dict(tp=tp, fp=fp, fn=fn, precision=precision, recall=recall, f1=f1)
        assert tp + fn == 43
        for field, value in totals[layer].items():
            assert math.isclose(report["metrics"][layer][field], value, rel_tol=1e-12, abs_tol=1e-12)
    defense = [item for case in report["cases"] for item in case["production_defense"]]
    assert all(item["calculation_authorized"] is False for item in defense)
    assert not any(item["exact_money_without_review_issue"] for item in defense)
    models[backend] = dict(v11_v12_report_byte_identical=(old_bytes == new_bytes), report_sha256=sha(new_bytes),
        cases=12, expected_facts=43, metrics_recounted_from_saved_match_partitions=totals,
        raw=report["raw_candidates"], accepted=report["accepted_candidates"], rejected=report["rejected_candidates"],
        amount_nonnull=sum(item["amount"] is not None for item in defense),
        exact_money_without_review_issue=0, calculation_authorized=0)

print(json.dumps(dict(schema="material-facts-v7-v12-independent-artifact-check/1", status="PASS",
    model_requests=0, builds=0, scorer_imported=False, case_layers_recounted=216,
    scope="Saved disjoint match partitions, fixed denominators, versioned report bytes and current code hash binding; earlier independent source/event semantic review is preserved.",
    historical_sha256=historical, original_result_files_verified=60, archived_v11_code_paths_verified=52,
    current_code_paths_verified=55, v12_manifest_sha256=sha(manifest_bytes),
    current_code_sha256=manifest["code_sha256"], models=models), ensure_ascii=False, indent=2))
