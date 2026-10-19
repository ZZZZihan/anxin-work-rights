# LangGraph 与 D1 持久化基础

PR 1 为现有 TypeScript / Cloudflare Worker 项目提供 harness 状态与工具契约、D1 checkpointer 和可复现的进程恢复验证。业务入口仍使用现有流程；真实工具适配、运行调度和聊天入口属于后续接入。本次没有模型调用或微调。

固定依赖为 `@langchain/langgraph@1.5.1`、`@langchain/langgraph-checkpoint@1.2.0`、`@langchain/core@1.2.18`、`zod@4.6.7`，版本及传递依赖写入 lockfile。采用现有 D1 binding，以免为第一阶段增加服务或数据库。

## 状态与存储边界

业务合同见 [CONTRACT.md](./CONTRACT.md)。应用构造的 `HarnessState` 只存身份、事实版本、执行阶段、预算、待答问题和工具结果引用。原材料、摘录、模型全文和业务确认记录仍归各自受控存储所有。通用 checkpointer 会保存传入的图状态及引擎 metadata/pending writes，本身不是脱敏器；生产图必须逐项限制这些输入，并配置日志与 trace 的数据边界。

`D1CheckpointSaver` 的构造参数由已鉴权的服务端指定 `{ownerId, caseId, runId}`。所有读写、历史列表和删除都使用这三个条件。`thread_id` 必须等于 `runId`，请求或模型填入的 configurable owner/case 不会改变权限。恢复前仍需重新校验资源归属、当前 revision/generation 和业务条件；checkpoint 不能代替事实数据库。

迁移 `drizzle/0006_agent_harness_checkpoints.sql` 只新增两张表：

- `agent_harness_checkpoints`：完整 checkpoint、metadata 的序列化类型与 BLOB，以及 namespace、checkpoint ID、parent ID。保存 channel versions 和 versions seen。
- `agent_harness_checkpoint_writes`：按 task ID/write index 存储 pending writes，保留 task path 和序列化类型；普通输出重试保留首次值，引擎特殊写入采用官方索引规则更新。

适配器实现 `getTuple/list/put/putWrites/deleteThread`。批量 pending writes 和删除使用 D1 batch；序列化失败或 D1 错误直接失败，不退回内存。`list` 支持 namespace、before、limit 和 metadata 筛选；目前在授权 run 范围内读取后筛选，不承诺大规模历史扫描性能。迁移由现有显式迁移流程负责；本地 schema 初始化复用相同 DDL，saver 本身不建表。

## Worker 运行初始化

在启用 `nodejs_compat` 的服务端图执行入口，先调用 `initializeHarnessRuntime()`。本次实测 Wrangler 解析到 LangGraph 的 browser export，跳过 Node 入口的 AsyncLocalStorage 初始化，导致 `interrupt()` 找不到图上下文。该 helper 使用 `node:async_hooks` 以及 `@langchain/core/singletons` 的公共初始化接口；已有实例会被保留。没有 deep import，也不打开追踪或配置模型提供商。

Cloudflare 的 [AsyncLocalStorage 说明](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/)描述了运行时支持。暂停使用 `interrupt()`，恢复使用同一 thread 的 `Command({resume})`；恢复会重新进入被暂停节点，因此该节点在 interrupt 之前的副作用必须单独防重。见 [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。

## 可复现验证

从项目根目录执行：

```sh
npm ci
npm run check
npm run test:harness:http
ANXIN_MATERIAL_REPORT=output/harness/material-facts-http.json node scripts/material-http-runner.mjs --facts
```

最后一个命令使用 `npm run check` 生成的应用构建，验证迁移后的既有材料事实 HTTP 路径。单独运行合同及 saver 测试可用 `npx vitest run lib/agent-harness`。

`test:harness:http` 创建私有临时 Wrangler 配置，应用仓库迁移，启动真实 LangGraph + workerd，并使用落盘的本地 D1。测试 Worker 是 `scripts/harness-persistence-worker.ts`，没有连接到应用 router。它使用一次性授权 token、固定合成身份和合成工具；结束时清理进程和临时数据库，报告输出到 `output/harness/persistence.json`。CI 已配置为执行并上传报告。

15 项 HTTP 断言覆盖：

1. 拒绝无授权请求、重复开始、跨 owner/case 访问。
2. 暂停时保存状态、预算及待答问题；checkpoint 历史形成父链。
3. 确认成功并行节点的具体输出已写入 D1 pending writes 后，才让另一个节点失败。仅副作用计数增加或存在 ERROR write 都不足以构成此证据。
4. `SIGKILL` 终止整个 Worker 进程组，再使用同一数据库启动新进程；报告记录两次 PID 和不同 boot ID。
5. 恢复后的 harness 结构和值与暂停时完全一致；正常恢复不重跑已完成步骤，已完成运行拒绝重复恢复。
6. 恢复输入不能夹带事实确认字段；业务 revision/generation 已变时拒绝旧状态继续完成。
7. 并行失败恢复后，已保存输出的成功节点累计执行一次，失败节点恢复并完成汇合。
8. 删除仅影响当前 owner/case/run，其他作用域的同名 run 保留。

这些验证遵循 [LangGraph checkpointer](https://docs.langchain.com/oss/javascript/langgraph/checkpointers) 的 checkpoint / pending writes 语义。2026-10-19 的本机证据见 [验证记录](../validation/harness-pr1-20261019/README.md)。

## 后续接入的必要条件

checkpoint 的原子写入不保证外部工具副作用恰好一次。若工具已执行、结果尚未落库时进程退出，重跑仍可能重复副作用。后续必须把幂等键连接到持久工具执行账本、后端唯一约束和结果不明时的对账流程。

同一 run 的 invoke/resume 必须由调用方串行化，预算扣减也必须与执行权原子领取。PR 1 的策略返回已扣预算的 `nextState`，但不实现 run lease、并发调度或工具执行器。不能仅因两个请求都通过纯策略函数就同时执行。

PR 1 证明了本地 workerd/D1 中的暂停、硬重启、失败恢复与隔离；尚未验证云端 D1、生产流量、真实鉴权入口、长历史容量、真实工具副作用或模型任务质量。上线前还需明确保留期、案件删除关联清理、checkpoint 版本升级以及托管环境的验收。微调不在本阶段范围内。
