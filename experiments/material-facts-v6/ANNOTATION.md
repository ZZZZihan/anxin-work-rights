# v6 暂定标注约定（首次运行前登记）

本轮使用 3 个 dev 与 8 个独立 holdout 案件。数据作者不调用 Qwen/DeepSeek、不看它们的回答、不训练；标签为 `provisional_non_expert`，独立技术复核不能代替法律专家确认。与 v4 全部12案、v5 全部11案按案件及关联工程排除，不能把同案异文书分到两个分组。holdout 首跑前主 Agent 只看聚合信息，具体标签由独立 reviewer 核查。

输入沿用 v5 包装；标签顶层 `schemaVersion=3`，候选仍完整保留原11字段：`kind/value/quote/blockId/subject/scope/meaning/completeness/period/rateUnit/assertion`。`value` 是 `quote` 的连续逐字子串，`quote` 是一个块的连续逐字子串；subject、非空 period 必须在输入中有连续原文支持。节选 SHA256 是依块序以两个 LF 连接 text 的 UTF-8 SHA256。来源回执另记取得正文/原文件 SHA 与定位，不能混为同一种 hash。

## 提取范围与金额

只提工资、与工资争议直接相关的合同/支付/任职等实质日期，以及相关金额；不提人数、案号、法条、百分比、出勤天数。工程款、赔偿、罚金、工资相关扣费等作为 other_money 保留其角色，不能算作劳动者工资。与工资无关的公司注册、股权变更、纯受理/立案/送达/开庭/裁决作出/发布/救济期限不提。按生效或送达触发的程序相对给付期限不提；明确日历支付截止日仍提 payment_date。转账至法院、准备清偿不等于劳动者已收到工资。

money.value 必须使用最小的金额数值加单位连续原文，如“二万三千零六十四元五角一分”“30万余元”“0 元”，费率原文连续附带的计价单位（如“20元/天”）与金额一同保留，不带“底薪”“应支付”等前缀；原文没有单位不凭空补单位。原文概数、X/星号和显式0分别保留；未记载或“未支付”不能合成为0。money.period 是原文工资归属期，不能填支付日或据外部资料合成日期。rate 的 rateUnit 仅 month/day/hour/piece/unknown，其他候选一律 null。工资与绩效的按月/日标准为 rate；叙述或主张中的欠付工资为 arrears；明确裁判/行政命令要求给付的金额为 award；相同值若分别有欠款和命令支付角色，分别提取。

money.meaning 为 due_total/paid_total/payment/arrears/award/rate/other_money；date.meaning 为 employment_period/wage_period/contract_signing/contract_performance/payment_date/other_date。date 与 rate/arrears/award/other_money 的 completeness 一律 not_applicable；due_total/paid_total 只有明确给定主体与结算范围完整累计时为 complete，明确部分为 partial，未明为 unknown。单笔/预付/部分 payment 为 partial，仅泛称支付而不知是否完整为 unknown；不能从单笔转账推出全部已付。

## 主体、日期与粒度

工资相关 money/date 的 subject 均选对应劳动者或班组受益群体，不能选择付款公司。输入不知道受益方身份时用 null；不能依据整页中输入未保留的姓名补全。群体姓名代表不能改作个人；scope 为 individual/group/organization/unknown；非工资款实际收取/享有主体为法人组织时用 organization。非工资款的主体也按该款项实际享有/收取对象及语境选择；没有连续且确定的主体则 null，不能强套劳动者，也不能把罚金承担方或资金转出方冒充收取方。

入职与离职单点、明确实际任职区间均为 employment_period；签署合同的日期为 contract_signing，约定期限为 contract_performance，不能把合同期限当实际任职。停工留薪期明确覆盖工资用 wage_period；调薪生效、工伤发生等直接影响工资金额的日期为 other_date。只有“工作3个月”默认 employment_period，不猜成工资归属期；纯时长无日期锚点不提。明确同一时期同时承担任职与工资覆盖两种角色时，各出一条。

date.period 一律 null。money.period 已包含具体日历工资期间或有明确日期锚点区间，仍须另提 date wage_period；“试用期”“离职前”等没有日历锚点的工资阶段可保留在 money.period，但不单独生成 date。同句同主体同角色的并列期间按整体连续原文保留，不跨句拼接；不同主体、不同角色、不同事件分别提取。date.value 取日期的连续原文，去“于”等纯介词，保留影响边界的前/后/起/截至/自…至…等词。原文重复“至”、中文数字、未知边界不修正。`自…至…`的纯介词边界以及输入内可消歧简称可在首跑前逐项登记有限别名；不设置泛化宽松规则，不根据结果补备选。

## 陈述属性与去重

只据模型实际看到的局部上下文标 assertion：明确查明/认定为 decided，明确双方确认/认可或某方明确承认为 admitted，当事人主张/辩称/证言转述为 claimed，中性案情叙述为 narrated，归属真不明为 unknown。不得仅因为是官方文书或“经查”章节而把其中“某称”升级成认定。证据真实性被认可不等于证据证明目的被承认，也不把申请人提交的材料自动算作对方 admitted。

同事实去重身份键含 kind/meaning/规范值/subject/scope/period/completeness/assertion/rateUnit；quote或block不同本身不增加新事实。相同事实相同 assertion 去重，不同明确 assertion 保留；同值不同角色保留。有限备选只表达预登记的原文同指/纯边界等价，不改变事实分母，不泛化到与原文相冲突的属性。

所有规则与有限备选在 holdout 首跑前冻结。basic、strict、去 assertion 的 relational 指标由主 Agent 另行预登记；不因结果调整标签。数据与标注仅支持研究评测，不能作为业务核算已验证、法律结论或训练收益证据。
