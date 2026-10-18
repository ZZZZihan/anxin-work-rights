# Independent design review, v2

Read-only review of repository AGENTS.md, v2 DESIGN.md, v1 frozen contract/prompt/parser/runner/evaluator/report. No new holdout content was read for this stage. No model, API or training execution.

The task remains a synthetic one-step wage arithmetic intake decision benchmark. The protocol/controller change is a package comparison and does not isolate one causal factor. This is an offline reusable component, not website deployment or real-case/legal validation.

## Findings to resolve before freeze

1. Compare exactly the same planned 72 IDs in four arms and the same 64 nonterminal IDs separately. Eight terminal program bypasses are system outcomes, not evidence of better model reasoning. First attempts retain missing/transport-failure rows in planned denominators; separate recovery never overwrites them.
2. Preserve v1 parser and canonical acceptance semantics for the legacy package. Do not silently impose new v2 validation on v1 outcomes.
3. A neutral raw-JSON metric needs one common implementation across arms: v1 parse_output treats Python json.loads success as strict_json, which permits duplicate keys and NaN/Infinity. Report either a common stricter raw metric or explicitly call the old result legacy strict_json; avoid sharing one label for different predicates.
4. Natural-language question adequacy is independent of field tags and cannot be inferred from canonical correctness. Review all actual question-bearing outputs plus failures/malformed outputs where semantics may still be meaningful. Non-question arithmetic proposals can be checked deterministically against immutable labels.

## Implementation checks pending

- Exact trusted-state allowlist, attempts max 2, invalid state blocks model calls, terminal state bypasses before inference.
- Proposal rejection before dispatch; counters recorded before invoking arithmetic; timeout/error preserved; no auto retry; same-session duplicate and changed-argument behavior; concurrent calls.
- Immutable audit snapshots, tool/result identity, no label/category/rationale/group in any inference payload.
- One model call per eligible case, same decoding guards/model identity, transport failures and separate recovery accounting.
- Freeze source/prompt/metrics before implementers read holdout; holdout author and reviewer separation is instruction based on shared filesystem.

Initial design conclusion: no blocking task-definition flaw found. The raw-format consistency item above requires an explicit frozen implementation choice; implementation and new labels remain unreviewed at this stage.
