# Decision baseline v1 contract (frozen before test generation)

No training. Only synthetic arithmetic-intake decisions. No legal entitlement findings.
Input record: {id, messages:[{role:user|assistant,content:string}], tool_state:null|{status:"TIMEOUT",attempts:2,max_attempts:2}}.
Only those input fields go to inference. No category, split, family, rationale, or expected output is sent to any baseline.
Output: {missing:[field], conflicts:[field], next_action:{type,questions:[{field,text}],tool:null|string,arguments:null|object}}.
Fields exactly: period, agreed_due_total, wage_paid_total.
Types exactly: ask_user, call_tool, report_tool_failure.
Every output includes all six structural fields shown above (missing,conflicts,next_action and its type,questions,tool,arguments).
ask_user: questions must cover missing UNION conflicts; each question has exactly one field and nonempty natural-language text. May not ask about known fields. tool/arguments=null.
call_tool: missing/conflicts/questions empty, tool=calculate_wage_gap, arguments={period_start:YYYY-MM-DD,period_end:YYYY-MM-DD,due:number,paid:number}. Only explicit confirmed period total and all wage payments attributable to it can be used. Never infer period total from monthly salary/calendar month. Non-wage transfers must not count as wages. Explicit zero is valid; unknown is not zero. User-explicit corrections override their superseded statements; unresolved conflicting sources require clarification. A negative difference is arithmetically valid, not a debt finding.
report_tool_failure: when TIMEOUT and attempts>=max_attempts, no questions/tool/arguments. Retry limit enforced by harness as well as measured in raw output.
Information absent => missing. Multiple unreconciled candidates => conflicts, not simultaneously missing for same field.
An ambiguous wage-payment attribution is missing wage_paid_total. A payment amount can be known yet still unusable as wage_paid_total.
Labels: {id,split,group_id,category,synthetic:true,provenance:"agent_authored_synthetic",expected:<output>,rationale:string}. One group may have 2-3 contrast cases, kept in one split. Cases must be authored as natural conversations/messages, not templated field:value copies. Distinct scenario groups and wording across train/dev/test; do not generate quantity by merely replacing names/amounts.
Target size: 24 train, 12 dev, 72 test. Test >=30 distinct scenario/contrast groups. These are synthetic held-out authoring groups, not 72 independent real-world samples. Test kept hidden from rule implementer and no post-test rule/prompt tuning.
Categories: missing_period, missing_due, payment_attribution, complete, mixed_payment, conflict, multi_turn, tool_failure. Balance overall; include paired known/unknown, negation, corrections, zero, decimals, unrelated money, partial period, multi-month totals, mixed reimbursement. Don't assert full calendar month implies attendance or monthly salary total.
Split inference files and gold labels: train.inputs.jsonl,train.labels.jsonl,dev.inputs.jsonl,dev.labels.jsonl,test.inputs.jsonl,test.labels.jsonl. train.sft.jsonl can be assembled later by parent.
Evaluation is ONE-STEP next action, including multi-turn history snapshots, plus deterministic tool arithmetic replay. It is not live user multi-turn completion, OCR, RAG, legal correctness, or production validation.
