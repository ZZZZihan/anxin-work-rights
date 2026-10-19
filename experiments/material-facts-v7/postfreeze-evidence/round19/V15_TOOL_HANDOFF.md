# ROUND19 v15 tool handoff (author evidence)

The immutable v14 source archive was acquired from ROOT before application changes. All 61 source files matched corrections-v14/manifest.json at acquisition; all 61 stored snapshots were rehashed after tool preparation. The archive has exactly the required snapshot paths plus its own manifest. It does not rewrite correction results, earlier archives, the original freeze, data, labels or model outputs.

The new v14 execution bridge accepts only the exact corrective-assessment-v14.mjs --check path. It inherits the unchanged v1 execution state, keeps the original absolute 900-second root deadline, deducts 2 seconds for cleanup at each child level, preserves caller options and child failures, and records execution-policy evidence on stderr while leaving stdout unchanged. The v14 wrapper restores the 61 archived dependencies in its own temporary tree. The v15 controller validates archived v14 first, then computes current acceptance once over the original outputs, with no new inference. Its dependency union contains 64 paths.

The change_reason names exactly the three ROUND19 application changes: finite source rate attribution (按月/按日计/按小时/按件 and corresponding traditional forms), calendar/duration boundaries after an attached minus while retaining genuine arithmetic review, and standalone percentages without a monetary expression. Money-bearing proportions remain manual-review inputs and are not calculated.

The author actually ran six syntax checks, scoped lint, and seven narrow native Node subprocess contract tests (7 PASS, 0 FAIL, 0 SKIP). These use synthetic validators and prove only execution/cleanup/budget behavior. They are not a real-model, HTTP, legal or business acceptance result. No deep historical CLI chain, v15 publication, converted v14 gate or current v15 full gate was run. The final v15 gate was refined after its first static pass to bind the three affected application modules and to use source-rate guard byte drift; its final syntax/lint were rerun separately. The three core module hashes remained unchanged.

## Files for ROOT to copy

- correction-code-v14/ in full: 61 immutable snapshots plus its manifest.
- historical-v14-execution.mjs, verify-correction-v14.mjs, corrective-assessment-v15.mjs in the experiment directory.
- scripts/material-facts-v7-historical-v14-execution.test.mjs (new narrow 7-test suite).
- scripts/material-facts-v7-correction-v14-gates-independent.test.mjs (converted historical gate; exact ROOT and OURS pre-conversion source bytes are preserved in this evidence directory).
- scripts/material-facts-v7-correction-v15-gates-independent.test.mjs (new current gate; run only after ROOT publishes the integrated v15 artifacts).
- This ROUND19 evidence directory. The machine-readable handoff lists all exact hashes.

## Suggested ROOT integration (not performed here)

Keep the existing v14 gate filename registered, since it now checks archived v14. Append the new historical-v14-execution and correction-v15-gates-independent test paths to test:fact-runtime. For the workflow's current correction check, use corrective-assessment-v15.mjs --check after integrated v15 publication; if preserving the existing explicit historical-wrapper step pattern, add verify-correction-v14.mjs before it. Keep all original frozen verification steps. New artifacts, if explicitly collected by the workflow, are corrections-v15/, correction-code-v14/ and postfreeze-evidence/round19/; do not replace older evidence.

ROOT owns package/workflow changes, final application integration, v15 --write/--check, full gates and any commit/push. The new gate's two actual current CLI negative probes use separate 960-second outer bounds and a 1980-second parent test bound; each invocation's historical subtree still shares one absolute 900-second deadline. This author has not claimed those deferred probes passed.
