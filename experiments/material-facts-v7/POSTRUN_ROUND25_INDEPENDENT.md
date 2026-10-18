v18 独立验收结果为 **ARTIFACT_PASS_APPLICATION_BLOCKED**：冻结产物和实际五门禁通过，ROUND25 两项应用修复及有限续文交叉通过；随后 ec8 提交新出现五条 review 尚未修复，因此不能将本次证据称为整个 PR 或人工业务验收通过。v18 保持不可变，新问题进入 ROUND26，不回改原模型结果或本版分数。

正式 manifest SHA-256 为 `67cfc9e3746d5de87492bebe903da1d773fa39e50da056978104b0b8a32c99aa`。固定首跑 result-manifest 仍为 `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee`，freeze 仍为 `0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2`。

独立只读脚本实际核对了 73 份当前依赖、70 份 v17 精确归档及完整文件集、原始 60 份文件、v1–v17 历史 manifest 和各版产物摘要。原始输入、非专家暂定标签、三路模型 raw 与首轮报告绑定不变。对 3 backend × 12 case × 6 layer 的 **216 个已保存评分分区**，重新检查了完整、互斥的配对/缺失/多余索引、事件 ID、TP/FP/FN 及 precision/recall/F1 算术，每层固定参考事实分母为 **43**。此脚本不导入原 scorer；它是保存匹配结果的独立分区和算术核对，不冒称另行实现了语义匹配器。实际深链验证另由下述门禁完成。

以下各格为 TP/FP/FN；全部六层数值相对 v17 不变：

| Backend / 层 | basic | relational | strict |
|---|---|---|---|
| rules raw | 2/0/41 | 0/2/43 | 0/2/43 |
| rules accepted | 2/0/41 | 0/2/43 | 0/2/43 |
| qwen raw | 16/47/27 | 10/53/33 | 8/55/35 |
| qwen accepted | 16/35/27 | 10/41/33 | 8/43/35 |
| deepseek raw | 34/17/9 | 27/24/16 | 25/26/18 |
| deepseek accepted | 34/17/9 | 27/24/16 | 25/26/18 |

真正五门禁使用 ROOT 的 `scripts/material-facts-v7-correction-v18-gates-independent.test.mjs`，Node v24.19.0 实际退出 0，**5 通过、0 失败，214.096 秒**。这是一个父测试加四个子测试，包含当前 73 依赖绑定、70 历史代码恢复及异常回调清理，以及两个真实 CLI 负测。JSON 语义等价但字节不同的 manifest 经过历史验证后以状态 1 拒绝（105.437 秒）；当前金额守护只增加注释同样以状态 1 拒绝（105.814 秒）。夹具要求匹配实际 verifier 错误，超时不算通过。原有 manifest、策略字节前后保持一致。门禁结束后再次执行轻量核对，输出与门禁前逐字相同；已通知主侧不存在本复核者在跑重链。

rules 和 DeepSeek 报告与 v17 逐字相同。Qwen 唯一金额诊断变化位于 `mf7-bjkfq-2025-2222`：原 raw C[1]、accepted[0] 对应 gold E[4] / `awarded-leave-wage`，原文 b02 为“……应发未休年休假工资八百零四元六角整；”。候选 value 的原始码点区间为 [55,62)，gold 为 [55,63)，只差货币终止字“整”，没有裁掉数字或角分。恢复为 **804.60 / exact** 合乎这段字面金额语法。该事件在全部六层原配对均未变化，所以分数不变；Qwen 报告 review issue 总数仅由 63 降为 62，去掉一条 `source_amount_context_mismatch`。

这笔金额仍有 `source_relation_unresolved`，并未获得计算授权。当前三路合计 46 条 accepted money 中，**21 exact、23 approximate、2 unsupported**；46 条均保留关系待核，0 条是无复核问题的精确金额、0 条获得 calculation_authorized。恢复金额、候选 accepted、完整关系可信与可计算是不同状态，不能把 guard 全部拦截说成模型全错，也不能把本次金额恢复说成真实案件已确认。年假工资分类和标签仍属预登记的非专家研究标注。

ROUND25 应用回执另外绑定 d571 money / b214 source / cbf ingest 及原样 27 项双运行时测试，每个运行时均实际 27/27；原 f16 红结果、2953/2e0 中间版本与额外跨块续角分失败均保留。轻量 v18 核对首稿误留两处 schema /17 断言，已保存失败日志，再以新文件 `v18-independent-report-check-final-v2.py` 改为正确 /18，未改任何产物。该夹具迁移失败不计产品失败，也未覆盖旧证据。

最新主侧已保存的 ec8 review 有五条新问题：比较符号界限（P1）、金额/数额标签后的未知桥、后置按单位费率、剩余传统无金额工资描述，以及纯币种。此处记录其未决状态，不将它们混为本轮两项修复失败，也尚不冒称独立复现完成。整体应用仍阻塞，下一步只做这些有限新族的独立红绿测试。

本复核未调用模型或训练，未运行 HTTP、build、完整 npm check、推送、合并或部署，未修改任何新旧冻结文件、标签、历史结果或旧回执。主侧报告 ec8 CI 绿、v18 write/check 退出 0，是单独来源；ROOT 完整检查按最新安排尚未执行。**人工业务和法律验收未完成**。请求配置为 GPT-6.1 Sol、ultra，实际后端配置未独立核验。
