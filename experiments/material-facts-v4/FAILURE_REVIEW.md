# v4 已返回回答的独立错误归因

2026-10-17。复核者请求配置：GPT-6.1 Sol / ultra；该请求不作为独立运行时证明。经主 Agent 在留出冻结和运行后明确授权，本次才读取 `data/*` 与 `results/*`。此前领域、评分及 dev 金标复核时没有读取这些模型回答；本次是揭盲后的失败归因，不用于追改 gold、prompt 或 scorer。本次只写本文件，没有调用模型、读取凭据、修改正式回答或重算写入成绩。

现有证据不能给出 Qwen 与 DeepSeek 的模型能力排名。Qwen 留出没有返回答案，主要观察到本机内存保护停机；DeepSeek 首轮只完成 1/9，补充只完成 2/9，且完成的是不同文书。它们提供了运行可用性和若干真实文本错误样本，尚未形成相同文书上的完整配对能力比较。以下所有文件位置均相对本目录，JSONL 行号从 1 开始，`candidates[i]` 下标从 0 开始。

## 运行失败、格式失败与语义错误分别统计

| 独立运行 | 计划文书 | 结果回执行数 | `stop` 回答 | 运行或协议边界 |
| --- | ---: | ---: | ---: | --- |
| `dev-qwen-1` | 3 | 1 | 1 | 整轮在 112.160 秒因 `external_memory_guard` / SIGTERM 停止；这一个回答有 Markdown 围栏，正式 JSON 校验失败 |
| `dev-qwen-kv4-2` | 3 | 1 | 1 | 整轮在 204.192 秒因相同保护停止；这一个回答也有围栏 |
| `dev-qwen-isolated-3` | 3 | 0 | 0 | 旧阶段的三个独立 worker 均被内存保护停止，没有可审回答 |
| `dev-deepseek-1` | 3 | 3 | 1 | 两条 `request_error` / `URLError`，一条完整回答；进程 exit 0 不能代表三次请求都完成 |
| `holdout-qwen-1` | 9 | 0 | 0 | 首个文书 `mf4-wx-xw-2021-14` 在 16.128 秒被内存保护停止，其余未启动 |
| `holdout-deepseek-1` | 9 | 4 | 1 | 三条 `URLError` 后按协议停止；1 个完成、3 个请求错误、5 个未访问 |
| `holdout-deepseek-supplement-2` | 9 | 5 | 2 | 独立补充运行仍三条 `URLError` 后停止；2 个完成、3 个请求错误、4 个未访问 |

依据为各运行的 `outcome.json:1`（文件为格式化 JSON，具体字段见 `attempts` 或顶层）及 `results.jsonl` 全部原始行。旧开发版 Qwen 的单条结果仍写 `finish_reason=stop`，整轮 `outcome.completed=false`；不能把单条 stop、协议成功和整轮完成混用。

`URLError` 能证明请求没有产生正常模型回答，单凭该回执不能判断具体是网络、TLS、代理还是服务端故障，也不能归因为模型不懂材料。内存保护前没有产生回答的文书，不能归为该文书的语义判断错误。评分继续把这些文书的 gold 保留为 FN，这是端到端产出指标的分母规则，不表示已经观察到模型逐项答错。

## Qwen 围栏与原文引用的独立核查

`results/dev-qwen-1/results.jsonl:1` 和 `results/dev-qwen-kv4-2/results.jsonl:1` 都属于 `mf4-cq-rc-2025-3`，`raw_output` 以 `` ```json `` 开始、以 `` ``` `` 结束。严格 `JSON.parse` 不能接受这些围栏。正式 assessment 两轮的 `protocol_valid` 都是 0，accepted strict TP 都是 0；本报告没有去围栏覆盖原结果。

仅在内存中移除最外层围栏，供错误诊断，再调用应用同一个 `validateCandidateOutput`：第一轮 7 项中 6 项通过字面校验、1 项拒绝；KV4 第二轮 7 项中 4 项通过、3 项拒绝。这些是离线字面诊断数量，不是正式成绩，更不是语义正确数量。

- 第一轮 `candidates[2]` 的 quote 把原文 `2024年` 改成 `2,024年`。原始回答中的片段是 `76名员工2,024年12月-2025年1月`，`data/dev.inputs.jsonl:1` 的 `p0007` 是 `76名员工2024年12月-2025年1月`。这会使精确连续引用失败。
- KV4 轮 `candidates[3]` 把原文 `陈自勇、郑华义` 改成 `陈自,郑华义`。`candidates[4]` 把工资事实句归到 `p0000`，而 `p0000` 只有被处理单位名称；该句实际在 `p0004`。`candidates[5]` 同时用了错误块 `p0000`，并把原文 `劳动保障法律法规的规定` 改为 `劳动保障法律法规规定`。

