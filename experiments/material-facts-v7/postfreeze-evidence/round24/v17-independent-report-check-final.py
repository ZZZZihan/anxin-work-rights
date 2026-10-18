"""Read-only independent arithmetic/byte/diagnostic audit. Never imports a scorer.

Arguments: root, expected v17 manifest SHA supplied after formal publication.
Preparation does not run the controller, model, service, or this audit itself.
"""
import hashlib
import json
import math
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1]).resolve()
expected_manifest_sha = sys.argv[2]
assert re.fullmatch(r"[0-9a-f]{64}", expected_manifest_sha)
base = root / "experiments/material-facts-v7"
sha = lambda value: hashlib.sha256(value).hexdigest()
read = lambda path: json.loads(path.read_bytes())
historical = {'freeze.json': '0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2', 'result-manifest.json': '3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee', 'corrections/manifest.json': 'eb5d86b831a8a6df99b52a02cd062fe977a2a03ed5ef5ef168406c1a10a010de', 'corrections-v2/manifest.json': '1bb6add63ec732bca31dfe65c50844411e7fba45d0addc45b0f69a11a3175f80', 'corrections-v3/manifest.json': '72e07756ce1901dd1060d4b03c53fb443eebd9048bf7f6bece6c6cbf3ec0c841', 'corrections-v4/manifest.json': '3bceefdb375173567fa7ce60c662eae991957ade70bb89f0da989edb7ebd9db6', 'corrections-v5/manifest.json': 'eb79da00daa92966f081a2eba35d7355e258a45d18411570834efc62d632e32e', 'corrections-v6/manifest.json': '0c9ef56e30e278c816e088a934df1cb8f0cdc944c262b9bd9f88be146909ee69', 'corrections-v7/manifest.json': '1fb40b4c0694744f5a83c6b9ddc87bfd1958a2b85185fb178273cec13b422e31', 'corrections-v8/manifest.json': '8fa3100c348a94af0471e93a5a2dab8d405df2dd4debc603b3fe3dbe89fac06b', 'corrections-v9/manifest.json': 'ccb4dce9e91f74fd24f5115133db468288b9c988f76ce28136bfd61e00bce764', 'corrections-v10/manifest.json': 'c403c8c44146e78b4b15d775d0701cbb94455f0f33a3ebecce939092596f1718', 'corrections-v11/manifest.json': '42f13c238e7f88c044de27c858327b92ffd20a576970c836b1a52654421b1345', 'corrections-v12/manifest.json': 'd74fb4e43136d6c0a18739daa79065e8ceaef6519ce2d9ddf82de72650a1184e', 'corrections-v13/manifest.json': '7d65625d6dd48f1319eec1ca86066fcc4bfaeed0d5f23c7195157d5e7a3fc04c', 'corrections-v14/manifest.json': '7ad12cb5543f7c750c7393366d115205e876ca0817333cef0a5462d2a39562cd', 'corrections-v15/manifest.json': 'bc7ba849ed3394cfc6e1a74aa01f93ccbced443602165f43f4900e9d4cb5d292', 'corrections-v16/manifest.json': '5e229a33ed6e71f26b4fb01c92e9f28da66122bffde84d23e8e82c1fb6dbca69'}
for path, digest in historical.items():
    assert sha((base / path).read_bytes()) == digest, path
for directory in ["corrections"] + [f"corrections-v{n}" for n in range(2, 17)]:
    for path, digest in read(base / directory / "manifest.json")["files"].items():
        assert sha((base / directory / path).read_bytes()) == digest, (directory, path)
original = read(base / "result-manifest.json")
assert len(original["files"]) == 60
for path, digest in original["files"].items():
    assert sha((base / path).read_bytes()) == digest, path
labels = {row["id"]: row for row in (json.loads(line) for line in (base / "data/holdout.labels.provisional.jsonl").read_text().splitlines())}
assert len(labels) == 12 and sum(len(row["expected"]) for row in labels.values()) == 43
manifest_bytes = (base / "corrections-v17/manifest.json").read_bytes()
assert sha(manifest_bytes) == expected_manifest_sha
manifest = json.loads(manifest_bytes)
assert manifest["schema"] == "material-facts-v7-postfreeze-correction-manifest/17"
assert manifest["previous_correction_manifest_sha256"] == historical["corrections-v16/manifest.json"]
assert manifest["first_result_manifest_sha256"] == historical["result-manifest.json"]
assert manifest["freeze_sha256"] == historical["freeze.json"]
assert manifest["inference"] is False
assert len(manifest["code_sha256"]) == 70
previous = read(base / "corrections-v16/manifest.json")
archive_base = base / "correction-code-v16"
archive = read(archive_base / "manifest.json")
assert sha((archive_base / "manifest.json").read_bytes()) == "100ed6babe31280912f93e69d688d91e67e67ade11b5d29acd991c8f4b9a615f"
assert archive["correction_manifest_sha256"] == historical["corrections-v16/manifest.json"]
assert set(archive["files"]) == set(previous["code_sha256"])
assert len(archive["files"]) == 67
assert {str(path.relative_to(archive_base)) for path in archive_base.rglob("*.snapshot")} == {path + ".snapshot" for path in archive["files"]}
for path, digest in archive["files"].items():
    assert previous["code_sha256"][path] == digest
    assert sha((archive_base / (path + ".snapshot")).read_bytes()) == digest, path
