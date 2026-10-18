# fa77dbd5 精确 CI 失败检查点

精确提交 `fa77dbd5bd9942ed1a94d74293b35160aae1e91b` 的 [CI 39152232243](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39152232243) 终态为 **FAILURE**。唯一失败是测试夹具读取尚未完整发布的 ready JSON，不能把本次运行记为整体验证通过。没有重跑、取消、修改产品、修改评审状态或触发部署。

实际 checkout 是 PR 合并提交 `b46c07a1318a36fba3ffb482cb00033c331642fe`。原始 checkout 日志、GitHub commit API 与本地精确提交树三者相符：合并树与 fa77 应用树均为 `37da4f77ce01c4f0fd03d83fd2de1c0480bc492f`。开始审计时核对的十个产品、HTTP 和 package 文件也与父侧被测工作树逐字相同。测试环境是 Ubuntu 24.04.5、Node 24.21.0、npm 11.19.0、Python 3.12.15。

实际日志显示：

- Vitest **1789/1789、46 文件通过**。
- 材料服务测试 **68 通过、0 失败、0 跳过**，包括真实平台 OCR 的合成 PNG/PDF 检查。
- runtime **8892 项：8891 通过、1 失败、0 取消、0 跳过**，耗时 **75620.124938ms**。此处是 Node 顶层运行器报告的 tests 计数，不另加入嵌套叶重复累计。
- 完整 `npm run check` 退出 **1**。CI 的 27 个步骤为 **15 success、1 failure、11 skipped**；21 条 ESLint warning 不是失败原因。

失败叶为 `stop owned HTTP launcher and listening descendant: redirected-ignore-term`，定义于 `scripts/material-facts-v7-http-process-tree.test.mjs:75:92`。异常发生在 fixture 的第 69 行，`JSON.parse(await readFile(record))` 抛出 `SyntaxError: Unexpected end of JSON input`，叶耗时 **102.658461ms**，不是超时。精确提交快照显示 leaf 直接写 `leaf.json`，而 readiness 只等 `readFile` 成功；文件已创建但 JSON 尚未完整时，下一行即可解析失败。异常位于 fixture 内，在该叶调用 `stopChild` 和断言进程树清理之前。因此本次失败不构成金额断言失败，也不能作为该叶清理行为已通过的证据。父侧已另派 DATA 修复夹具发布方式；本审计未实施或重跑该修复。

冻结公共材料步骤已在 runtime 之前通过：v4 原版及复验、v5 verify/summary、v6 归档旧依赖的临时树入口及原 verify/summary 均运行。v6 日志明确 `inference:false`、`summary_checked:true`、`current_product_validation:false`。本审计另外只读核对四个历史 result-manifest 枚举的 **147 个文件**：v4 58、v4 replication 50、v5 20、v6 19；本地 SHA256 匹配原 manifest，Git blob 匹配本次精确 head 的树。它们是旧输出身份核对，不是新推理或重新实验。

后续 HTTP persistence、synthetic HTTP、production material/facts、cancel、poll、recovery、v7 HTTP410 及 OCR HTTP 步骤**全部跳过**。两个 always-upload 步骤虽显示 success，artifact API 实际返回 **0 个附件**，所以没有 HTTP 报告 ZIP 或附件 digest 可以验证。本地父侧 fullcheck、HTTP410、411 raw 与 409 restart 的报告已原样保存并明确标成父侧本机证据，不能替代本次远端未执行的步骤，也不能称本次 CI 的 cleanup/raw/restart 通过。

终态读取时，PR45 head 仍为 fa77，完整分页为 **125 个线程、7 个未解决线程**；`outdated` 没有被当作 `resolved`。只读查询精确 head 与实际 checkout merge 的 GitHub deployments 均为 0 条；这不证明其他系统从未部署。

`run39152232243-original-logs.zip`、18 个原始日志成员、完整 `gh run` 日志、原始 API、精确源码快照和失败汇总均保留。`collector-corrections.json` 单列了本地索引程序的首分页汇总错误、文件名处理错误以及未执行的成功审计脚本，均未混作 CI 产品失败，也未覆盖原记录。`copy-index.ci-fa77dbd5.json` 是本次交付的逐文件 SHA256 白名单。

本 Agent 曾实现本轮 event-only 补丁，因此本报告仅是远端执行证据的独立核对，不能冒称该 event 实现的非实现者技术复核；DATA 的独立测试属于另一证据层。合成测试、OCR 检查和冻结旧结果核对均不构成真实案件、真实模型、法律意见或用户人工业务验收。请求配置延续 GPT-6.1 Sol / ultra，实际 backend 无法独立核验。