这说明即使离线修掉格式，引用改字和错误块归属仍会被拒绝；围栏不是这两条回答的唯一问题。相同题目的两个开发回答也不能作为两份独立文书扩充样本量。

## 四个经原文复核的语义失败

### 1. Qwen 把欠付事实标成完整应付，并把行政调查事实标为当事人主张

回答位置：`results/dev-qwen-1/results.jsonl:1 → raw_output → candidates[5]`；同一错误也出现在 KV4 轮同位置。输出关键字段为：

```json
{"kind":"due_total","value":"609860.42元","subject":null,"period":"2024年12月-2025年1月","qualifier":"gross","assertion":"claimed"}
```

原文位置：`data/dev.inputs.jsonl:1`，id `mf4-cq-rc-2025-3`，`p0004`：

> 经查，你单位未按照《中华人民共和国劳动法》及相关劳动保障法律法规的规定按时足额支付你单位员工陈自勇、郑华义、刘松等76名员工2024年12月-2025年1月工资共计609860.42元。以上事实有你单位提供的工资表为证。

该句描述被欠付的工资，未提供该群体该期间完整应付和累计已付的账目；按冻结口径应为 `arrears`，不能由该数直接取得 `due_total` 含义。该段以“经查”和工资表证据陈述行政调查认定，应使用 `decided`，不是 `claimed`；原文也没有明示税前 gross 口径。`p0007` 后续“责令……足额支付”是另一个 `award` 事件。第一轮该候选引用本身可以逐字支持，所以这属于引用通过后仍存在的类型/断言错误；KV4 轮相同候选另有前述引用错误。两轮正式结果仍因围栏失败，不把这项离线语义分析加回分数。

### 2. DeepSeek 把投诉欠薪额当成本期完整应付总额

回答位置：`results/dev-deepseek-1/results.jsonl:3`，id `mf4-cz-2023-27`，`candidates[7]`：

```json
{"kind":"due_total","value":"17000元","quote":"17000元","blockId":"p0009","subject":"何某某","period":"2022年10月、11月、12月","qualifier":"gross","assertion":"claimed"}
```

原文位置：`data/dev.inputs.jsonl:3 → p0009`：

> 申请人书面向池州经济技术开发区综合执法大队（以下简称“大队”）投诉第三人拖欠其妻子何某某2022年10月、11月、12月工资共计17000元。

原文是投诉主张中的 `arrears`，不是完整应付账目；`claimed` 保留了主张层级，但 `due_total` 把余额与完整总额混淆，`gross` 也没有字面依据。这里的 `quote="17000元"` 确实存在且包含 value，所以应用字面 validator 接受了它，不能据此认为含义正确。本条回答共有 11 项通过协议/字面校验，但正式 strict 只有 4 项与 gold 匹配。

### 3. DeepSeek 把承包项目经理当作劳动者，并把工作地点短语当作期间

回答位置：`results/holdout-deepseek-1/results.jsonl:2`，id `mf4-wx-xw-2021-50`：

- `candidates[3]` 输出 `kind="worker", value="姜勇", subject="姜勇"`，quote 是 `姜勇尚欠陆锡俞2000元`。
- `candidates[4]` 输出 `kind="period", value="在后宅明园星都工作", qualifier="employment_period"`，并将相同短语放入 period 字段。

原文位置：`data/holdout.inputs.jsonl:2 → p0011` 明确陈述：

> 姜勇陈述的主要内容为“其不是申请人的员工，是案涉装修工程的项目经理，与申请人是合作关系并签订协议。……陆锡俞系其临时招用……”

`p0012` 进一步讨论自然人姜勇发包/招用关系。该材料可以识别姜勇的姓名，但没有把姜勇作为本次工资请求的劳动者；把“欠陆锡俞款项的人”直接变成 worker 是角色混淆。`在后宅明园星都工作` 表示工作地点/项目经历，没有起止时间或日期，不能作为 employment_period。两项引用都是实际连续文本，均通过了 validator，语义仍不成立。

该轮唯一 stop 回答为此文书，共 17 项字面有效候选，strict TP=5、FP=12、FN=7。不能把 17 项字面有效解释成 17 项业务正确。

### 4. DeepSeek 把工人群体工资归给单个劳动者

回答位置：`results/holdout-deepseek-supplement-2/results.jsonl:1`，id `mf4-wx-xw-2021-14`：`candidates[7]` 把 `523060元` 的 subject 设为 `刘某某`；`candidates[9]` 和 `[13]` 又把 `503060元` 归给 `刘某某`。

原文位置：`data/holdout.inputs.jsonl:1 → p0012`：

> 申请人受托人人董乾在同日对拖欠王振辉班组中刘某某等11人工资523060元的事实签字确认，后申请人向工人支付了工资20000元，故现申请人仍拖欠工资503060元。