for key, path in [("input_sha256", "data/holdout.inputs.jsonl"), ("labels_sha256", "data/holdout.labels.provisional.jsonl")]:
    assert manifest[key] == previous[key] == sha((base / path).read_bytes())
for backend in ("rules", "qwen", "deepseek"):
    for key, name in [("raw_sha256", "results.jsonl"), ("first_report_sha256", "report.json")]:
        assert manifest["evidence"][backend][key] == previous["evidence"][backend][key] == sha((base / f"results/holdout-{backend}-1" / name).read_bytes())
required = ["lib/material-money-v4.ts", "lib/material-fact-range-review.ts", "lib/material-fact-arithmetic-review.ts", "lib/material-fact-event-review.ts", "lib/material-fact-currency-review.ts", "lib/material-fact-source-review.ts", "lib/material-fact-runtime-ingest.ts", "experiments/material-facts-v7/assess.mjs", "experiments/material-facts-v7/verify-correction-v16.mjs", "experiments/material-facts-v7/corrective-assessment-v17.mjs", "experiments/material-facts-v7/historical-v16-execution.mjs", "experiments/material-facts-v7/historical-execution-policy-v1.mjs", "experiments/material-facts-v7/historical-execution-v1.mjs"]
assert all(path in manifest["code_sha256"] for path in required)
for path, digest in manifest["code_sha256"].items():
    assert sha((root / path).read_bytes()) == digest, path
assert manifest["code_sha256"]["experiments/material-facts-v7/historical-execution-policy-v1.mjs"] == "cf6a04377e518064037cb3374591eb7747972f7259aa92ffa0f8440eefde7dea"
assert manifest["code_sha256"]["experiments/material-facts-v7/historical-execution-v1.mjs"] == "0796452771e29dcf6ae5cfd653cb96a851a713f07de9f2b6e2754feb50586a8c"
assert {path.name for path in (base / "corrections-v17").iterdir()} == set(manifest["files"]) | {"manifest.json"}
for path, digest in manifest["files"].items():
    assert sha((base / "corrections-v17" / path).read_bytes()) == digest, path
comparison = read(base / "corrections-v17/comparison.json")
assert comparison["schema"] == "material-facts-v7-postfreeze-correction/17"
assert comparison["expected_facts"] == 43 and comparison["planned_per_backend"] == 12
assert comparison["inference"] is False and comparison["new_holdout_run"] is False

# Independently inspect saved raw JSON/envelopes; no production parser is loaded.
def raw_candidates(row):
    text = row["raw_output"].strip()
    if text.startswith("```"):
        lines = text.splitlines()
        assert lines[0].strip() in ("```", "```json") and lines[-1].strip() == "```"
        text = "\n".join(lines[1:-1])
    value = json.loads(text)
    assert value["schemaVersion"] == 3 and isinstance(value["candidates"], list)
    return value["candidates"]


def defense_map(report, raws):
    facts = {}
    for case in report["cases"]:
        candidates = raws[case["id"]]
        assert case["raw_count"] == len(candidates)
        rejected = [item["index"] for item in case["rejected"]]
        assert len(rejected) == len(set(rejected)) and all(0 <= n < len(candidates) for n in rejected)
        kept = [n for n in range(len(candidates)) if n not in rejected]
        assert len(kept) == case["accepted_count"] == len(case["production_defense"])
        for index, item in enumerate(case["production_defense"]):
            assert item["index"] == index
            candidate = candidates[kept[index]]
            assert item["kind"] == candidate["kind"]
            assert item["calculation_authorized"] is False
            facts[(case["id"], kept[index])] = {**item, "raw_index": kept[index], "candidate": candidate}
    return facts


def defense_summary(facts):
    money = [item for item in facts.values() if item["kind"] == "money"]
    codes = {}
    for item in money:
        for code in item["issues"]:
            codes[code] = codes.get(code, 0) + 1
    return dict(accepted_money=len(money), amount_nonnull=sum(item["amount"] is not None for item in money),
                source_relation_unresolved=sum("source_relation_unresolved" in item["issues"] for item in money),
                exact_money_without_review_issue=sum(item["exact_money_without_review_issue"] for item in money),
                calculation_authorized=sum(item["calculation_authorized"] for item in money), issue_counts=codes)


