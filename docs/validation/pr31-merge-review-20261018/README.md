# PR31 合并前独立复核与验证链修复

日期：2026-10-18。原 PR31 基线：`e53836a12d241d93c2da5c577410f01e80053f51`。范围对应 [Issue #44](https://github.com/ZZZZihan/anxin-work-rights/issues/44)。本记录区分局部复现、原回归与主 Agent 的最终整合检查，不代表合并、部署或业务人工验收。

4 条未解决 P2 全部复现，并通过正式 CI 验证入口和迁移脚本修复。没有修改封存原始输出、金标、评分协议、freeze 或历史 comparison。前后动态证据见 [before.json](before.json) 与 [after.json](after.json)。

| 原问题 | 原版证据 | 修复后证据 |
| --- | --- | --- |
| [CI 忽略未跟踪生成物](https://github.com/ZZZZihan/anxin-work-rights/pull/31#discussion_r4293401594) | 文件移出 Git 跟踪后仍存在，旧 `git diff` 返回 0 | 8 个必需路径在临时真实 Git HEAD 下均形成 `D` 与 `??`；旧检查全部返回 0，新 index 守护全部拒绝 |
| [整合脚本硬编码 ROOT](https://github.com/ZZZZihan/anxin-work-rights/pull/31#discussion_r4293401605) | 当前隔离树的脚本仍指向作者旧工作树 | 从 `__file__` 定位；迁移副本正常执行返回 0，仅篡改该副本后返回 1 |
| [assessment 未从 raw 重算](https://github.com/ZZZZihan/anxin-work-rights/pull/31#discussion_r4293401614) | rules 主指标改成 0，原 summarizer 仍生成主指标 0 的比较表 | 新验证器从 raw 重算，拒绝该篡改及 assessment/diagnostic 逐项或汇总篡改 |
| [审查包与映射目标未绑定](https://github.com/ZZZZihan/anxin-work-rights/pull/31#discussion_r4293401624) | 交换同属 rules 的两个目标后原 summarizer 仍接受 | 新验证器核对输入、金标、原始/解析输出与传输状态，拒绝错配及各字段篡改 |

v3 封存了 v1 顶层 Python 内容与清单，因此新验证器和回归位于 `experiments/decision-baseline-v1/verification/`。正式入口先重算 216 条 assessment 与 216 条 diagnostic，核对 145 条审查包，再在系统临时副本中运行历史 summarizer，要求 comparison 与存档逐字节一致。验证器不写存档。历史低层 `summarize.py` 保持冻结，独立调用它不能替代新正式验证入口。

CI 在任何生成器之前检查 v1/v2/v3 的 freeze.json、comparison.json，以及 v3 replication 的 freeze.json 别名、comparison.json，共 8 路径必须被 Git 跟踪且存在。迁移检查脚本的临时比较表也放到系统临时目录，避免干净 checkout 因新增中间文件而触发自身快照不变断言。

子 Agent 实际执行：

- Python 3.14：原 v1 37/37、新回归 11/11、原 v2 68/68、原 v3 79/79；v2 reporting self-test 28 项通过。
- v1/v2/v3 冻结与数据验证、主运行和补充运行报告复现、独立 `REPLICATION_PROBE.py` 通过。
- Python 3.12：新 11/11、正式只读验证器和 v2/v3 冻结检查通过。
- 比较表 SHA256 保持 `222e7379ff8aebe31d271dea0cafb0d3067784632b306df1b60dcb20fce0b89d`，原数据、raw、freeze、comparison 及 v2/v3 无差异。

主 Agent 独立整合检查：`npm run check` exit 0（应用测试 107、公开数据测试 9、材料测试 23 通过/1 个 macOS 条件跳过），新 11 项回归通过；正式验证器重算 216+216、核对 145 包、comparison 哈希相同。GitHub 新提交 CI 与合并后检查由主 Agent 另行记录。

可信事实边界的已读范围包括 v3 facts/guard、v2 tool_control 及现有撤回、unknown≠zero、期间失效、参数/版本拒绝与执行锁回归；未识别新的可复现阻塞。PR31 没有 app/lib 差异，也未把离线控制器接入 `/api/chat`。受控 confirmation 仍是可信调用方的离线输入，不能证明互联网用户认证或真实材料准确性。本次未新增完整 API/HTTP 对抗集或业务人工验收。

复核子 Agent 的请求配置为 `gpt-6.1-sol / ultra`，不能独立证明服务端实际路由。子 Agent 未在交付仓库提交、推送、合并或部署；临时 Git fixture 的初始提交只服务于删除状态回归。
