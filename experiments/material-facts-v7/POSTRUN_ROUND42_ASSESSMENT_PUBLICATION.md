# ROUND42：评分报告不可覆盖发布

本轮补查 PR46 的审查正文 `PRR_kwDOVApLyM8AAAABS3-ZaA`（databaseId 5561620840，审查提交 `3e14bd781a230b3fc937fd6e46a62b8b87232bab`），发现其中的 P1「Refuse to overwrite frozen assessment reports」仍可在当前评分 CLI 复现。该意见属于 PullRequestReview.body，不能用行内线程解决数或普通评论清单代替检查。旧审查正文与失败证据保留，不改写历史状态。

固定旧 assess.mjs 的 SHA256 为 `2c14d8b7c2de5fd397a570f01cd34d8019a7caa66ed8d2f217c0b9ad6382dbb4`。真实 CLI 会覆盖已有报告，沿符号链接改写目标，重复运行仍返回成功；并发两次也可能都报告成功。原生文件大小限制还使正式报告留下128字节截断 JSON。所有反例只在自有临时副本上运行，原模型回答与冻结报告未用于覆盖试验。

修复只改变 CLI 发布：在直接执行分支动态加载既有发布 helper，完整写入、同步并关闭同级 stage 后，以不覆盖目标的 link 原子发布。既有普通文件和符号链接均拒绝，发布前失败保留 stage 且不占正式路径；发布成功后的 stage 清理失败明确报告已发布状态。评分函数、标签及正常 stdout 摘要不变；库单独导入没有新增静态依赖。不宣称硬件断电持久性。

作者同8项真实 CLI 回归：旧版2通过6失败，修后 Node24.22和Node26.11各8通过。非实现者另锁5项真实 CLI：旧版1通过4失败，修后两种Node各5通过。两组均使用空 JSONL 作为发布输入，不能当作模型评分或业务样本；原失败目标、截断文件、stage与日志均保留。ROOT的8项发布及7项新历史执行桥检查共15项通过。旧测试计数有重叠，不相加为独立业务案例。

修复前已将 v31 的113份绑定代码逐摘要归档。v32继续使用全部首次输出，不调用模型、不更改标签、不覆盖任何旧结果。v31的完整工程检查在运行1814.219秒后，因发现本问题而中止；原日志与取消回执保留，状态为 CANCELLED_SUPERSEDED_BY_NEW_FINDING，既不是通过，也不是产品测试失败。最终完整检查改由整合 v32 执行。

发布修复的作者证据在 [assessment-publication-author](postfreeze-evidence/round42/assessment-publication-author/README.md)，非实现者的实际 CLI 与版本集成复核另列。PR45的3项保守拒绝/误警P2及自然材料的业务限制继续保留。没有新增推理、训练、生产部署或PR合并。

当前v32 manifest为 `b7f53ed2a32f9b68f4031f63addfe1e00a22f3b2323c9bf8969fb55d47b6e074`，绑定116份当前代码；实际write150.841秒、只读check157.283秒均退出0。三份逐案报告与v31逐字节相同；没有模型请求。完整工程检查及精确远端CI分别记录，尚未完成的检查不预记通过。

ROOT最终构建另跑真实隔离HTTP：481项通过，32.430秒，482份合成raw/候选、480份重启快照及cleanup检查通过。新源码与注册测试的最终局部lint为0错误0警告。完整本地检查结果见下文；HTTP使用合成回答，不代替模型或人工业务验收。

当前v32的数据Agent只读LIGHT核对116份当前代码、113份v31归档、原124项冻结绑定、60份首跑结果及全部旧档案，13405条读取路径在核对期间和再次复核时稳定。216保存分区、18指标一致；三份report与v31逐字节相同。第一次遇主侧追加37项证据的时序失败原样保留，稳定目录后使用同一脚本/断言重核通过。该Agent参与过标注和run实现；本核算不执行语义评分，不属于标签或整个实现的非作者独审。详见[当前v32 LIGHT回执](postfreeze-evidence/round42/v32-data-agent-light/review.md)。

另由INDEP Agent完成[版本工具非实现者轻审](postfreeze-evidence/round42/v32-tooling-independent/V32_TOOLING_INDEPENDENT.md)：113份v31归档及精确114文件集、116份新绑定、原执行政策与v1–v31 manifest链相符，266条保护路径读检前后不变。这项轻审没有执行历史CLI、评分器或完整检查；ROOT的实际write/check及后续全检查分别计。审查脚本的准备错误与最终修正日志保留，不计为产品失败。

推送前的[审查表面对账](postfreeze-evidence/round42/pr46-review-surface-audit/PR46_REVIEW_SURFACE_CROSSCHECK.md)分别读取20份review（5非空、1个独立finding正文）、2条普通评论及15个行内线程/30条评论。已知4项工具发现均与当前修复及收据相符；PR45的3个P2保持未解决。该核对不改写历史审查状态，也不能用旧a8 CI证明待推修复。最终推送后的检查与审查状态仍需刷新。

最终本地 `npm run check` 已实际退出0，用时3559.505秒（59分19.505秒）：类型、构建和数据检查通过，Vitest1789/46文件通过，材料67通过/1平台跳过，runtime10292通过/1平台跳过/0失败，Python9/11/16通过。本机lint原日志31 warnings、0 errors（既有、本地scratch及一份随后按原字节改存.snapshot的诊断测试原件）；当前新增源码/测试局部lint0错误0警告。最终完整日志已保留，精确新提交的远端CI仍待推送后核对。

后续状态：b199 精确远端CI因 ROUND43 新增四项可复现工具问题而取消，不记通过或产品失败；后续整合状态见 [ROUND43](POSTRUN_ROUND43_LIFECYCLE_RETENTION.md)。以上本地检查仍是 v32 检查点的历史证据，不能替代 v33。