def defense_changes(before, after):
    changes = []
    fields = ["amount", "normalization", "issues", "exact_money_without_review_issue", "calculation_authorized"]
    for key in sorted(set(before) | set(after)):
        left, right = before.get(key), after.get(key)
        left_state = None if left is None else {field: left[field] for field in fields}
        right_state = None if right is None else {field: right[field] for field in fields}
        if left_state != right_state:
            candidate = (right or left)["candidate"]
            changes.append(dict(case_id=key[0], raw_index=key[1], candidate=candidate, before=left_state, after=right_state))
    return changes

models = {}
layers = [f"{scope}_{mode}" for scope in ("raw", "accepted") for mode in ("basic", "relational", "strict")]
partition_count = 0
old_money_warnings = 0
for backend in ("rules", "qwen", "deepseek"):
    name = f"report-{backend}.json"
    old_bytes = (base / "corrections-v16" / name).read_bytes()
    new_bytes = (base / "corrections-v17" / name).read_bytes()
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
            assert sorted(paired_expected + missing) == list(range(expected_count))
            assert sorted(paired_actual + extra) == list(range(candidate_count))
            for pair in pairs:
                assert pair["event"] == labels[case["id"]]["expected_event_ids"][pair["expected"]]
                assert case["event_alignment"][layer.split("_")[0]][pair["actual"]]["event"] == pair["event"]
            actual = (len(pairs), len(extra), len(missing))
            assert actual == (row["tp"], row["fp"], row["fn"])
            tp += actual[0]
            fp += actual[1]
            fn += actual[2]
            partition_count += 1
        precision = tp / (tp + fp) if tp + fp else None
        recall = tp / (tp + fn) if tp + fn else None
        f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
        totals[layer] = dict(tp=tp, fp=fp, fn=fn, precision=precision, recall=recall, f1=f1)
        assert tp + fn == 43
        for field, value in totals[layer].items():
            for observed in (comparison["models"][backend]["corrected_metrics"][layer][field], report["metrics"][layer][field]):
                assert observed is None if value is None else math.isclose(observed, value, rel_tol=1e-12, abs_tol=1e-12)
    first = read(base / f"results/holdout-{backend}-1/report.json")
    prior = json.loads(old_bytes)
    raw_rows = [json.loads(line) for line in (base / f"results/holdout-{backend}-1/results.jsonl").read_text().splitlines()]
    assert len(raw_rows) == 12 and len({row["id"] for row in raw_rows}) == 12
    raw_values = {row["id"]: raw_candidates(row) for row in raw_rows}
    first_defense = defense_map(first, raw_values)
    prior_defense = defense_map(prior, raw_values)
    current_defense = defense_map(report, raw_values)
    old_money_warnings += defense_summary(first_defense)["source_relation_unresolved"]
    prior_cases = {case["id"]: case for case in prior["cases"]}
    partition_changes = [{"id": case["id"], "layers": [layer for layer in layers if case[layer] != prior_cases[case["id"]][layer]]}
                         for case in report["cases"] if any(case[layer] != prior_cases[case["id"]][layer] for layer in layers)]
    models[backend] = dict(v16_v17_report_byte_identical=(old_bytes == new_bytes), report_sha256=sha(new_bytes), cases=12, expected_facts=43,
        metrics_recounted_from_saved_match_partitions=totals, partition_changes_from_v16=partition_changes,
        raw=report["raw_candidates"], accepted=report["accepted_candidates"], rejected=report["rejected_candidates"],
        original_defense=defense_summary(first_defense), v16_defense=defense_summary(prior_defense), v17_defense=defense_summary(current_defense),
        defense_changes_from_original=defense_changes(first_defense, current_defense), defense_changes_from_v16=defense_changes(prior_defense, current_defense))
assert partition_count == 216
assert old_money_warnings == 46
print(json.dumps(dict(schema="material-facts-v7-v17-independent-artifact-check/1", status="PASS", model_requests=0, builds=0, scorer_imported=False,
    scope="Independent saved-match disjoint partition/count arithmetic, fixed denominators, file/code/archive binding and raw-index-aligned defense changes; not a replacement for source-semantic review or actual historical CLI gates.",
    case_layers_recounted=partition_count, historical_sha256=historical, original_result_files_verified=60, archived_v16_code_paths_verified=67,
    current_code_paths_verified=70, v17_manifest_sha256=sha(manifest_bytes), current_code_sha256=manifest["code_sha256"],
    original_accepted_money_relation_warnings=old_money_warnings, models=models), ensure_ascii=False, indent=2))
