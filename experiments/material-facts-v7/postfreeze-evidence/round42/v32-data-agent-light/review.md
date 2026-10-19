# v32 数据Agent只读LIGHT核算

结论：**PASS（保存文件/哈希/JSON分区算术范围）**。这不是标签独审、语义重新匹配或人工业务验收。本Agent参与数据编写和部分运行时代码；没有实现本轮v32版本生成，也没有亲自执行本轮write/check。

- v32 manifest `b7f53ed2a32f9b68f4031f63addfe1e00a22f3b2323c9bf8969fb55d47b6e074`，116当前代码绑定逐字节匹配；v31 archive 113份与原v31代码映射及真实文件集合完全相符。
- 原freeze124、首跑result-manifest60（59个results文件+comparison）均匹配原摘要；原32与补全36代码档案、v1–31结果/代码档案均重新枚举并核hash。输入17文件、review-evidence18文件保全。
- 与上次独立读取的12781条路径相比，仅assess和5个当前文档/接线文件变化；没有原始输入/首答/金标/历史封存漂移。本次共读取并前后保护13405路径；全部postfreeze-evidence 9188文件（含失败证据）、22个checkpoint名文件及其921个目录成员、125个已有checkpoint绑定都纳入。
- 12留出案例、43事实、41个金标anchor；3开发案例13事实。15个案例族独立，但7个官方网页中2页跨开发/留出；不能称page-disjoint。标签仍为非专家暂定标签。
- 同一首跑保存36份系统输出=24份模型响应+12份规则输出；raw116 / accepted104 / rejected12。rules=2/2/0，Qwen=63/51/12，DeepSeek=51/51/0。没有新增记录的请求或标签改动。
- 三份v32报告与v31**逐字节相同**，JSON字段差异0；comparison只改schema、前一manifest和change_reason，models字段无变化。
- 216个保存分区=3路×12案×6层；从保存pairs/extra/missing重新核算18组指标，并检查索引不重复、完整分区和声明event一致，未运行匹配器或重新判断语义。

| 六层 | rules TP/FP/FN；F1 | Qwen TP/FP/FN；F1 | DeepSeek TP/FP/FN；F1 |
|---|---|---|---|
| raw_basic | 2/0/41；F1=0.088888889 | 16/47/27；F1=0.301886792 | 34/17/9；F1=0.723404255 |
| raw_relational | 0/2/43；F1=0.000000000 | 10/53/33；F1=0.188679245 | 27/24/16；F1=0.574468085 |
| raw_strict | 0/2/43；F1=0.000000000 | 8/55/35；F1=0.150943396 | 25/26/18；F1=0.531914894 |
| accepted_basic | 2/0/41；F1=0.088888889 | 16/35/27；F1=0.340425532 | 34/17/9；F1=0.723404255 |
| accepted_relational | 0/2/43；F1=0.000000000 | 10/41/33；F1=0.212765957 | 27/24/16；F1=0.574468085 |
| accepted_strict | 0/2/43；F1=0.000000000 | 8/43/35；F1=0.170212766 | 25/26/18；F1=0.531914894 |

46个accepted金额=19 exact、25 approximate、2 unsupported，19非null/27null；rules 2exact，Qwen 8exact/11approx/2unsupported，DeepSeek 9exact/14approx。**46个全部带source_relation_unresolved，exact且无review issue为0**。保存报告calculation_authorized均false，不能据exact金额或accepted F1宣称能自动计算/人工已验收。

首次audit在末端目录成员核对时遇到主侧并发追加37项portable-final-addendum，已有文件0改/0删，原失败日志保留；相同脚本与断言再次执行4.668秒exit0。主侧暂停复制后另重核13405路径及全部目录成员，0改/0增删。新3个.mjs证据改存.snapshot的摘要映射已核，原证据bytes不变；不将捕获时序失败说成模型或产品失败。

主侧v32 write回执：exit0，150.841459秒，2026-10-18T23:01:18.704688Z启动；这里只复制并核摘要，不冒充本Agent执行。v32 check在本收据准备时仍由主侧运行，本LIGHT不代替它。

复制入口为同目录`copy-index.json`。脚本复制目的名带`.snapshot`，防止诊断证据变成活动源。所有写入仅在OWN；未运行评分/历史CLI、模型、HTTP、build或fullcheck。请求配置GPT-6.1 Sol/ultra，实际后端未独立核验。
