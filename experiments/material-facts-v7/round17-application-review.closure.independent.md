# ROUND17 应用 closure：补充 HTTP 证据只读复核

本补充保留原 `round17-application-review.independent.json`，不覆盖旧回执。五个产品/评分源码哈希与先前独立 40/40 通过时完全一致；当前待提交差异未见本轮新阻塞。

我只读核对了修正夹具后的两份实际 HTTP 报告、runner 和基线构建回执，没有启动服务或执行构建。有效修前证据是同一 `9b26d65326b7f6f791dc4328e302e58cef31e535f72c517fd844fbc9055b495f` runner 在精确 eb86736 构建上的 **93 通过、9 失败**，原 90 场景全通过，新 12 场景为 3 正例通过、9 业务失败；当前版本为 **102/102 通过**。两边 cleanup PASS。两份报告场景顺序和 103 份注入 raw 序列一致。旧构建回执列出的 105 个 dist 文件当前仍逐哈希一致；实际旧 runner 私有副本与当前 runner 逐字相同。

最初 **92 通过、10 失败** 的报告属于无效夹具阶段：部分 subject/period 未在源文出现，使候选在目标行为之前就被拒绝。其原报告及分类回执继续保留，不计为本轮有效修前业务失败。

新增 HTTP 块的断言有实质边界：六个不可靠金额先断言 fresh 接受一条但 amount 不可用，再只修改一次性 D1 中的旧派生 exact 状态，实际 GET 必须降回 null 并保持存储/历史不变；未知金额保留、四个确定无金额描述拒绝；传统人民币两种顺序均 raw 两条、accepted 一条；正确月费率、姓名后的真实一月工资及 5元组装费为保留正例。raw/representation、源文 SHA 和 Unicode 码点由原公共断言检查。独立 native 40 项另覆盖六层事件评分和不同事件同额保留。

去掉 ROUND17 新增块后，runner 与 eb86736 原 90 场景及生命周期字节完全相同。主侧重启报告核对了 101 份持久化快照，证明 stored state/raw/history 不变；不把它写成重启后再次逐项验证所有派生 amount。102 个场景仍是实际 Worker HTTP 配合显式合成事实输出、一次性 D1/R2 和真实 TXT 服务，不能代替真实模型、业务/UI 或法律验收。

详细报告哈希、原始路径与断言范围见 `round17-application-review.closure.independent.json`，独立只读证据索引为 `postfreeze-evidence/round17/http102-readonly-review.independent.json`。本补充未执行 v14 深链或全套检查，正式 v14 待主侧产物后另列验收。请求配置继续 GPT-6.1 Sol ultra，实际 backend 无法独立核验。
