**第五轮独立复核通过；本结论限于金额算式防御及 v4 历史复验链。** 复核者未实现本轮金额解析、共享算式检查、源文审查或评分器。主树最终金额解析、共享 helper、源文审查的 SHA-256 分别为 `3ebe3b80971a74af09b05b3ba17a5f5b597d042b0b12ffb787066a4d71d8e6a5`、`3ff2d33aa4b388205d2c6cdd165c0caf1d225383e536d7316598380a8468d323`、`cc28c81a760b2b852af98129afffbacdabba4f524b228f13ac4b3beb1d0e40fa`。当前 v4 manifest 为 `3bceefdb375173567fa7ce60c662eae991957ade70bb89f0da989edb7ebd9db6`，其 32 项代码摘要均已逐项核对当前文件。

独立算式测试共 77 项。使用 v3 精确归档代码还原运行，得到 **23 PASS、54 FAIL**；以最终主树运行得到 **77 PASS、0 FAIL**。测试覆盖完整金额、value 裁剪、value 与 quote 双裁剪、历史精确金额的展示降级、历史 unsupported 不自动升级、raw 与原始表示留存、Unicode 码点位置及六层评分。完整算式不能借基础金额或另一次付款事件的 anchor 得分；按原文完整提取算式可以正确匹配该算式事件，但派生 amount 必须为 null。后者是提取正确性和金额可用性之间的必要区分。

复核期间独立发现了中文负倍数及分数倍数的裁剪遗漏：`四万元的负二倍`、`四万元乘以负2`、`四万元的1/2倍`、`四万元的二分之一倍`。修前原始探针和失败日志均保留；最终实现使这些表达的完整与裁剪路径都不暴露 40000 元为结果。显式“的…倍”或运算符可以跨 LF、LS、PS 及相邻 OCR 块延续；未出现显式续接的下一行裸“2倍工资”不会自动关联前一金额。月费率、件费率、人数、三个月的工资及同额另一事件的前后两种顺序均保留正向边界。

源码审查确认：共享 helper 只做有限文法的检测，不执行算式；NFKC、格式控制字符和横向空白处理只发生于检测副本。金额解析对完整金额及唯一引用位置复用同一检测；源文防御另用未裁剪空白的原始边界及顺序相邻块，仅在算式防御分支中扩展视图，未改原 block、原 quote、CP 坐标或币种/费率守护的位置语义。历史状态只降低派生可用性，不回写或自动升级旧候选。自由叙述及未覆盖文法仍需人工复核，本次测试不构成通用数学解析保证。

新版历史链独立门禁 **8 PASS、0 FAIL**：核对 v3 的 29 项精确归档，修改旧 manifest、修改旧 money 快照、缺失旧执行文件均在进入回调前拒绝；修改 v3 report 字节由归档 verifier 拒绝；仅给当前 helper 加一行不改变行为的注释也使 v4 `--check` 拒绝；回调异常后自有临时树被清理。原 freeze、首跑结果 manifest、v1/v2/v3 及 v4 manifest 在门禁前后的摘要完全不变。测试只在临时副本注入破坏，没有修改正式快照或旧报告。

独立 Python 核对没有调用原评分器或其 verify：对 3 个 backend、每个 12 案的 216 个 case-layer，依据保存的 pairs、missing、extra 验证索引完整分割、无重复匹配和计数守恒，再重算 TP/FP/FN、precision、recall、F1。每个 backend 的固定事实分母均为 43。当前 v4 的六层计数全部等于 v3：

| Backend / 层 | Basic TP/FP/FN | Relational TP/FP/FN | Strict TP/FP/FN |
| --- | --- | --- | --- |
| rules raw / accepted | 2 / 0 / 41 | 0 / 2 / 43 | 0 / 2 / 43 |
| Qwen raw | 16 / 47 / 27 | 10 / 53 / 33 | 8 / 55 / 35 |
| Qwen accepted | 16 / 35 / 27 | 10 / 41 / 33 | 8 / 43 / 35 |
| DeepSeek raw / accepted | 34 / 17 / 9 | 27 / 24 / 16 | 25 / 26 / 18 |

逐字比较结果是 **2/3 report 完全相同，3/3 六层指标相同**。rules、DeepSeek 的 v3/v4 report 字节一致；Qwen 只有 `/cases/2/review_issues/1/message` 增加“倍数算式”一词，其余 JSON 内容相同。当前三路 raw/accepted/rejected 数分别为 rules `2/2/0`、Qwen `63/51/12`、DeepSeek `51/51/0`。本轮守护修复没有在冻结材料中产生评分收益，不能据此宣称模型语义准确率提高。

production defense 中 rules、Qwen、DeepSeek 分别有 2、8、10 个非 null 派生 amount；“精确金额且无 review issue”均为 0，`calculation_authorized` 全部为 false。amount 的存在、候选被 accepted、事件/属性评分正确、人工作用域确认及实际计算授权是不同状态。保守守护可能误警，不能把被标记的候选一概视作模型错误。原材料标签仍为非专家暂定技术标注，不是法律结论。本轮未重新读取或评价任何新推理输出，复用的是同一批冻结首跑输出。

可移植测试分别为 `scripts/material-facts-v7-arithmetic-independent.test.mjs`（SHA-256 `1dabcc50b4312a3f8bb137d4f78fc6176f891dafc3fc974d53dfcf081e5ba88d`）及 `scripts/material-facts-v7-correction-v4-gates-independent.test.mjs`（`995d909dd487f4ac2cb322ad764da3d9e25ff3429abd48d8dcb680ec72e955b2`）；两个测试的 ESLint 均通过。独立原始证据的仓库目标根目录为 **`experiments/material-facts-v7/postfreeze-evidence/round5/`**，不是仓库顶层 `postfreeze-evidence/`。规范红、绿、门禁及独立复计证据依次为 `arithmetic-independent-baseline-final-77-red.txt`、`arithmetic-independent-main-final-77-green.txt`、`correction-v4-independent-gates-green.txt`、`v4-independent-report-comparison.json`。早期额外时长误警、缺 helper 的复制中间态、测试路径构造失败和缺 subject/period 的 fixture 失败也保留，不能计入最终修前金额漏洞数。

本轮独立工作没有调用模型、启动 Worker/HTTP 服务、构建、训练、部署或推送，也没有修改旧 freeze、labels、模型 raw、首跑结果及 v1/v2/v3 回执。主侧报告的全量检查和 HTTP 结果由主侧负责，本报告不将其冒充独立重复执行，更不构成 UI、真实业务或人工验收。独立代理请求配置为 GPT-6.1 Sol / ultra；本代理没有可见证据独立核验实际运行配置。更早的完整事件/属性语义复算结论保留在原独立报告，本轮仅追加合成实现复核、历史门禁和版本差异核对。
