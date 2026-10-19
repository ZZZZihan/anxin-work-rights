# Agent harness 运行合同（schemaVersion 1）

本合同约束 harness 的状态、模型动作建议和工具边界。PR1 只提供合同、策略和隔离持久化验证，不接聊天入口、不调用模型、不连接真实案件数据库、不改变现有事实确认入口。这里的测试使用合成数据，不能作为真实案件准确率、已上线 Agent 或法律判断的证据。

## 信任来源

`TrustedScope` 由经过鉴权的服务端提供，含 `ownerId/caseId/runId/revision/generation`。`revision` 是事实状态版本，`generation` 是材料代际；两者都必须与当前服务端状态相同。恢复 checkpoint 后，服务端重新鉴权、重新读取当前版本；checkpoint 的 owner、版本或已读事实不能代替当前授权。

模型只输出 `ActionProposalSchema` 中的建议，必须携带 `expectedSnapshot`，不能携带 owner、case、run、actor、verified、confirmed、canCalculate 或幂等键。所有对象拒绝额外字段。确认主体、确认金额、撤回确认和排除材料不在模型动作中。`ask_user` 只是生成等待请求；用户确认仍通过已有可信用户操作入口完成。用户回复或 `resume` 数据本身不会把未知金额提升为确认金额。

`PolicyContext.currentFacts` 与 `userRequest` 只能来自服务端：前者是本次现读的事实摘要，后者是明确的用户计算请求。它们不持久化到 harness 状态作为未来授权。`permittedEvidenceIds`、`permittedJobIds` 是服务端核实属于本案的资源集合；省略集合时拒绝对应资源动作。适配器在实际访问时还要核实证据块、材料和任务的案件归属，不能仅相信模型提供的 ID。

`authorizeProposal` 同时验证状态、动作、当前可信上下文、版本和剩余预算，然后返回动作效果、超时、服务端构造的幂等键及已扣预算的 `nextState`。它是纯函数，不执行工具；调度器必须在执行前原子持久化/claim `nextState`，避免失败或重启恢复无限重放，也不能让并发执行者共享同一份剩余预算。不要在消费 `nextState` 后再次调用 `consumeBudget` 重复扣费；该函数保留供独立的调度控制使用。每次恢复、重试和下一步都重新授权。实际写入必须再次做 owner + revision + generation 的原子比较更新；先过策略校验不排除之后发生的并发变更。

## 状态与预算

`HarnessState` 含 `schemaVersion`、owner/case/run、快照版本、阶段、状态、预算、待用户输入、工具结果引用和安全错误码。状态中不保存原始证据、模型原文、用户回复、事实确认凭据、令牌、Cookie 或原始异常消息。没有通用自由文本 trace 字段。工具结果存储单独做 owner/case 访问控制与保留期限，checkpoint 只存不透明 `resultRef`；`toolResultReference` 从通过 schema 和 scope 校验的输出创建引用。

- `running` 对应 `planning` 或 `tool`，没有待用户请求。
- `waiting_user` 必须对应 `awaiting_user` 且有 `pendingUserInput`，请求的快照等于当前状态快照。
- `completed/failed/cancelled` 必须对应 `finished`，不能继续消费预算。
- 剩余步骤、剩余工具次数各在 0–100；绝对截止时间使用有限安全整数毫秒。每个建议消费一步，实际工具另消费一次工具预算。到期或任何所需预算耗尽都拒绝执行。

待用户请求只含 requestId、固定 reason、固定字段名和版本；问题文案由服务端模板渲染。即使工具预算为零，仍可在剩余步骤与时间内提出 `ask_user` 或 `finish`。状态版本变化时，旧待用户请求不能直接作为当前请求恢复。

## 工具输入、输出及效果

模型建议与服务端工具输入是不同 schema。服务端在建议通过策略后填入 `callId`、可信 `scope`，写工具另填 `idempotencyKey`。适配器必须把输出关联到原调用的 callId、tool 和资源 ID，并使用实际操作后的可信 scope；不得通过修改 envelope 来掩盖过期结果。

| 动作 | 输入内容（不含公共 envelope） | 成功输出 data | 效果 | 超时上限 |
| --- | --- | --- | --- | --- |
| `read_facts` | 无 | 当前 scope、stale、canCalculate、due/paid 状态与分值 | reconcile | 10 秒 |
| `read_evidence_excerpt` | evidenceId、blockId、maxChars（1–4000） | 同一证据块的限长 text、truncated | read | 5 秒 |
| `search_public` | query（1–500 字符）、limit（1–10） | 至多 10 个 sourceId/title/HTTPS URL/excerpt | read | 10 秒 |
| `get_job` | jobId | jobId/evidenceId/status/generation | reconcile | 10 秒 |
| `start_extraction` | evidenceId、幂等键 | jobId/evidenceId/status/generation | write | 15 秒 |
| `request_calculate` | 用户 requestId、幂等键 | receiptId/dueCents/paidCents/gapCents | write | 10 秒 |

