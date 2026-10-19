# v7：Issue #42 修复、新材料与首次模型对比

本次交付分为依赖的两个 PR：[PR #45](https://github.com/ZZZZihan/anxin-work-rights/pull/45) 修复解析、金额可用性和事件评分；[PR #46](https://github.com/ZZZZihan/anxin-work-rights/pull/46) 保存新材料、标注协议、首次回答、失败、冻结结果和后验复评。Issue [#42](https://github.com/ZZZZihan/anxin-work-rights/issues/42) 保持打开。两个 PR 未合并，未训练或部署生产，人工业务验收尚未完成。

## 当前结论与证据入口

- [技术验收与模型比较](ISSUE42_ACCEPTANCE.md)：当前状态、评分口径、结果与业务限制。
- [ROUND43 失败记录与生命周期](POSTRUN_ROUND43_LIFECYCLE_RETENTION.md)：四项最小复现、原始失败保存、并发发布与运行封存互斥。
- [ROUND42 评分报告不可覆盖发布](POSTRUN_ROUND42_ASSESSMENT_PUBLICATION.md)：真实CLI覆盖复现、修复与独立检查。
- [ROUND41 实验流程修复](POSTRUN_ROUND41_EXECUTION.md)：启动前停止收据、原子清单发布、直接历史核验复制范围与保留证据。
- [ROUND40 应用修复](POSTRUN_ROUND40_APPLICATION.md)：八条最新审查的最小反例、同脚本红→绿、实际隔离 HTTP、错误夹具和失败原件。
- [剩余问题](ERROR_REVIEW.md)：模型语义错误、保守误警、标签争议及自然材料覆盖空缺。
- [标注协议](ANNOTATION.md)、[来源复核](SOURCE_REVIEW.md)、[首跑后标签审计](POSTRUN_LABEL_AUDIT.md)：非专家分类与案件隔离边界。
- `postfreeze-evidence/round40/`：作者、非实现者及精确应用 CI 的原始日志、独立回执和文件摘要。早期各轮 `POSTRUN_*` 与冻结目录继续保留。

应用提交 `6d081321b24b9fadd0088d6cc5b6c60e985eda26` 的 [CI 39161803412](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39161803412) 已通过独立原件审计：27 步成功，Vitest 1789/46 文件、runtime 9720、材料 68、HTTP 481、OCR 17 全部通过，Linux 无平台跳过。该次历史读取时 146 个审查线程均已解决；随后新增的3项P2仍保持未解决，详见当前验收限制。应用 CI 不代替 PR46 精确整合提交的 CI；后者以 PR 检查和独立最终回执为准。

当前 v33 复评 manifest 为 `00a764d4f810af7e0a13fe1ae186807fd7503673a6cc19f7d0d15c6f28c6d6cf`，绑定119项当前代码、116项v32归档代码和原60项结果。三路逐案报告与v32逐字节相同。继ROUND41/42后，本轮修复既存报告重试残留、坏JSON污染事件、holdout与封存缺互斥、outcome部分写截断问题；原回答、标签及评分规则不变。实际write158.241秒、只读check182.299秒均退出0，当前完整检查分别记录；原v1–v32及失败全部保留。

## 新材料和结果含义

15 个案件/项目来自 7 份官方网页，3 份开发材料、12 份留出材料。留出集固定 43 条参考事实（23 金额、20 日期），含 2 份自然空材料。开发与留出按案件/项目分开；其中 2 个来源网页同时含两侧案件，不能称网页级隔离或统计独立。没有观察到旧 34 份 v4–v6 案例重合，但匿名身份及模型预训练接触情况未知。

标注状态为 `provisional_non_expert`。输入、标签及初始协议在首跑前冻结；作者与非实现者完成的是技术复核，尚无业务专家或用户的正式验收。Qwen、DeepSeek 各 12 份首次回答及规则 12 份输出完整保留，没有按空输出、低分或格式错误重试挑选答案。后续修复只另存复评，不覆盖原始分数，不追加 gold 别名。

下表为当前 v33 的 F1（%），不是准确率。raw 保留非法、重复及证据错误候选；accepted 仅表示协议接受，不等于可用事实、人工确认或可计算金额。六层均先要求唯一事件、一对一匹配，再逐层增加属性要求。

| 系统 | raw 基本 | accepted 基本 | raw 关联 | accepted 关联 | raw 严格 | accepted 严格 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 窄规则 | 8.89 | 8.89 | 0.00 | 0.00 | 0.00 | 0.00 |
| Qwen3-32B-4bit | 30.19 | 34.04 | 18.87 | 21.28 | 15.09 | 17.02 |
| DeepSeek-v4-pro | 72.34 | 72.34 | 57.45 | 57.45 | 53.19 | 53.19 |

Qwen 63 raw / 51 accepted / 12 rejected，DeepSeek 51 / 51 / 0，规则 2 / 2 / 0。46 条协议接受金额中，19 条精确、25 条概数/null、2 条 unsupported/null，全部仍有主体/期间关联警告。三路对非空材料的整案严格全对均为 0；自然空材料的正确空输出不能掩盖有事实案件的错误。`calculation_authorized:false` 是比较工具的固定政策字段，不能据此声称这些候选都经过真实 UI 授权验收。

本批 DeepSeek 得分高于 Qwen 和窄规则，仍会把劳务工程款当完整已付工资；Qwen 仍会把资产变价或含费用的法院收款当工资实收。小样本、来源集中、非专家标签和后验协议修改限制结论，不能外推真实案件可靠性或训练就绪。

## 原始运行、失败与复现

原 freeze 时间 `2026-10-18T04:09:33.275Z`，124 项文件绑定；原结果 manifest 覆盖 60 个文件。历史代码按原摘要还原，当前源码不能用来冒充原首跑代码。首跑应用为 `24c8015d97391ca55e9e0b1d2ba23bf204ead74d`；原冻结包括当时尚未提交的实验脚本，其实际来源与 36 份完整代码归档均已记录，旧 32 份仍保留。

正式每系统每案例只运行一次，均为 12/12 stop。Qwen 12 份 JSON fence，DeepSeek 11 份原生 JSON、1 份 fence；格式、协议接受及事实正确是不同指标。未用 JSON mode 或事后补字段。DeepSeek 一次发送前连接超时及重连保留，仅一次成功 POST；开发阶段启动失败、两轮就绪结果、后续错误夹具、完整测试失败与主动停止记录亦保留。

Qwen 推理记录合计 468.097 秒、含准备墙钟 516.278 秒；DeepSeek 分别 103.506/103.624 秒。启动方式与环境不同，不能当作标准吞吐比较。DeepSeek 全部开发与正式批次保守预算上界 0.51686844 美元，低于 2 美元限额；不是实际账单。模型及运行配置见 `model-identity.json`、`runtime-policy.json`、`DEVELOPMENT.md`。

```sh
# 还原原冻结代码并真实核验历史结果；零模型调用。
node experiments/material-facts-v7/verify-frozen.mjs
# 核对最新历史检查点；递归核验既有版本。
node experiments/material-facts-v7/verify-correction-v29.mjs
# 归档 v32 与当前 v33 使用同一首次输出重新计算并逐字比较。
node experiments/material-facts-v7/verify-correction-v32.mjs
node experiments/material-facts-v7/corrective-assessment-v33.mjs --check
# 项目完整工程检查，包括历史门禁与当前整合检查。
npm run check
```

当前 `--write` 拒绝覆盖已发布结果；只读核验使用 `--check`。旧版本使用其 `verify-correction-vN.mjs` 归档入口，不直接用当前源码执行旧 corrective 脚本。历史校验真实执行归档 CLI，沿用共享 15 分钟绝对截止、每层预留 2 秒；不是仅比较摘要的替代验证。归档快照、旧 manifest、原结果及失败不修改。诊断、正式运行与冻结共用生命周期锁；遗留锁须核对进程和 attempt，不能按时间自动删除。

| 不可变对象 | SHA-256 |
| --- | --- |
| 原 freeze | `0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2` |
| 原结果 manifest | `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee` |
| 留出材料 | `9ec54411e9008434457ae59f68585f8fb7a6bc6d089cee4e87709bfddd6a2181` |
| 留出标签 | `abac05fa2c3de7d8e83e866345bf5edaec61c65f8f706bb7d5f0c0d98fa27b64` |
| v29 manifest | `d66b3c2ccb1897c08168fc16372d2aafc35ca75d3ced64debbe5fa6fd536c74c` |
| v30 manifest | `e1b8b03588dc4f8de70e8f85156c370f4776219e9d14268b5df259027d8b56ba` |
| v31 manifest | `5b52b921216a651e28bbac183be4c0c14edbfc6a58e03d931b84a683cb196b4f` |
| v32 manifest | `b7f53ed2a32f9b68f4031f63addfe1e00a22f3b2323c9bf8969fb55d47b6e074` |
| v33 manifest | `00a764d4f810af7e0a13fe1ae186807fd7503673a6cc19f7d0d15c6f28c6d6cf` |

精确应用 CI、隔离服务合成回归、真实模型首跑、非实现者技术复核与人工业务验收分别记录。自然材料仍缺真实 OCR、明确零金额、明确部分应付和两笔同人同期同额实际付款；合成回归不能补成自然业务证据。当前不构成自动采用金额、训练或生产发布的依据。

历史v30独立只读计数已完成：重新枚举3248条保护路径、原124项绑定及60原结果、29份代码归档目录和30份修正结果目录，216分区与18指标核算一致。它没有运行CLI或模型，不替代主侧实际write/check；详见[独立LIGHT回执](postfreeze-evidence/round40/v30-light/V30_LIGHT_INDEPENDENT_REVIEW.md)。

历史v31的数据Agent只读LIGHT已逐摘要核对113项当前/109项归档代码、原124项冻结绑定和60份结果，以及全部v1–v31结果与v1–v30代码归档；12781个读取路径前后稳定。216保存分区与18指标核算一致，三份report与v30逐字节相同；这次LIGHT未运行语义评分器或模型。详见[历史v31 LIGHT回执](postfreeze-evidence/round41/v31-light-independent/review.md)。

历史v32的数据Agent只读LIGHT核对116份当前代码、113份v31归档、原124项冻结绑定、60份首跑结果及全部旧档案，13405条读取路径在核对期间和再次复核时稳定。216保存分区、18指标一致；三份report与v31逐字节相同。第一次遇主侧追加37项证据的时序失败原样保留，稳定目录后使用同一脚本/断言重核通过。该Agent参与过标注和run实现；本核算不执行语义评分，不属于标签或整个实现的非作者独审。详见[历史v32 LIGHT回执](postfreeze-evidence/round42/v32-data-agent-light/review.md)。

历史 v32 本地完整检查实际退出0，用时3559.505秒；Vitest1789/46文件、材料67通过/1平台跳过、runtime10292通过/1平台跳过、Python9/11/16通过。该结果不能替代当前 v33；b199远端CI因新发现主动取消。当前源码整合定向运行器47项、额外独立14项通过，23份变动源码/测试的局部lint0错误0警告。最终构建的隔离HTTP已实际481项通过，用时35.941秒，482份合成raw/候选及480份重启快照、cleanup通过。当前v33本地完整 `npm run check` 实际退出0，用时3904.898秒；Vitest1789/46文件通过，材料67通过/1项Linux OCR平台跳过，运行时10345通过/1项Linux保留僵尸进程平台跳过（共10346）、0失败，Python9/11/16通过。类型、构建及数据检查通过。完整原lint为30警告/0错误，已变动源码与测试的定向lint为0/0。首轮完整失败日志和第三条旧断言字节保留；迁移仅改测试，119项产品绑定及冻结结果不变。本提交推送前尚无自身远端CI，最终以[PR46检查](https://github.com/ZZZZihan/anxin-work-rights/pull/46/checks)及精确提交回执为准，平台跳过须由Linux CI另核。

当前v33数据Agent只读LIGHT核对119份当前代码、116份v32归档、原124项冻结绑定和60份首跑结果；重新枚举v1–v33结果及v1–v32代码档案，2482条先前不可变路径未变，2738条读取路径前后稳定。216保存分区、18指标算术一致，三份report与v32逐字节相同。本次排除持续追加的postfreeze-evidence目录；没有执行语义评分、历史CLI或模型。该Agent参与run修复和标注，核算不称标签独审或对自身代码的非实现者复核。见[数据Agent LIGHT回执](postfreeze-evidence/round43/v33-light/review.md)。

首轮v33完整检查实际退出1，用时3860.473秒：Vitest1789/46文件通过，材料67通过/1平台跳过，运行时10344通过、1失败、1平台跳过（共10346）。唯一失败是旧ROUND41并发发布用例仍要求保留完整EEXIST失败方stage；按ROUND43新合同仅将数量断言1改为0。独立复跑同3项旧2通过1失败→修后Node24/26各3通过，真实write/sync/close及清理失败保留检查继续通过。原完整失败日志和旧测试字节保留于[ROOT整合证据](postfreeze-evidence/round43/root-integration/)。产品119项代码绑定、v33及原始结果均未改变；第二次完整检查最终通过，实际结果见上文；首轮失败仍保留。
