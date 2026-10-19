# 原始数据与三路首跑保全核对（round23）

核对时间：2026-10-18T11:25:44.464498+00:00。结论：本次限定的只读保全核对通过，人工业务验收仍未完成；核对时 v17 manifest 不存在。本文是数据作者自检，独立 Agent 的标注/技术复核另有回执。请求配置为 GPT-6.1 Sol / ultra，不能独立核验实际后端。

原始 freeze 的124项绑定全部可还原并逐SHA相符：36项使用完整 frozen-code-v2 快照，88项使用仍为原字节的文件路径；原 frozen-code 的32份旧快照也逐项相符。这里不声称已修复的当前工作源码仍等于首跑代码。原 result-manifest 的60项成员全部相符，首跑前独审绑定的10项数据文件全部相符。

- 原 freeze SHA256：`0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2`。
- 原60结果 manifest SHA256：`3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee`。
- 既有 v16 manifest SHA256：`5e229a33ed6e71f26b4fb01c92e9f28da66122bffde84d23e8e82c1fb6dbca69`；绑定的三路报告及 comparison 共4项均相符，三路报告分别与 v15 逐字节相同。

材料为15个可识别案件/关联工程家族：3 dev / 13条参考事实，12 holdout / 43条参考事实，共56条、34个原文块、1个有限备选、2份自然空材料。此前34条旧案例登记的family与URL没有碰撞，v4 replication复用v4，不能另加旧独立案分母。这只是公开信息可识别的案件/工程隔离；匿名称呼可能隐藏同人或项目联系，也无法排除模型预训练见过官方材料。

15案来自7份官方网页。`spc-485321`与`spp-598331`均同时供dev与holdout使用，所以明确不是网页隔离，也不是15个统计独立来源。官方公开可读不等于取得开放许可证；仓库保留小规模连续节选和来源定位，完整页面在私有缓存；未加入新的真实私人资料。

三路正式留出记录各含12个唯一案例结果，均完成、协议有效12/12；Qwen与DeepSeek的终态attempt覆盖同一12案，协议calls_per_case=1、post_retries=0。三路messages字节相同，用户内容只含blocks的id/page/text，不含gold或event。规则系统不是第三个大模型。开发集另有保留的第一/第二次尝试，因此“一次”只指这次正式holdout逐案序列，不能说整个项目所有后端只运行一次，也不对仓库外未记录活动作保证。

DeepSeek保留13次连接尝试，但仅12次send_started、body_sent与HTTP200，每案各1次。额外一次是发送前连接超时，submission_started=false、body_sent=false、post_attempts=0；不能把它说成重试回答。初始化阶段ENOENT的fail-closed证据仍在原审计中，不删除失败、不把预算预留当实际账单。Qwen的12份fenced JSON、DeepSeek的1份fenced JSON属于现有解析器支持的格式，不能据此误称协议失败。

以下只读取既有v16报告，不重算分数、不生成回答。每路计划材料分母12、召回参考事实分母43；precision分母为TP+FP，recall分母为TP+FN=43。单元格为TP / FP / FN，括号为F1。

| 指标 | rules | Qwen | DeepSeek |
|---|---:|---:|---:|
| raw_basic | 2 / 0 / 41（8.89%） | 16 / 47 / 27（30.19%） | 34 / 17 / 9（72.34%） |
| accepted_basic | 2 / 0 / 41（8.89%） | 16 / 35 / 27（34.04%） | 34 / 17 / 9（72.34%） |
| raw_relational | 0 / 2 / 43（0.00%） | 10 / 53 / 33（18.87%） | 27 / 24 / 16（57.45%） |
| accepted_relational | 0 / 2 / 43（0.00%） | 10 / 41 / 33（21.28%） | 27 / 24 / 16（57.45%） |
| raw_strict | 0 / 2 / 43（0.00%） | 8 / 55 / 35（15.09%） | 25 / 26 / 18（53.19%） |
| accepted_strict | 0 / 2 / 43（0.00%） | 8 / 43 / 35（17.02%） | 25 / 26 / 18（53.19%） |

原始候选/接受/拒收分别为rules 2/2/0、Qwen 63/51/12、DeepSeek 51/51/0。六层均要求唯一注册事件归属；basic还看value、meaning与费率单位，relational增加主体、范围、期间和完整性，strict再加assertion。同额资产、欠薪、付款、付款方/受益方及不同陈述层级不能仅因金额相同而相互命中。这些是同一首跑回答的显式版本化复评，不是新一轮盲测或模型能力提升证据。

真实语义问题仍须人工核对，包括把资产变价或法院混合缴款当作工人实收、把付款人当受益人、把工程款当完整已付工资、改写并放大金额及引文、错误角色/陈述层级、遗漏工资期间和额外程序日期。另一方面，吉林/鄂州同群体长短称呼、value缺少“截至”等字面边界损失，不全部等于找错人或误判工资期间；保守误警与精确值不可用也不能全部归为模型语义错误。

全部标签仍是provisional_non_expert。年假诉请/裁命的技术类别、执行叙述层级、余额快照与工资期间、工期与任职、程序日期范围，均是预登记研究约定，作者与Agent复核不构成法律专家或用户业务验收。自然空材料保留有依据的空expected；金寨Qwen的7个raw包含4个无金额money被拒收与3个date被接受，不能称为正确空输出。

自然材料未覆盖明确零金额、明确承认的年假部分应付、真实OCR图片，以及两笔同额同属性但独立的实际工资付款。合成HTTP覆盖保存/拒收等技术行为，不能补成自然案例的业务证据。accepted不等于人工确认，accepted F1不等于法律准确率或计算授权。

本次只读取字节与既有JSON统计，没有重抓网页、执行评分器或深层历史CLI、运行全检查/HTTP、请求模型、训练、部署或修改gold/raw/frozen。原始与修复报告分开保留，v17结果需发布后另出新回执，不能回写本记录。

关键证据位置：

- [freeze.json](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/freeze.json)、[result-manifest.json](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/result-manifest.json)、[完整首跑代码快照清单](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/frozen-code-v2/manifest.json)。
- [留出输入](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/data/holdout.inputs.jsonl)、[留出暂定标签](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/data/holdout.labels.provisional.jsonl)、[来源分组](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/data/sources.selected.json)、[独立性登记](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/data/independence.authoring.json)。
- [首跑前独立标注复核](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/annotation-review.independent.json)、[作者首跑标签审计](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/POSTRUN_LABEL_AUDIT.md)、[独立首跑审阅](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/postrun-review.independent.json)、[v16比较](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards/experiments/material-facts-v7/corrections-v16/comparison.json)。
- 本次机器可读回执：[round23-data-preservation.json](/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-data/experiments/material-facts-v7/postfreeze-evidence/round23-data-preservation.json)。