现有事实读取或任务轮询可能对账并更新事实，因此 `read_facts/get_job` 标记为 reconcile。它们不能被当成无状态读取，恢复后必须重新核实当前快照。`start_extraction` 默认关闭，只有服务端显式开启策略且材料属于本案才允许。PR1 不提供抽取、计算或公开检索的业务适配器。

超时由执行器以取消/AbortSignal 或后端请求截止时间落实，不能只在合同里记录数字。写工具的幂等键由 owner/case/run/版本/动作/资源或用户 requestId 确定；同一操作重试得到同一键。适配器必须持久化去重结果，并在返回丢失或执行结果不明时先对账；重复键不允许重复启动任务或生成不同计算收据。不同后端不能仅凭此键绕过既有事务和唯一约束。

工具输出是具体的判别联合，拒绝任意对象占位、任意异常文本和额外元数据。`toolResultReference(raw, expectedCall, expectedResultScope?)` 同时绑定调用的 callId/tool/证据块或任务 ID，并检查摘录长度和检索数量。默认输出快照必须等于调用快照；对账/写入确实推进 revision 时，只能由服务端现读版本作为第三参数，generation 改变仍拒绝旧调用结果。事实摘要的内部 scope 必须等于输出 envelope；任务 generation 必须匹配；计算 gap 必须等于安全整数分值的 due-paid。证据摘录只存在于受控工具结果中，不写 checkpoint 或 trace。公开搜索适配器还应遵循当前产品的查询隐私规则，不能把检索工具视为发送案件原文的授权。

## 计算门槛与未知值

计算需要同时满足：用户明确请求计算；用户请求、当前事实、状态及模型建议均指向同一 owner/case/run 和 revision/generation；当前事实 `stale=false` 且 `canCalculate=true`；due 与 paid 均为已确认的安全整数分值。`unknown/candidate/conflict` 的 cents 必须是 `null`；不能填 0。已明确确认的零付款表示 `{status:'confirmed', cents:0}`，可以计算。

模型不提交计算金额，不能用 `canCalculate` 标记、自然语言“用户已确认”或旧 checkpoint 代替可信事实。`request_calculate` 只是请求可信计算服务；服务端应继续沿用现有事实准备及 owner/revision/generation CAS 计算路径，不在模型或编排节点里自行做金额推断。

## 错误与恢复

统一错误只含 `code` 和 `retryable`，不含原始日志。策略拒绝使用 `HarnessPolicyError.code`；错误对象的 message 也是固定错误码，可安全转成状态 `lastError`。

| 错误码 | 含义及调度要求 |
| --- | --- |
| `invalid_input` / `forbidden` | 输入合同或权限失败；拒绝动作，不改事实，不盲重试 |
| `stale_snapshot` / `conflict` | 版本或并发冲突；重新读取可信当前版本并重新规划，不复用旧确认 |
| `user_input_required` / `calculation_not_ready` | 缺明确请求或计算事实不完整；等待用户核实，不补零 |
| `extraction_disabled` | 未启用抽取策略；不自行启动 |
| `budget_exhausted` | 时间、步骤或工具预算耗尽；停止调度 |
| `not_found` | 资源不存在或不再可访问；不换用其他案件资源 |
| `timeout` / `unavailable` | 暂时失败；在有限预算内重新授权后处理。写入结果不明时先用原幂等键对账 |
| `cancelled` / `internal` | 已取消或未分类内部失败；停止或进入受控恢复，不暴露原始异常 |

`retryable` 是适配器给调度器的提示，不构成重试授权。自动重试还需满足当前 scope、版本、预算、效果和幂等要求。模型或材料中的重试指令不影响策略。

## 验证边界

`contracts.test.ts` 与 `policy.test.ts` 使用合成数据验证：额外授权字段被拒绝、跨 owner/case/run 被拒绝、过期版本被拒绝、未知金额不会变零、零付款计算门槛、预算到期、抽取策略、资源归属、幂等键与安全结果引用。真实 LangGraph、独立 workerd 进程和本地 D1 的恢复证据见 [持久化验证](./PERSISTENCE.md)。合同单测、进程恢复和现有业务 HTTP 回归分别记录；本地 D1 验证不代表云端 D1 部署或生产业务已接入 harness。
