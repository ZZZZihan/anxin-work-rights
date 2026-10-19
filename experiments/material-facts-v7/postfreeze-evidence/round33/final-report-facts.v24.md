# Issue #42 最终交付事实清单（只读提炼，v25待定）

记录时间：2026-10-18T16:25:58.985022+00:00。本文件只读取ROOT现有资料及冻结JSON，不执行模型、评分器、历史验证链、测试、构建或HTTP，不修改ROOT。请求GPT-6.1 Sol ultra，实际backend未独立核验。本次任务所称ERROR_ANALYSIS在ROOT不存在，实际依据是`ERROR_REVIEW.md`。

## 原始目标与可支持的完成陈述

Issue #42 的主体是**先修解析、标注和同额不同事件评分，再做新材料三路首次对照**。PR45承载应用修复，PR46承载新材料、冻结、首跑、失败、后验复评与复核证据。不能把后续币种/词界等单项反例数量当作原始交付目标，也不能把CI通过当作工资事实已获业务验收。

1. **解析及源文防御**：`人民币四万元`、`四万元`、`40000元`的确定金额统一为40000.00；严格中文整数/角分以BigInt分解析，原始value/quote/Unicode码点不改。不猜“一千一”等省略；概数、范围、遮盖、未知、外币、费率错标和算式不派生精确工资额；确定无金额的日期/工资标签拒收而raw保留。完整源文继续防止模型同时裁剪value和quote后丢掉条件；历史读时只降低可用性，不把旧unsupported/null自动升级。
   - ROOT产品：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/lib/material-money-v4.ts`，导出`normalizeMoneyValueV4`、`normalizeCandidateValueV4`、`classifyMonetaryExpression`、`canonicalMonetaryExpression`；`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/lib/material-fact-runtime-ingest.ts`与`lib/material-fact-source-review.ts`接入。
   - 固定证据：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/technical-review.json`的`checks_executed`记录398项解析/运行时/跨层合成检查通过（其中112项由非实现者编写），及原30项评分器检查；`frozen_unchanged_checks`绑定未改的v3/v6实现/旧标注。`review-evidence/pr45-money-minimal-before-red.txt`等原红记录保留。本文件只核读这些历史收据，未新执行它们；后续新增有限语法不倒称首跑前预登记。
