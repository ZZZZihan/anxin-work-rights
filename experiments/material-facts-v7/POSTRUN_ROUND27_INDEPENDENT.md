# ROUND27 v20 独立检查结论

**产物核对通过；隔离五门禁通过；原完整整合检查失败；应用有新审查待修，尚不可完成验收。** 本报告追加于完整失败回执，保留其原日志与结论，不以随后单跑结果覆盖失败。

2026-10-18 13:07:43.967–13:26:41.923 UTC，我在 ROOT 按授权原样执行一次 Node24.22.0 的 `npm exec --yes --package=node@24 -- npm run check`。耗时 1137.956 秒，**exit 1**。Vitest 46 文件/1789 通过，材料 67P/1skip，Python 9/11/16 通过；运行时 6862 项汇总为 **6811P/50F/1skip**。50 个失败含 32 个叶测试、18 个失败父组。主要涉及历史 CLI deadline、短夹具 deadline 以及一项 backpressure 夹具未正常结束；不能把这些失败写成有效的拒绝测试或无影响警告。

同一次完整运行内，新版 v20 的四个子项为 3P/1F，父组失败；既有“五项含父组”计数 **3P/2F**。manifest 等价空白负测花费 896404.82ms，实际历史共享预算耗尽，未匹配应有字节变化诊断。其余字节绑定、还原清理与金额 guard 注释漂移负测通过。详细 32 个叶失败和源代码行在 failure-log-review.final JSON；原始 stdout/stderr 均完整保存。

经主侧另行授权，13:30:27.520–13:34:42.496 UTC，我单独运行 ROOT 现有 v20 同一脚本，未改断言或 timeout 政策。**exit 0，5P/0F/0skip，254.975 秒**。四子项实际为：79 文件绑定 8.85ms；76 历史文件还原与 callback 异常清理 2527.97ms；manifest 等价空白真实 CLI 负测 125092.36ms；仅改金额 guard 注释真实 CLI 负测 125771.09ms。两 CLI 的原有执行断言都要求 status1 和对应预期诊断，超时本身不能算通过。此处证据是实际脚本通过这些断言，测试 reporter 未另行打印每个 child 的原始 status 记录。

单跑和并行完整运行的行为差异支持调度压力这一待验证解释，未证明唯一根因，更不代表尚未执行的有界并发完整检查已通过。全检查及单跑两次各自的 **320 个保护文件均前后完全一致**。包括五个产品文件、79 个当前绑定、历史产物与本次执行的 package/gate 原始字节；单跑后没有本次重链继续运行。

轻量独立核对不调用原 scorer，不启动历史子进程：**216 个保存匹配分区、固定每层 43 金标、79 current、76 archive、原始 60 文件、全部旧 manifest 与结果文件 hash** 均核算通过。v20 manifest SHA为 `6bddae4eb7d7da1fd744a79a399620e8fa60e7c5fe79d1ef7aaf8a072b491a87`。与 v19 比较，rules 报告逐字相同；Qwen 10 处和 DeepSeek 13 处仅 normalization.reason 文案改为内嵌“多/余”的概数说明，原值仍 approximate/amount null。六层匹配配对、计数、分母和关联防御均不变；不能概括为三份报告逐字相同。

46 个 accepted 金额仍为 21 exact、23 approximate、2 unsupported，46 个全部带 source_relation_unresolved；精确且无问题标记的金额为 0，计算授权为 0。accepted、派生 amount 和经核可用于计算的事实不能等同。金标是预登记的非专家技术标注；此处不是法律准确性或人工验收结论。

此前锁定的 26 个有限应用用例双运行时通过，见独立 application prefix-closure 回执。本报告时点，主侧又报告 7 个新审查问题，尚待 ROUND28 独立复核。应用 b4974a3 的远端 CI 成功与 222 场景 HTTP 是主侧不同证据，我没有执行该 HTTP 或独立查询远端状态。完整 check 内含其既有合成服务与进程测试，不是另跑真实业务 HTTP。没有新增推理、训练、生产写入、提交、推送或部署。

请求配置为 GPT-6.1 Sol/ultra，实际 backend 不能由本 Agent 独立核验。最终状态为 **ARTIFACT_PASS_ISOLATED_GATES_PASS_FULL_INTEGRATION_FAIL_APPLICATION_BLOCKED_NEW_REVIEW**；人工验收未完成。