`p0020` 再次写明 `刘某某等11人的欠付工资金额为503060元`。这两个金额属于 11 人群体，不是刘某某个人金额；当前单劳动者 subject 字段无法表示这个集合，应保留 `subject=null`，不能丢掉“等11人”后绑定单人。类似地，该回答把 `施某某等12名工人` 的 `260995元` 和 `施某某等6名工人` 的 `104995元` 也绑定为 `施某某`，属于同类归属错误。金额逐字出现在源块中，并不能证明归属正确。

此文书 16 项候选字面有效，strict 只有 2/17 个 gold 事实匹配。补充运行另一条 stop 位于 `results/holdout-deepseek-supplement-2/results.jsonl:4`，id `mf4-yc-th-2024-100`，6 项候选字面有效、strict 2/10；它是另一份材料，不能用来补首轮已成功的 `mf4-wx-xw-2021-50`。

## 正式分母与排名的解释边界

本次在内存中使用冻结输入/标签和原始 `results.jsonl` 调用未改动的 `assess`，核对已有报告，并独立核对补充运行；没有写入或替换 assessment：

| 独立留出运行 | 完成文书 / 计划 | strict TP / FP / FN | strict precision / recall / F1 |
| --- | --- | --- | --- |
| Qwen 首轮 | 0 / 9 | 0 / 0 / 167 | null / 0 / 0 |
| DeepSeek 首轮 | 1 / 9 | 5 / 12 / 162 | 0.2941 / 0.0299 / 0.0543 |
| DeepSeek 独立补充 | 2 / 9 | 4 / 18 / 163 | 0.1818 / 0.0240 / 0.0423 |

DeepSeek 首轮成功集仅为 `{mf4-wx-xw-2021-50}`；补充成功集为 `{mf4-wx-xw-2021-14, mf4-yc-th-2024-100}`，交集为空。不得把两轮成功行拼成“3/9 完成”的新运行或计算合并 F1，也不能从每题多次尝试中挑选表现较好的行。

这些分数可作为每个独立运行在当前资源/网络条件下的端到端产出回执。它们不能支持“DeepSeek 语义能力优于 Qwen”：Qwen 没有留出回答可配对比较；DeepSeek 的少量成功样本受到完成选择影响；本机量化推理与远程 API 的主要中断来源也不同。补充 F1 低于首轮同样不能推出模型退化，因为两轮成功题不同。

可以成立的较窄结论是：本轮 Qwen 运行没有形成可用的留出候选输出；DeepSeek 已返回回答中，协议/引用通过后仍存在类型、角色、期间与群体归属错误，尚不足以自动确认完整工资金额。当前将模型输出停留在候选、另由用户确认主体/期间/完整性和冲突的边界仍有实际必要。

## 复核边界与证据绑定

本次核查了两条开发 Qwen stop、开发 DeepSeek 的一条 stop、首轮留出 DeepSeek 的一条 stop、独立补充的两条 stop，共 6 条返回回答；Qwen 两条来自同一 dev 文书。逐字核对了本报告例子对应的源块，并结合冻结标签检查正式配对，没有重新获取原网页、原始附件或未选入的段落。本报告只判定给定摘录里的提取含义，不判断真实劳动关系或应得工资。

已重新计算 `data/dev.inputs.jsonl`、`data/dev.labels.provisional.jsonl`、`data/holdout.inputs.jsonl`、`data/holdout.labels.provisional.jsonl` SHA256，全部与 `freeze.json` 一致。留出输入 SHA 为 `7acf7ff5c673f55668e7659497fe05d454687513e9a7e004e0b358354aca92fb`，留出标签 SHA 为 `b87b7b4c9daf25504189edb559ca2cac2d7e93ef85d3eb3def53c6d8623e45f4`。

重点返回文件 SHA256：

```text
results/dev-qwen-1/results.jsonl 5c312c6bb5f5d11f159dac3c9b80d5183ef567bd6784bf9ea5d6a18705fff359
results/dev-qwen-kv4-2/results.jsonl 979a1a879edddbd85e4f2101cd986ce5fd962d0aed7a8815b6e608868fa0a84c
results/dev-deepseek-1/results.jsonl c14b9b28ce5efa0ee28fbcbcfd03d91697de82cbaf4f413d3b158a4de25f0068
results/holdout-deepseek-1/results.jsonl f849540c268b94c306b10bf36433258b6c9fdb69621e6522844fe1e99a849e74
results/holdout-deepseek-supplement-2/results.jsonl a82b8cfcaea381113e7f24a725ad25f7387f08c7c3a8aba254f3689e191eb180
```

本复核者未参与 core、Python 推理、run 或 scorer 实现；先前按授权实现过网站侧任务服务的外部保护，该部分的独立技术复核由主 Agent 承担。本次错误归因不修改这些实现及冻结数据，也不代替完整网站 HTTP、浏览器或用户验收。