2. **标注边界**：首跑前逐事实登记11字段、金额角色/受益主体/完整性/期间/陈述层级、日期范围和有限备选。工程款、法院收款、资产处置、裁命、欠薪与劳动者实际收薪分别处理；余额截止不当工资期间，施工窗口不推任职，周期支付日保留原文。每事实绑定事件与原文码点锚点。不能按模型回答补gold、别名或备选。
   - 合约：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/ANNOTATION.md`；数据：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/data/holdout.labels.provisional.jsonl`中的`label_status`、`expected`、`events[].anchors[].{blockId,start,end}`、`expected_event_ids`、`acceptable_alternatives`。
   - 独立首跑前技术复核：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/annotation-review.independent.json`，`status=passed_non_expert_pre_run_technical_review`，`no_model_answers_read=true`、`reviewed_data_sha256`绑定10份数据；`pre_run_corrections_closed`记录补任职角色、周期支付日及降低叙述assertion等纠正。这里的“独立”指未参与解析/评分实现的技术复核，**不是法律专家标注或用户人工验收**。
3. **同额不同事件评分**：raw/accepted×basic/relational/strict六层都先要求同一来源事件，枚举quote与value全部位置，不取第一次indexOf，不按模型自报subject/meaning挑事件；歧义或未登记位置不能命中。最大一对一匹配让多余重复仍为FP；同额但不同真实付款事件均保留。有限币种/工资对象/日期边界包装不能授权整段任意叙述借锚点得分。
   - 实现：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/assess.mjs`的`resolveCandidateEvent`、`permittedContainment`、`match`、`validateLabel`；输出`cases[].event_alignment`、六个`metrics`与逐案`pairs[].event`。
   - 回归：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/scripts/material-facts-v7-assessment-independent.test.mjs`中的`all six layers require the same source event, including basic`、`two real same-value same-attribute payments preserve two source events...`等；历史30项通过见上述technical-review；冻结v6错误评分的原红为`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/review-evidence/frozen-v6-independent-scorer-red.txt`。自然首跑也有同额欠薪/缴法院/资产等事件，但**没有两个同主体、同属性、同额的独立实际工资付款自然样本**，该保存行为仅有合成回归/HTTP覆盖。

## 冻结数据与一次首跑的范围

- 共15个案件/关联工程族，开发3份/13条参考，留出12份/**43条参考**（23金额、20日期），含2份自然空材料；不是只统计成功或非空输出。来自7份官方出版网页，其中2页同时包含开发案与留出案；隔离单位是案件/工程，不是网页。不能称15份独立出版源或统计独立样本；匿名身份和公开预训练污染均无法穷尽。
- 全部标签为`provisional_non_expert`。数据作者及技术复核者在模型运行前读过留出以标注；主实现者冻结前只用开发/聚合，不能笼统声称“无人看过留出”。首跑前对照v4/v5/v6旧登记34项来源/家族排重，仍不保证匿名同案穷尽；见`SOURCE_REVIEW.md`及`data/independence.authoring.json`。
- 首跑输入及标签SHA分别`9ec54411e9008434457ae59f68585f8fb7a6bc6d089cee4e87709bfddd6a2181`、`abac05fa2c3de7d8e83e866345bf5edaec61c65f8f706bb7d5f0c0d98fa27b64`。原freeze SHA`0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2`；原结果manifest SHA`3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee`，覆盖60文件。
- 三路各12/12 `finish_reason=stop`，正式留出每系统一次，没有因低分、空输出、非法字段或拒收重投。DeepSeek末案一次**发送前连接重试**，正式共12次POST；Qwen每案独立进程。两轮开发就绪检查及初始化失败另存，不计新的留出首跑。原消息不含gold/events，详见`PROTOCOL.md`、`DEVELOPMENT.md`及各`results/holdout-{rules,qwen,deepseek}-1/{protocol.json,messages.jsonl,results.jsonl,outcome.json}`。

## 三路描述性结果：原首跑与已闭合v24分开

下表单位F1%，每组三数顺序为basic/relational/strict。43是召回参考分母；F1仍按`2TP/(2TP+FP+FN)`。raw保留非法/重复/证据错误候选，accepted只是协议接受，不是正确率、生产可用或人工确认。窄规则不是另一个模型。

| 系统 | raw / accepted / rejected项 | 原首跑raw B/R/S | 原首跑accepted B/R/S | 同输出v24 raw B/R/S | 同输出v24 accepted B/R/S |
| --- | ---: | --- | --- | --- | --- |
| 窄规则 | 2 / 2 / 0 | 8.89 / 0.00 / 0.00 | 8.89 / 0.00 / 0.00 | 8.89 / 0.00 / 0.00 | 8.89 / 0.00 / 0.00 |
| Qwen3-32B-4bit | 63 / 51 / 12 | 35.85 / 24.53 / 18.87 | 40.43 / 27.66 / 21.28 | 30.19 / 18.87 / 15.09 | 34.04 / 21.28 / 17.02 |
| DeepSeek-v4-pro | 51 / 51 / 0 | 74.47 / 57.45 / 53.19 | 74.47 / 57.45 / 53.19 | 72.34 / 57.45 / 53.19 | 72.34 / 57.45 / 53.19 |

- 原首跑字段：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/comparison.json`的`models.<backend>.metrics`、`raw_candidates`、`accepted_candidates`、`rejected_candidates`、`completed`、`finish_reasons`；各原`results/holdout-<backend>-1/report.json`仍保留。
- 已闭合修正版字段：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/corrections-v24/comparison.json`的`models.<backend>.first_run_metrics/corrected_metrics/delta`与`corrections-v24/report-<backend>.json`的`metrics/cases`。v24 manifest为`86560d13902cba7458cae1d5c1b9175c01442c404a4d47bd17305950206e795e`。
- Qwen全部12份带JSON fence，DeepSeek11原生JSON+1 fence；两者协议均12/12可解析，不能把fence当失败或把格式通过当语义正确。Qwen12条拒收仍留raw分母。
- 窄规则仅产出两个月费率，遗漏另外41条参考；strict的43FN还含这两条属性不全，不能都说完全没提取。规则exact_documents=2来自两份自然空；Qwen=1、DeepSeek=2的逐案完全正确也不能解释为“仅这些案可用”。
- 后验边界收紧使Qwen少3个basic/3个relational/2个strict TP、DeepSeek少1个basic TP；其中“月工资16000元/12000元”“150万元执行款”的金额及角色本来正确，是有限value边界损失，不能全部写成模型算错。复评使用**同一原始回答**，不新增模型请求/样本/标签；分数下降不等于模型退步，后续合成检查通过也不是新盲测提升。
- **v25正在主侧实际write；本文件不读取或认定其计算结果，不提前声称v25三路报告与v24相同、write/check通过或最终CI完成。** 当前上表明确固定v24，最终交付更新必须另据v25正式manifest/report及执行回执。

## 最重要的业务错误与可用性残余

以下C[n]均指**原始raw候选**下标；报告accepted索引可能前移。直接证据位于`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/results/holdout-<backend>-1/results.jsonl`，按`id`找到行，再读`raw_output`中的`candidates[n]`；gold同id的`expected[n]`，讨论见`ERROR_REVIEW.md`、`POSTRUN_LABEL_AUDIT.md`与`POSTRUN_MONEY_AUDIT.md`。

- **资产、法院/第三方收款并非劳动者工资到账**：Qwen `mf7-spc-suqian-petfood` C[1]，value=`8万余元`、quote=`取得价款8万余元`，却标工人`payment/partial`；`mf7-spc-jilin-eleven` C[1]把含执行费的8万余元交法院标为`payment/partial`。同额事件评分不会替模型纠正付款含义，协议接受也不能确认到账。
- **工程款/商票与工资、付款方/受益人混淆**：DeepSeek `mf7-spp-nanchang-fan` C[0]将1967万余元劳务工程款标`subject=建设公司/paid_total/complete`；C[1]100万元商票虽标other_money仍把付款公司当享有主体。Qwen安远5万元付款也取付款人谢某某而非受益群体。DeepSeek在本小样本的三层事件属性匹配更高，但这些是实质业务错误，不能授予自动工资计算能力。
- **引文改写及数量级**：Qwen南昌C[2–3]的value仍为人民币623万余元/441万余元，quote却改写为62,300,000余元/44,100,000余元，较原文大10倍且非逐字证据，已拒收。应准确写“改写引文中的数量级错误”，不能误称raw value本身就是十倍金额，亦不修写原回答。
- **角色/日期与覆盖**：裁命金额误作完整应付、主体和陈述层级错误、连续期间拆开、工程/程序日期越界仍存在。Qwen金寨自然空案过提7项，4个无金额money拒收、3个无日历日期仍accepted；DeepSeek两自然空为空只说明该负例，不证明普遍可靠。
- **守护误警及后验修复**：温州DeepSeekC[2]139万余元全额工资支付角色正确，却受另一块“一笔150万元执行款”影响触发`partial_paid_total`，是核对负担，不是错误精确放行。年假QwenC[1]原`八百零四元六角`少“整”曾误拒；v18在相同原输出恢复804.60并移除该一项金额上下文提示，六层计数不变，关系核对仍保留。此后验修复不能说成首跑前预登记或新模型成功。
- **实际可用性不是accepted/F1**：已核v24三路`cases[].production_defense`共46条accepted money，21 exact、23 approximate/null、2 unsupported/null；46条全有`source_relation_unresolved`，`exact_money_without_review_issue`均false。`calculation_authorized=false`是比较工具的固定政策字段，**不是46条真实UI确认/计算路径均实测**。合成隔离HTTP另列技术证据，不代替真实业务验收。
- **标签争议与未覆盖**：年假诉请arrears、执行标的award、离职申请表日期与真实最后在岗等是非专家研究约定；吉林/鄂州同一群体不同称呼有严格字面失分，不能都称找错人。自然零金额、明确承认的年假部分应付、真实OCR图像、两个同额同属性独立工资付款均缺完整自然覆盖。后续先由具备业务能力者核分类/主体/合法事件，再在未看过的新案件冻结重做首轮；当前证据不授权训练、合并PR45/46、生产部署或自动核算。

## 引用快照（本文件只读时）

ROOT目录：`/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards`。下列摘要仅绑定本次事实提炼所读版本；文档更新可另追加，不覆盖原记录。

- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/README.md` — SHA `d184afc5339d3818039e8c1a78edca6d7c12fe8d3b5257ca75d7af3715ba2f0d`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/ERROR_REVIEW.md` — SHA `60d61ef5bf9d6ddda631e8d9cfc5f1e9f63415956ad7f3e681db21e3bd91094b`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/ANNOTATION.md` — SHA `9ae96f591e1f92a4e812f38326761c9a94b4a88f13154ff147861bb4d9dc761b`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/annotation-review.independent.json` — SHA `e5b13b6f02d3d9e25c636ef6ff803fc8b2339e14c4ad084c2c41e8daf5861182`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/SOURCE_REVIEW.md` — SHA `f55bec841a68cac38f91bd0795c22ad894d4d81612dca3f2cb7f7b3ba62fd03b`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/PROTOCOL.md` — SHA `f39d035ad57a5b0cbd8f6eec1dfaa220452d13437364c6957f0acf755a964b32`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/comparison.json` — SHA `5377e0b4b281ec7b2d31ba80ae796bbaac18996db361d364391409a7932ff1ce`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/corrections-v24/comparison.json` — SHA `664b76c33b813d7705359414bf49ae4adf7517d82857a27f4c3edbe28fbe44dc`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/corrections-v24/manifest.json` — SHA `86560d13902cba7458cae1d5c1b9175c01442c404a4d47bd17305950206e795e`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/corrections-v24/report-rules.json` — SHA `0553db2f6eb0801c6311021f16ce67268a165cd8198afe66fa4821ee737dbaf7`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/corrections-v24/report-qwen.json` — SHA `c9c010d4bd857745f52385bc13b4e4d36aa6b715a508f6b1df8f0b5d7e564f38`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/corrections-v24/report-deepseek.json` — SHA `1c782cd8ff265bfb9308562f917bb7ce3f153f949a883078d3b2aabaed0523e3`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/POSTRUN_INDEPENDENT.md` — SHA `be4d3a449ba45861f68a721ab1c385b409824ca0198036d4955f8bfd5e4f264a`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/POSTRUN_MONEY_AUDIT.md` — SHA `e90ab5e2f4a2b5c034a5ac809eec9dbb47854180f1dfb126e7e4f6792dd8720a`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/POSTRUN_LABEL_AUDIT.md` — SHA `bdcbdb2f94cb00be500052a630aaf72fe6c08f95bb0eef02e43d57f0f356f231`。
- `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/technical-review.json` — SHA `b032f3fb9f0fb44cc3c6c5306523868bd32dcd9e7859270eff95feb897c6ea65`。
