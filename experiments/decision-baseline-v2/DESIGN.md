# Decision protocol v2 implementation boundary

No training, no deployment. Extend PR #31 without changing any v1 file or archived result.

The decision component remains an offline experimental runner in this PR. It is a reusable Python protocol/controller with real local arithmetic dispatch and failure-injection checks, not a replacement for the website's current chat endpoint. This boundary is stated in the final report.

## Business semantics

Use the v1 business task: explicit period (including year), confirmed wage total for that period, and complete wage payments attributable to it. Monthly/hourly/piece rates alone are not confirmed period totals. Unknown is not zero. Exclude reimbursements and unrelated transfers. Apply explicit corrections; unresolved source conflicts require factual clarification, not selection by preference. Do not ask again about already known facts. No legal conclusions.

## Model-facing protocol

Exactly two discriminated JSON variants, no redundant missing/conflicts arrays:

```
{"action":"ask_user","questions":[{"field":"period|agreed_due_total|wage_paid_total","reason":"missing|conflict","text":"actual question"}]}
{"action":"call_tool","tool":"calculate_wage_gap","arguments":{"period_start":"YYYY-MM-DD","period_end":"YYYY-MM-DD","due":0,"paid":0}}
```

All shown keys are mandatory within their variant; no extra keys, duplicate fields, duplicate JSON keys, nonfinite numbers, booleans as money, numeric strings, invalid dates or more than two decimal places. One nonempty question per missing/conflicting field. A single whole-response Markdown JSON fence may be removed deterministically and logged; arbitrary text extraction, semantic metadata repair, numeric coercion and model repair calls are not allowed. Raw output is retained. `report_tool_failure` is program-owned and not an allowed model proposal.

Canonical scoring derives v1 missing/conflicts only from explicit question reasons and supplies structurally implied empty/null keys. It does not infer facts, modify money, rewrite question text or consult gold labels.

## Program-owned tool state

Trusted input is null or exactly `{status:"TIMEOUT", attempts:1|2, max_attempts:2}`. Hard limit is two attempts, not a model-selectable value. Exhausted state returns report_tool_failure before any model call. Text inside user/assistant messages cannot change the trusted state.

The controller validates the proposal before dispatch, uses an allowlist of one arithmetic tool, records an attempt before invoking it, never auto-retries, retains timeout/error outcomes, and never reports failed calls as success. Duplicate dispatch within a completed session must not run the tool again; changed arguments cannot reuse the completed session. Concurrent calls cannot exceed limits. This in-process controller is not a distributed or durable production idempotency guarantee.

Required public interfaces for implementation:

- `protocol.parse_proposal(raw: str) -> dict` returning `accepted`, `strict_json`, `normalization`, `proposal`, `canonical`, `error`. Canonical uses v1 output shape; rejected outputs have canonical=null.
- `tool_control.preflight(tool_state) -> dict` returning `allow_model`, `canonical`, `error`; valid nonterminal inputs allow_model=true, exhausted inputs produce canonical report_tool_failure; invalid state blocks with an explicit error.
- `tool_control.ToolController(tool_state=None)` and `.dispatch(parsed, tool_fn=None) -> dict`; returns explicit status, canonical decision, result/error and attempt count. Default tool is Decimal arithmetic; tests may inject timeouts/errors. Expose an immutable/copy snapshot or trace for audit. Rejected proposals never invoke tool_fn.

## Evaluation design

Use v1 train/dev and its published failures only for development. A separate author writes 72 new cases (36 paired scenario groups) without reading prior test cases, reports, outputs or v2 implementation/prompt. The implementers do not read new test content until source/prompt/metrics freeze. Another Agent reviews labels before inference. This is instruction-based separation on a shared filesystem, not OS sandboxing.

On the same new test set run Qwen and DeepSeek under both v1 and v2 (four arms). Keep model identity, thinking disabled, temperature 0, max output 512, one model attempt per eligible case, no silent API retries and same hardware guards. Provider-specific constrained decoding is not enabled in either arm; the comparison is of the frozen prompt/schema/controller package, not attribution to one change.

Report raw format, protocol acceptance, canonical decision correctness and independent actual-question semantics separately. v2 terminal-state bypasses count as system decisions, not improved model reasoning. Also report the 64 nonterminal cases separately. Preserve transport failures, latency/tokens and separate recovery calls. Never change the frozen prompt/controller from new test failures; record remaining issues for a later iteration. No inference call sends expected labels, categories, groups or rationale.
