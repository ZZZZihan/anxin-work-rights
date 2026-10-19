# Harness PR 1 验证记录

日期：2026-10-19。基线为 `ecd1db0ba32dad97c2b05f78e6608d1c3d2a03c9`，关联 [Issue #47](https://github.com/ZZZZihan/anxin-work-rights/issues/47)。范围为状态/工具契约、D1 checkpoint 存储与本地 Worker 恢复。输入和工具均为合成夹具，没有真实案件、模型推理或训练。本机 Node 为 `v26.11.0`，CI 配置使用 Node 24。

| 证据 | 命令与结果 |
| --- | --- |
| 必需全量检查 | `npm run check`，exit 0；类型、ESLint、44 个 Vitest 文件的 1209 项测试、生产构建、数据完整性/索引、材料与事实运行测试通过 |
| 本次针对性检查 | 上述 Vitest 中包含 14 项合同/策略测试和 7 项 Miniflare D1 saver 测试；独立复核 Agent 也运行这 21 项并通过 |
| 真实进程恢复 HTTP | `npm run test:harness:http`，exit 0，15/15 通过；[persistence.json](./persistence.json) |
| 既有材料事实 HTTP | `ANXIN_MATERIAL_REPORT=output/harness/material-facts-http.json node scripts/material-http-runner.mjs --facts`，exit 0，10/10 通过；[material-facts-http.json](./material-facts-http.json) |
| Diff 与迁移 | `git diff --check` 通过；0006 只新增两表，Drizzle snapshot 原有表未改变 |

`npm run check` 中材料运行测试为 67 项通过、1 项按平台跳过：Linux Tesseract/Poppler 用例在 macOS 不运行，macOS 的真实 Apple Vision OCR 由现有 material-service 测试覆盖。事实运行的 Python 测试分别 11/11 和 16/16，通过的 Node 测试为 30/30；公开数据 Python 检查 9/9。这里的全量通过包括该明确的平台跳过，不代表本机执行过 Linux OCR。

持久化报告记录两个不同 wrapper PID 和 Worker boot ID。runner 先暂停图、读取状态和父链；确认另一条并行运行已持久保存成功节点的具体 pending output 后，强制终止整个 Worker 进程组，并对同一份落盘 D1 启动新 Worker。恢复后 harness 结构和值相同，正常流程的准备步骤累计一次，失败流程的成功并行节点累计一次。另覆盖旧业务版本拒绝、非法恢复字段、重复开始/恢复、跨用户/案件读取和限定作用域删除。完整验证语义见 [PERSISTENCE.md](../../agent-harness/PERSISTENCE.md)。

既有应用 HTTP 回归验证了规则候选保留原文、owner 隔离、未知付款不能补零、冲突需用户说明、显式零及分值精度、并发修订单胜者、材料变化失效、删除清理和案件范围变更失效。它使用构建后的现有应用与隔离 D1/R2；与独立 harness Worker 分开执行。

独立技术复核检查合同授权、预算传递、工具结果与原调用绑定、实际安装版 LangGraph 的 saver 语义、serde type/字节偏移、pending writes 顺序和原子批次、Worker 异步上下文，以及失败夹具的完成前置条件。复核发现的预算返回、结果绑定和并行测试竞态已修正，最终没有 PR 1 范围内的阻塞性发现。

本次由主 Agent 集成及验证，3 个子 Agent 分别负责合同/策略实现、D1 saver 实现和独立技术复核；子 Agent 的请求配置均为 `gpt-6.1-sol / ultra`。工具未独立暴露每次底层运行配置，故不把请求参数当作实际运行配置核验。技术复核不是用户人工验收。

依赖审计与基线 lock 比较：npm audit 报告的 24 项（moderate 6 / high 15 / critical 3）对应节点在基线已有且版本相同，本次新增依赖没有增加该次 audit 报告的漏洞节点；本 PR 未修复这些既有问题。该结果不代表依赖不存在其他风险。

截至这份本地记录，尚未执行云端部署、真实鉴权/工具接入、同 run 并发调度、外部副作用幂等验收、模型质量评测或用户人工验收。GitHub CI 的结果以 PR 对应 commit 的实际检查为准。源码及复现脚本的 SHA-256 见 [manifest.json](./manifest.json)，便于区分本地证据与后续改动。
