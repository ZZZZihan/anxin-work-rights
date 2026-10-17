# material-facts v5 独立公开材料小样本

本目录是 2026-10-17 新采集的 3 个开发案件和 8 个封存案件。标注为 `provisional_non_expert`，只用于本次已授权的小样本文本推理比较，不代表真实上传材料分布、事实确认或法律专家验收。未训练，数据作者未调用 Qwen/DeepSeek，未读取其输出。独立审查完成并写出冻结回执前，不得运行封存集或根据模型输出修改金标。主 Agent 在作者/审查者进行独立复核期间报告已运行 dev；作者与审查者均未查看这些输出，封存标签修订依据仍仅为原文。

每个输入行沿用 v4 的 `id/source_id/family_id/source/origin` 包装，`source.ready=true`，`source.blocks` 只保存必要原文节选。`source.sha256` 定义为按块顺序以两个 LF 连接 `block.text` 后的 UTF-8 SHA256。标签行顶层 `schemaVersion=2`，`expected` 为 v2 候选数组，以兼容既有 v4 评测读取接口；模型输出仍为 `{ "schemaVersion": 2, "candidates": [...] }`。`acceptable_alternatives` 按 `expected_index/candidates/reason` 在封存集首次模型运行前登记有限原文等价项；没有等价项时为空。备选不改变金标事实分母；主体同指、被明确采信的断言以及原文日期粒度须有逐项依据，不对冲突事实泛化放宽。完整原 HTML 或完整代理阅读正文仅留本机私有缓存，未加入仓库。

标注对象为节选内所有工资相关金额及实质日期：任职或用工起点/期间、工资归属期、合同签订日期/窗口、约定履行期、实际或约定支付日期，以及与劳动工资争议直接相关的解除、费率生效、伤害等实质日期。纯受理、立案、调查、裁决作出、发布、救济期限及无关企业股权变更日期不抽取。裁决或行政命令中依“生效/送达之日起三日内”等程序触发的相对履行期限排除；明确日历日期的实际、约定或责令支付截止日保留为 payment_date。原文仍保留这些内容；未抽取不计漏提取。纯工作时长、出勤天数、百分比、人数、案号和法条编号不是本轮 money/date 目标。伤害日期只是 `other_date`，不转写成任职期。

所有候选完整包含 `kind/value/quote/blockId/subject/scope/meaning/completeness/period/rateUnit/assertion`。`value` 必须是 `quote` 的逐字连续子串；`quote` 必须是一个源块的逐字连续子串。`subject` 和 `period` 只能引用输入中的原文字串，原文不能确定时用 null。主体是金额的享有/收取方或日期所述当事人，不能自动套成付款方。群体工资使用真实群体表达，不能因出现代表人姓名而记为个人。

- `kind` 为 `money` 或 `date`；金额 meaning 为 `due_total/paid_total/payment/arrears/award/rate/other_money`；日期 meaning 为 `employment_period/wage_period/contract_signing/contract_performance/payment_date/other_date`。
- `date` 以及金额 `rate/arrears/award/other_money` 的 completeness 一律为 `not_applicable`。`due_total/paid_total` 只有明确描述该主体、该期或该次结算范围完整累计时用 `complete`；未明用 `unknown`，明确部分用 `partial`。没有日期边界的完整个案结算可保留 period=null，不能编造起止日期。
- `payment` 只允许 `partial` 或 `unknown`。明确单笔转账、预支、分期、部分支付为 `partial`；仅泛称“支付”不足判断完整性时为 `unknown`。只记载某笔完整转账，不等于工资累计全额。
- `rateUnit` 在 rate 时只能为 `month/day/hour/piece/unknown`；其他 meaning 必须为 null。费率不改写成应付工资总额。不补充原文没有的税前税后字段。
- 明示 0 保留为原文金额 0；X、星号等未知金额保留未知原串。未记载、未支付、未收到工程款不能转换成个人已付 0。工程款、融资、罚款和不属于工资的福利款按原文语境为 `other_money`，不能充作工人工资。 裁判、仲裁或行政命令要求给付的金额以 `award` 角色优先，即使其内容为补偿或工资；尚在主张层级的补偿、罚款、材料款等无命令角色时为 `other_money`。
- 单点、月份、完整区间和未知边界均保留原文。同一主体、同一角色在同一句并列描述的日期区间，保留完整连续原文为一项；不同事件或角色分别提取。一对一 strict 评分对未登记的日期粒度仍然敏感，应作为评价局限报告。签约日期/窗口为 `contract_signing`，合同约定期限为 `contract_performance`；不能借此推断实际工作起止。
- `assertion` 使用 `claimed/admitted/decided/narrated/unknown`。依据原文叙述层级分别标注主张、承认、裁判认定和一般案情转述；有实质冲突时拆开。同一主体、期间、意义、数值且无实质冲突的重复表述只算一条事实，优先采用明确认定或承认层级；原文同时支持的主张/证言/外层转述可以在模型运行前登记有限断言备选。不同金额意义或不同事件不能仅按数值相同合并；同一日同时具有解除和工资结算截止角色，应分别标注。

`sources.selected.json` 保存官方 URL、取得时点、方法、原 HTML 或取得正文的 hash、节选 hash、家族和权利边界。代理取得内容的 `raw_html_sha256=null` 是刻意如实记录，不以提取文本 hash 冒充原 HTML hash。`*.excerpt-receipts.jsonl` 记录每块原段落索引和字符边界，或者代理正文的逐字区间。`validation-report.json` 仅是程序一致性检查，语义正确性以独立复核及其明确限制另记。

当前范围为 11 个案件，不是 11 个原始私人工资记录。少量短节选并不改变官方叙述与原始证据之间的区别。所有标签仍需人工专业确认后才能用作业务计算依据。

独立审查 Agent 已逐案复核并给出 PASS，见 `independent-review-receipt.json`；作者与审查者未读取模型输出。实际复核包含11份缓存SHA、22块原文重建、86金标及67备选的运行时校验，以及78次完整参考或单备选替换的评分器自洽检查。状态为 `independently_reviewed_non_expert_ready_for_freeze`，仍保留非专家与暂定标签边界。封存集冻结及首次运行由主 Agent 后续执行，本文不声称它们已发生。
