v14 产物完整性独立验收通过；应用仍因新发现的 ROUND19 三项问题阻塞。本记录状态为 `ARTIFACT_PASS_APPLICATION_BLOCKED`，不把产物可复验或旧范围回归通过当作整个 PR 可合并。

本人实际执行 ROOT 的 `scripts/material-facts-v7-correction-v14-gates-independent.test.mjs`：5/5 通过，退出 0，总耗时 156263.702666ms。该门禁由 DATA 作者准备，本人未参与实现相应版本桥/控制器，独立审阅并执行。两个真实 CLI 负例分别耗时 78471.02875ms 和 76323.522708ms；均以预期校验错误退出 1，分别拒绝 JSON 内容相同但字节不同的当前 manifest，以及仅注释发生变化的范围守护代码。它们不是因超时而被当作拒绝。其他检查覆盖 61 个当前依赖、58 份历史代码恢复与异常清理、窄只读入口，以及测试前后受保护字节不变。

独立轻量复算没有导入原 scorer：对 3 路×12 案×6 层共 216 个已存匹配分区检查完整性和互斥性，重数 TP/FP/FN 并重算 P/R/F1，分母固定每路 43 条 gold。report 与 comparison 均吻合。门禁完成后又执行同一复算及全部字节检查，输出与门禁前逐字相同。

- v14 manifest：`7ad12cb5543f7c750c7393366d115205e876ca0817333cef0a5462d2a39562cd`
- 当前 61 个代码 hash、v13 归档 58 个 snapshot、原始 60 个结果文件、freeze/result-manifest 和 v1 至 v13 各 manifest 及其输出字节全部核对通过。
- 三份 v14 report 与 v13 逐字相同；输入、临时技术标签和原始模型输出未重写，未调用新模型。

六层计数为 TP/FP/FN，raw 与 accepted 分别列出：

| 路径 | basic raw / accepted | relational raw / accepted | strict raw / accepted |
| --- | --- | --- | --- |
| rules | 2/0/41 · 2/0/41 | 0/2/43 · 0/2/43 | 0/2/43 · 0/2/43 |
| Qwen | 16/47/27 · 16/35/27 | 10/53/33 · 10/41/33 | 8/55/35 · 8/43/35 |
| DeepSeek | 34/17/9 · 34/17/9 | 27/24/16 · 27/24/16 | 25/26/18 · 25/26/18 |

ROUND18 的五项已分配问题另有最终 application 收据：独立设计的 61 项业务和 4 项信号回归通过，另执行主侧编写的 2 项 helper 测试通过。最终 cancel/poll 使用 abort+release 唤醒操作，由 finally 单独终止自有进程组；原双 TERM 版本的记录不改写。四条显式混写角分旧契约迁移另有 full/crop/非法精度动态证据。本人只读比较主侧 HTTP118 报告，同 119 份合成输出及 118 场景，新旧分别 118/0 与 106/12，cleanup 均通过，重启比较 117 份 raw/history/state 快照；本人没有启动该应用 HTTP 或把重启状态不变等同二次验证全部派生金额。

产物验收期间，主侧收到并已分派新的三项应用问题，留待 ROUND19 精确基线独立红绿复核：

- 4306516513：工资后的按月、按日计、按小时、按件等明示费率漏判。
- 4306516516：金额后的 ASCII/全角横线接日期或时长，被算式守护误当减法。
- 4306516518：50%、百分之五十、出勤率50% 等纯比例作为 money candidate 被接受。

这三项不由本次 v14 产物通过消除，也不回写本轮早先有限范围 application 收据。新旧 frozen 文件及旧报告均保持原样。非专家标签、有限词法边界及真实业务残余风险沿用既有记录。

已有结果中，amount 非 null 条数为 rules 2、Qwen 8、DeepSeek 10，但无复核问题的 exact money 为 0，所有 calculation_authorized 都为 false。accepted、派生金额和计算授权分别判断，不能据此进行自动核算或宣称法律准确。

完整证据与精确 hash 见 `round18-review.independent.json`；原始独立证据在 OWN 根目录 `postfreeze-evidence/round18/`。请求 GPT-6.1 Sol ultra，实际运行 backend 无法独立核验。本人未提交、推送、合并、部署、训练、构建服务或调用模型。主侧后续完整整合检查与远端 CI 应按实际完成时点单列。
