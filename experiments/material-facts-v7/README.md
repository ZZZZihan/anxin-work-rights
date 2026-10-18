# v7：事件绑定修复与新公开材料首跑

Issue [#42](https://github.com/ZZZZihan/anxin-work-rights/issues/42) 的工程修复由 [PR #45](https://github.com/ZZZZihan/anxin-work-rights/pull/45) 提供，本目录保存其后的新材料、运行协议、全部首次输出、失败和独立复核。没有训练、合并新 PR 或部署生产。标签是非专家暂定参考，技术检查与人工业务验收分开。

## 先读的结论

最新检查点仍有阻塞：b4974a3随后收到7类新的P2（8线程含1重复），涉及后置人民币角分、繁体百分比、日期边界/支付日期、姓名与费率/多人词碰撞、普通支付续词误概数，ROUND28正在逐项复现。实验整合完整检查实际退出1，1137.956秒、运行时6811通过/50失败/1跳过（50含32叶项与18父组）；主要为历史校验截止耗尽及背压时限失败，320份受保护字节未变。原始日志、失败分类与当时package/gate快照见 [完整检查失败收据](POSTRUN_ROUND27_FULL_CHECK_FAILURE_INDEPENDENT.md)。同一v20五门禁随后独立隔离实际5通过、254.975秒，两条真实CLI负测各约125秒按预期诊断拒绝，320份字节仍不变；支持并发压力诊断，不覆盖原完整检查失败。见 [v20独立总回执](POSTRUN_ROUND27_INDEPENDENT.md)。下一版准备将测试文件并发限为2，旧执行政策、断言、首跑和历次结果不变，完整重验尚待完成。

当前应用为 PR #45 的 `b4974a3938b865147aa5714e659a4b19d4a8c771`。ROUND27补齐繁体财务数字及角分、后置不支持费率、繁体日期角色、前后置具名工资组成算式和无关概数词误拒。主侧Node24.22完整检查退出0：1789 Vitest、6475运行时通过/1平台跳过、材料67通过/1平台跳过、Python9+11+16；384定向通过，非实现者26在Node24/26均通过。独立复核期间发现反向算式漏项，原9dc中间21绿和最终4776闭合分别保留。

相同222项隔离HTTP固定6b为205通过17失败→最终222通过，223份raw/candidates/finish_reason逐项相同，221份持久化快照重启不变，cleanup通过。前测17项在fresh断言停止，未到达其历史读取；不能将后测完整覆盖倒写进前测。详见 [ROUND27记录](POSTRUN_ROUND27_APPLICATION.md)、[最终应用独立复核](ROUND27_APPLICATION_REVIEW_PREFIX_CLOSURE_INDEPENDENT.md) 与 [HTTP证据复核](postfreeze-evidence/round27/http222-review/review.md)。精确应用[CI39129728847](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39129728847) SUCCESS，Linux运行时6476/材料68全部通过，含222项HTTP和OCR。

最新另存复评为 `corrections-v20/`，绑定79项当前代码，v19的76项代码另行归档。manifest SHA `6bddae4eb7d7da1fd744a79a399620e8fa60e7c5fe79d1ef7aaf8a072b491a87`，主侧write退出0。相对v19，rules报告逐字相同；Qwen10条和DeepSeek13条仅将概数说明改为内嵌多/余提示，金额状态、六层TP/FP/FN及逐案匹配未改变。零新增模型请求，不改输入、gold或原回答。主侧write/check均退出0，独立轻量79/76/60/216核对通过；独立实际门禁及实验整合完整检查正在同一次完整check中执行，完成后另附结果，当前不能以产物发布代替验收。

v19的ARTIFACT_PASS_APPLICATION_BLOCKED检查点保留：当时76/73/60/216核对、主侧write/check、独立实际5门禁及精确6b CI通过，随后发现五项应用问题。最终修复不改写当时状态。技术检查、模型小样本结果和人工业务验收继续分开。

三路均完成12/12份留出材料，固定43条参考事实、含2份自然空材料。DeepSeek 在本批样本的事件与属性匹配高于 Qwen 和窄规则，但仍有工程款误当完整已付工资、受益主体混淆和范围外日期；Qwen 还有同额资产处置/法院缴款误当工资实收，以及两处数量级错误。不能据本轮评分启动训练或自动使用模型金额。

首跑应用代码对应 `24c8015d97391ca55e9e0b1d2ba23bf204ead74d`；完整实验环境由原freeze的124项文件哈希绑定，其中部分实验脚本当时未提交，后续归档按哈希核验并注明真实来源。模型运行期间，第二轮代码审查发现了区间端点裁剪、任意长 value 借事件锚点得分和相对月份被误判费率三个问题。原始运行仍完成并封存，之后修复代码，对**相同原始输出**另做修正复算。原分数没有被覆盖；修正结果不是第二轮独立模型实验，不能称预登记的修正版首跑或改善效果。

第三轮审查又发现歧义位置被合并、任意叙述挤掉最小金额、部分相对月份无金额描述漏拒三个P2，已在 `5f254ec` 修复。第一次修正的24份代码另行封存；同一批原始输出再次独立复算到 `corrections-v2/`，逐案匹配、接受数量和分数与v1均相同。新增合成反例红→绿不等于自然留出材料覆盖了这些边界。

实验工具审查另发现后端参数预检、开发完成态门禁、历史可执行文件封存和修正目录中断发布四项问题。旧首跑/v1/v2均保留，v2代码另封存26份，当前完整历史归档为36份（原32份归档仍保存）；第三版只重新绑定修复后的实验工具，不新增推理或标签。

第五轮又实际复现倍数算式的基础金额泄漏，扩展覆盖裁剪value/quote、加减乘除、分数/百分比及跨换行/相邻文本块。`7d746ff`修复后，前三版结果和v3的29份绑定代码继续保留，第四版仅用同一原始回答重新核对当前代码，零新模型请求。

第六轮实验工具审查又动态确认四项P2：进程退出后排队事件重建超时定时器、诊断运行与冻结竞态、原结果清单只做JSON等价检查、错误日志缺少限额与背压。现使用终态后清理、两流各自20MB上限和逐块落盘背压、诊断与冻结全生命周期共享锁、原清单固定字节摘要修复。v4的32份代码另封存，第五版绑定当前35份代码；三路逐案报告与v4逐字相同。原失败记录及原清单字节保留，无新模型调用。

第七轮补充四项工程问题与两项实验工具问题：有限前后置工资币种归属、工资名词连接算式（含同一行裸倍数）、月工资标准误作总额、HTTP子孙进程清理，以及历史门禁父级超时预算和stdout未终止尾片段误判完成。均有对应自动回归；超时问题保留审查者原失败证据，本机没有伪造一次超时复现。v5的35份代码封存后，第六版绑定当前37份代码，仅重评同一首次输出，三路报告与v5逐字相同。未追加模型请求。

第八轮修复冻结文件部分写入、诊断目录占用预算锁名和清单JSON等价改写：冻结完整写入同级临时文件并sync/close后，以不覆盖已有目标的原子link发布；失败和被杀现场保留，发布后清理失败单独告警。保留名在任何attempt写入前拒绝。历史版本走绑定原字节的归档入口，当前v7还核对清单规范字节，空白或键重排也拒绝。v6的37份代码封存后，v7绑定39份当前代码；无新模型调用。


第九轮补充日次工资边界：无金额的今日/当日/昨日等工资描述拒收；明确日次总额与真正的日费率分开，保留姓名末字、未知、遮盖和算式等保护。作者分类71项、来源157项、独立48项通过。39项隔离HTTP旧构建33通过6失败→新构建39通过，38份持久化raw/历史快照重启不变。扩容测试初期的两次27/12失败均保存：其中6项来自夹具超出服务32任务保留上限，后通过结果持久化后退休夹具自有完成任务解决，没有调高生产容量或删除D1/R2。修正前后业务对照采用相同39项与修正后的夹具。

第九轮后的两项实验工具修复也纳入同一v8：监控采样及写入在终态/释放锁前drain，迟到错误保留失败；历史检查使用显式执行政策共享15分钟绝对截止、每层预留2秒清理，原归档代码字节及评分语义不变。此前v7的39份代码已封存，v8绑定43份当前代码（包括执行策略）；执行政策回执与原文件哈希分开保存。原审查者在旧v5递归链报告60秒超时，本机旧链41.117秒通过；另有真实本地合成计时反例证明截止行为，二者不混同。

第十一轮应用审查修复“以港币计/计算/折算”、和/与连接的明确区间、命名系数算式和完整ASCII元角分。独立50例旧19通过31失败→初次49通过1失败（“之内”遗漏）→最终50通过，原失败保留。作者189+91+56项、应用完整1789 Vitest/1287运行时通过；同50项HTTP旧40通过10失败→新50通过，49份重启raw/审计快照不变。v8的43份代码已另存；v9绑定46份当前代码，三路逐案报告与v8逐字相同，无新模型请求。

第十二轮修复五类新审查及同族边界：带修饰词的符号系数、无金额工资标准、分钟/分之一误作分币、日期或时长误作区间端点、人民幣/圓及約/餘。另补传统圓裸数裁剪角分/费率守护。作者65+122+59项、独立68项及另一位非实现者针对主侧词界/区间107项均通过；完整应用检查退出0。同一64项HTTP旧52通过12失败→新64通过，63份raw/审计快照重启不变。原始红记录、夹具错误及修复前中间状态保留，具体见 `POSTRUN_ROUND12_APPLICATION.md`。

v9的46份代码另封存，当前v10绑定49份代码，三路逐案报告与v9逐字相同。新增只读v9执行桥共享旧政策的15分钟绝对截止及每层2秒清理余量，旧政策字节和白名单不改；历史v9仍实际执行原CLI。v10仅重新评估同一原始输出，不增加模型调用、材料样本或人工业务验收。

第十三轮补齐两项P2及新引入误拒：完整阿拉伯元＋中文单字角分按整数分解析；孤立分钟/分米/角度不进入金额候选。交叉复核发现初版普通词表误拒十万分红，已收紧为明确计量单位，财务未知继续保留null。作者191与36项、非实现者46项、另一位非实现者针对分类器70项均通过，准确旧提交与中间错误版本的红记录分开保存。同一74项HTTP旧68通过6失败→新74通过，73份raw/审计快照重启不变。完整应用检查1789 Vitest/1981运行时通过，后来加入的70项另行通过并进入CI。具体见 `POSTRUN_ROUND13_APPLICATION.md` 和 `round13-application-review.independent.json`。

v10的49份代码另封存，v11绑定52份代码。新v10只读执行桥继续继承相同绝对截止及清理余量，不修改旧v1政策或v9桥。三路v11报告与v10逐字相同，原首跑及历次复算保留；没有新增模型请求、样本、标签备选或人工业务验收。

## 最新修正后描述性指标

每格为 F1（%）。全部指标使用固定的12份材料、43条参考事实评估集，不删除失败或空输出；43是召回率的参考事实分母，F1按 `2TP/(2TP+FP+FN)` 计算。raw 保留非法、重复或证据错误候选；accepted 是协议接受结果，不等于可用事实或用户确认。basic、relational、strict 六层都要求唯一事件对应，逐层增加属性要求；精确定义见 `assess.mjs`、`ANNOTATION.md`。

| 系统 | raw 基本 | accepted 基本 | raw 关联 | accepted 关联 | raw 严格 | accepted 严格 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 窄规则 | 8.89 | 8.89 | 0.00 | 0.00 | 0.00 | 0.00 |
| Qwen3-32B-4bit | 30.19 | 34.04 | 18.87 | 21.28 | 15.09 | 17.02 |
| DeepSeek-v4-pro | 72.34 | 72.34 | 57.45 | 57.45 | 53.19 | 53.19 |

Qwen 原始63项、接受51项、拒收12项；DeepSeek 原始及接受均51项；规则均2项。首跑原 accepted 基本/关联/严格 F1 为 Qwen 40.43/27.66/21.28、DeepSeek 74.47/57.45/53.19、规则8.89/0/0。所有原 TP/FP/FN 见 `comparison.json`；二十版修正的全量计数、逐案变化和代码绑定分别见 `corrections/`、`corrections-v2/`、`corrections-v3/`、`corrections-v4/`、`corrections-v5/`、`corrections-v6/`、`corrections-v7/`、`corrections-v8/`、`corrections-v9/`、`corrections-v10/`、`corrections-v11/`、`corrections-v12/`、`corrections-v13/` 、`corrections-v14/` 、`corrections-v15/` 、`corrections-v16/` 、`corrections-v17/` 、`corrections-v18/` 、`corrections-v19/` 与 `corrections-v20/`。v1至v3三路报告逐字相同；v4的规则与DeepSeek报告逐字相同，Qwen仅一条通用核对提示增加“倍数算式”，其余逐案结果及全部六层计数不变。v5三路报告与v4逐字相同；v6与v7三路报告也分别与前版逐字相同；v8三路报告与v7也逐字相同；v9三路报告也与v8逐字相同；v10三路报告与v9也逐字相同；v11三路报告与v10也逐字相同；v12至v17三路报告也分别与前版逐字相同；v18仅Qwen一条年假金额可用性及一条核对提示变化，六层计数不变；v19三路报告与v18逐字相同；v20仅Qwen10条与DeepSeek13条概数说明改变，数值及配对不变；上表采用最新v20，不是模型能力提升。

收紧 value 边界使 Qwen 3个基本、3个关联、2个严格 TP 失效，DeepSeek 1个基本 TP 失效。有些损失来自“月工资16000元”“150万元执行款”超出有限金额包装，而实际金额、角色本来正确，应解释为严格值边界损失，不能全部称金额理解错误。修正允许完整币种前缀、有限工资对象后缀及“整/正”货币终止词；后者是在首跑后的审查中确定，不能倒称事前登记。没有新增 gold 别名。

## 数据、运行和失败边界

- 新集共15个案件族：3份开发材料/13项参考事实、12份留出材料/43项；来自7份官方网页。独立来源与案件隔离核对见 `SOURCE_REVIEW.md`、`annotation-review.independent.json`、`data/independence.authoring.json`。主实现者冻结前没有查看留出内容；数据作者和技术审查者看过以完成标注及复核。不同案件不等于独立来源网页：其中2份出版页同时含开发案与留出案，划分按案件/项目而非来源网页；匿名同案关联也无法穷尽，公开来源也不能排除模型预训练见过材料。
- 两轮开发就绪检查的提示、数据和标签均相同；第二轮因代码审查修复后重新满足运行哈希门禁而执行，没有挑选最好输出。两轮及初始化失败都保存，见 `DEVELOPMENT.md`。
- 正式留出每系统只执行一次，无因空输出、低分、非法格式或协议拒收重投。三路全为12/12 stop。DeepSeek 最后一案有一次发送前连接超时，第二次连接成功后仅一次 POST；传输失败没有抹去。Qwen 每案独立本机进程，全部 memory/events/token IDs 留存。
- Qwen 的12份都是 JSON fence，经解析后接受；DeepSeek 11份原生 JSON、1份 fence。原生 JSON 格式率、协议接受率和事实正确率是不同指标。本轮未用 JSON mode、约束解码或事后补字段。
- Qwen 推理耗时合计468.097秒，含独立进程准备的总墙钟516.278秒；DeepSeek 推理记录合计103.506秒、总墙钟103.624秒。环境和启动方式不同，不能解释为标准化吞吐比较。
- DeepSeek 开发加正式全部批次的保守费用预留0.51686844美元，低于2美元上限；这是预算上界，不是实际账单。模型版本、官方接口就绪、价格核验和本机资源配置分别见 `model-identity.json`、`api-models-preflight.json`、`runtime-policy.json`。

## 完整性和复现

原 freeze 时间 `2026-10-18T04:09:33.275Z`，124项文件；原结果 manifest 覆盖60个文件。当前源码已经修复，不应改写旧 freeze 以让其匹配。

```sh
# 用36份完整代码快照和未变的输入/标签/结果，还原并验证原首跑。
node experiments/material-facts-v7/verify-frozen.mjs
# 用24份第一次修正代码快照验证v1，明确不声称它是当前源码。
node experiments/material-facts-v7/verify-correction-v1.mjs
# 用26份第二次修正代码快照验证v2。
node experiments/material-facts-v7/verify-correction-v2.mjs
# 用29份第三次修正代码快照验证v3。
node experiments/material-facts-v7/verify-correction-v3.mjs
# 用32份第四次修正代码快照验证v4。
node experiments/material-facts-v7/verify-correction-v4.mjs
# 用35份第五次修正代码快照验证v5。
node experiments/material-facts-v7/verify-correction-v5.mjs
# 用37份第六次修正代码快照验证v6。
node experiments/material-facts-v7/verify-correction-v6.mjs
# 用39份第七次修正代码快照验证v7。
node experiments/material-facts-v7/verify-correction-v7.mjs
# 用43份第八次修正代码快照验证v8。
node experiments/material-facts-v7/verify-correction-v8.mjs
# 用46份第九次修正代码快照验证v9。
node experiments/material-facts-v7/verify-correction-v9.mjs
# 用49份第十版代码快照验证v10。
node experiments/material-facts-v7/verify-correction-v10.mjs
# 用52份第十一版代码快照验证v11。
node experiments/material-facts-v7/verify-correction-v11.mjs
# 用55份第十二版代码快照验证v12。
node experiments/material-facts-v7/verify-correction-v12.mjs
# 用58份第十三版代码快照验证v13。
node experiments/material-facts-v7/verify-correction-v13.mjs
# 用61份第十四版代码快照验证v14。
node experiments/material-facts-v7/verify-correction-v14.mjs
# 依据64项代码快照核对另存的v15；同一原始输出，不调用模型。
node experiments/material-facts-v7/verify-correction-v15.mjs
node experiments/material-facts-v7/verify-correction-v16.mjs
# 依据70项归档代码核对v17；历史链实际校验，零模型请求。
node experiments/material-facts-v7/verify-correction-v17.mjs
# 用73项归档代码验证v18，同一原始输出。
node experiments/material-facts-v7/verify-correction-v18.mjs
# 用76份归档代码验证v19。
node experiments/material-facts-v7/verify-correction-v19.mjs
# 用79项当前代码验证v20，不调用模型。
node experiments/material-facts-v7/corrective-assessment-v20.mjs --check
```

以上命令不调用模型、不访问私有密钥、不修改原始文件。`verify-frozen.mjs` 只在自有临时目录还原旧代码，并递归执行完整 v6/v5/v4 校验，finally 清理临时目录。当前修正脚本 `--write` 先完整写入唯一同级暂存目录，再原子发布；失败暂存与失败记录保留供核查，不占用最终目录，重试使用新暂存。已有最终结果一律拒绝覆盖，日常使用 `--check`。直接在当前源码执行原 `verify.mjs` 或v1至v18的 `corrective-assessment*.mjs --check` 应因相应历史代码哈希不一致而拒绝，须使用对应快照入口。独立门禁测试确认缺/多路径、快照字节变化、原结果只多一个换行及原结果manifest的同义重排/空白改动均被拒绝，callback 抛错后临时目录确已删除。

诊断运行从检查尚未冻结到终态写完，与冻结的枚举至发布共用 `.experiment.lock`。锁在results之外；并发竞争直接拒绝，SIGKILL或所有权变化的遗留锁保留，恢复前须核查owner的主机/PID、worker和已有attempt。不能仅按锁年龄自动删除。生命周期与锁回归使用本地合成worker/临时文件系统，不调用真实模型；完整生产代码的数据和身份门禁另行校验。

主要不可变标识：

| 对象 | SHA-256 |
| --- | --- |
| 原 freeze | `0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2` |
| 修正v1 manifest | `eb5d86b831a8a6df99b52a02cd062fe977a2a03ed5ef5ef168406c1a10a010de` |
| 修正v2 manifest | `1bb6add63ec732bca31dfe65c50844411e7fba45d0addc45b0f69a11a3175f80` |
| 修正v3 manifest | `72e07756ce1901dd1060d4b03c53fb443eebd9048bf7f6bece6c6cbf3ec0c841` |
| 修正v4 manifest | `3bceefdb375173567fa7ce60c662eae991957ade70bb89f0da989edb7ebd9db6` |
| 修正v5 manifest | `eb79da00daa92966f081a2eba35d7355e258a45d18411570834efc62d632e32e` |
| 修正v6 manifest | `0c9ef56e30e278c816e088a934df1cb8f0cdc944c262b9bd9f88be146909ee69` |
| 修正v7 manifest | `1fb40b4c0694744f5a83c6b9ddc87bfd1958a2b85185fb178273cec13b422e31` |
| 修正v8 manifest | `8fa3100c348a94af0471e93a5a2dab8d405df2dd4debc603b3fe3dbe89fac06b` |
| 修正v9 manifest | `ccb4dce9e91f74fd24f5115133db468288b9c988f76ce28136bfd61e00bce764` |
| 修正v10 manifest | `c403c8c44146e78b4b15d775d0701cbb94455f0f33a3ebecce939092596f1718` |
| 修正v11 manifest | `42f13c238e7f88c044de27c858327b92ffd20a576970c836b1a52654421b1345` |
| 修正v12 manifest | `d74fb4e43136d6c0a18739daa79065e8ceaef6519ce2d9ddf82de72650a1184e` |
| 修正v13 manifest | `7d65625d6dd48f1319eec1ca86066fcc4bfaeed0d5f23c7195157d5e7a3fc04c` |
| 修正v14 manifest | `7ad12cb5543f7c750c7393366d115205e876ca0817333cef0a5462d2a39562cd` |
| 修正v15 manifest | `bc7ba849ed3394cfc6e1a74aa01f93ccbced443602165f43f4900e9d4cb5d292` |
| 修正v16 manifest | `5e229a33ed6e71f26b4fb01c92e9f28da66122bffde84d23e8e82c1fb6dbca69` |
| 修正v17 manifest | `55ec4fd2dae91d3b0512b3bc0e75284a44008c6388e479d553896abf0db9badd` |
| 修正v18 manifest | `67cfc9e3746d5de87492bebe903da1d773fa39e50da056978104b0b8a32c99aa` |
| 修正v19 manifest | `5f39f3870bf50c03bb8d202a021c6643c5000f770259005ebd6cfe4ac64033c7` |
| 修正v20 manifest | `6bddae4eb7d7da1fd744a79a399620e8fa60e7c5fe79d1ef7aaf8a072b491a87` |
| 原结果 manifest | `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee` |
| 留出材料 | `9ec54411e9008434457ae59f68585f8fb7a6bc6d089cee4e87709bfddd6a2181` |
| 留出标签 | `abac05fa2c3de7d8e83e866345bf5edaec61c65f8f706bb7d5f0c0d98fa27b64` |

## 验收限度

第十四轮继续处理此前绿CI后出现的测试程序清理问题：Linux僵尸记录不再造成假失败，取消/轮询/恢复程序不再只等待启动进程退出。四条程序共用有限时的自有进程组检查，无法确认清理则报告失败并保留临时现场。相同Linux独立用例旧1通过4失败→新5通过，追加查询异常/零进程组/受控Windows分支后Linux10通过；macOS9通过1Linux专项跳过。最终完整隔离HTTP为74+14+4+10项通过且清理通过，原模型结果和52份v11绑定源码字节不变。详情与原始失败见 `POSTRUN_ROUND14_HTTP_LIFECYCLE.md` 及 `postfreeze-evidence/round14/`。最新提交的完整检查与远端CI另附回执，不以第十三轮CI替代。

第十三轮v11整合本机完整检查实际退出0：1789项Vitest、2329项运行时/证据检查、材料67通过/1个本机平台跳过、Python9+11+16。v11写入与只读复算通过，独立5项门禁实际拒绝清单同JSON字节改动和当前guard漂移，216个评分分区及52/49代码绑定核对通过。PR45最终92ba4dd的完整远端CI与74项HTTP通过；PR46最终精确提交CI另记于PR，不能用此前v10的绿检查代替。

第十一轮整合本机检查通过1789项Vitest/46文件、1537项运行时/证据检查、材料67通过＋1本机Linux平台跳过、Python9＋11＋16；v9只读复算与非实现者5项实际门禁通过，216个材料×层级分区、46份代码及原60份结果逐一核对。应用7f3a79b的完整远端CI通过，PR46的最终提交检查另记于PR。

工程验证、真实模型首跑、实现者自检、非实现者独立复算分别有记录，人工业务验收尚未进行。第五轮本机 `npm run check` 通过1789项Vitest、469项运行时/证据测试、材料67通过加1项Linux OCR本机跳过、Python 9+11+16；精确提交的远端CI另行核对，不由本机绿测代替。本机隔离 HTTP 已执行取消/重启14项；最新代码构建的材料事实回归扩展为24项（旧13/17项回执及同24项修前6失败均保留），使用合成模型回答，验证 raw 保留、拒收、两次同额事件保留、历史确认和重启复读；它没有使用真实案件或本批全部模型回答走完整用户确认流程。

第六轮完整本机检查仍为1789项Vitest、材料67通过/1平台跳过、Python 9+11+16，运行时与证据检查新增为494项；之后补入的v5当前代码绑定门禁4项另行执行通过，scoped ESLint和当前v5只读复算亦通过。最终CI会以完整package同时运行498项，状态以PR的精确提交检查为准。本轮应用代码与PR45 `7d746ff`一致，未重复本机HTTP；前轮24项及重启回执仍在，远端CI另执行HTTP。

第七轮本机完整检查通过1789项Vitest、814项运行时/证据检查、材料67通过/1平台跳过、Python9+11+16。当前v6只读复算通过；新增独立v6门禁5项实际拒绝旧档案改字节和当前依赖漂移，216个材料×层级计数重新核对。应用同32项HTTP旧24绿8红→新32绿，重启31份raw与历史不变。非实现者82项、进程树5项均通过。以上均属于技术证据，不追加自然材料或人工业务验收。

第八轮最终本机完整检查通过1789项Vitest/46文件、842项运行时/证据检查、材料67通过/1平台跳过、Python9+11+16；当前v7只读复算通过。原子发布12项、保留名11项及现有锁9项组合32通过；独立v7门禁5项实际验证同JSON空白/键序改写被拒，39代码绑定和216材料×层级重新核对。应用代码仍为PR45 `36ad568`，其完整CI通过，32项HTTP与31快照证据保持；本轮未重复本机HTTP。PR46最新精确提交的远端CI在PR状态单独记录。

本批共46条协议接受金额，21条派生出精确金额、23条概数无精确金额、2条不支持；全部仍带 `source_relation_unresolved`，没有“无核对问题的精确金额”。这说明当前防御保守，不说明46条都语义错误。报告的 `calculation_authorized:false` 是比较工具固定政策字段，不是每条模型候选经过真实 UI 授权流程的证明。

待办与明确语义错误、程序保守拒绝、标签争议分别见 `ERROR_REVIEW.md`、`POSTRUN_LABEL_AUDIT.md`、`POSTRUN_MONEY_AUDIT.md`、`POSTRUN_INDEPENDENT.md`、`POSTRUN_ROUND3_INDEPENDENT.md`、`POSTRUN_ROUND4_INDEPENDENT.md`、`POSTRUN_ROUND5_INDEPENDENT.md`、`POSTRUN_ROUND6_INDEPENDENT.md`、`POSTRUN_ROUND7_INDEPENDENT.md`、`POSTRUN_ROUND8_INDEPENDENT.md`、`POSTRUN_ROUND9_INDEPENDENT.md`、`POSTRUN_ROUND11_INDEPENDENT.md`、`POSTRUN_ROUND12_INDEPENDENT.md`、`POSTRUN_ROUND13_APPLICATION.md`、`POSTRUN_ROUND13_INDEPENDENT.md` 与第十三轮独立回执。没有法律专家/用户业务验收；没有自然零金额、承认的年假部分应付、真实 OCR 图片及两笔同额同属性独立实际工资付款的完整自然覆盖。样本少且来源集中，不形成模型总体能力、真实案件可靠性、训练就绪或生产发布结论。
