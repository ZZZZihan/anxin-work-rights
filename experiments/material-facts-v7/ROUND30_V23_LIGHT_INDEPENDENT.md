# ROUND30 v23 轻量独立产物核对

结论为 **PASS_LIGHT_ARTIFACT_AUDIT**。本次实际运行独立 Python 只读审计，退出码 0，用时 0.064708 秒；387 条保护路径的前后 SHA256 全部一致。未运行评分器、历史 CLI、5 门禁、完整检查、HTTP、构建或模型。本结论只覆盖保存产物的绑定、分区计数及前版差异；人工业务/法律验收尚未进行。

核对对象是 ROOT `813312eeba2349509560d5c6f2f4c60303fca5ba` 发布的 v23，manifest SHA256 为 `e41acaf87e52dda27236aabbddd0c509c1d9762eaf46ef2e46314030e7f1b56c`。88 份当前代码逐项匹配，v22 的85份代码快照与原v22manifest一一对应且文件集精确；原60个结果文件、原freeze、原result-manifest、v1至v22的历史manifest及所列产物字节均符合固定摘要。另核对35条冻结材料、标注/独立性与早期失败证据路径；未改原文、标签、原始输出或失败日志。

12份holdout材料与12份标签ID相同，固定分母43条技术标注事实；41个事件锚点均在原block的Unicode码点范围内。对3后端×12案×6层的216个保存分区逐一检查：配对索引无重复，配对与漏项完整覆盖金标索引，配对与多项完整覆盖候选索引，配对事件ID与金标和保存的对齐记录一致。由这些数组重新计算TP/FP/FN和precision/recall/F1，结果与report/comparison一致。**这是保存配对分区的独立重数，不是再次运行语义匹配或逐案重新认定原文事实。**

下表均为 TP/FP/FN；每个后端、每层的TP+FN均为43。

| 后端 | raw basic | accepted basic | raw relational | accepted relational | raw strict | accepted strict |
|---|---|---|---|---|---|---|
| rules | 2/0/41 | 2/0/41 | 0/2/43 | 0/2/43 | 0/2/43 | 0/2/43 |
| qwen | 16/47/27 | 16/35/27 | 10/53/33 | 10/41/33 | 8/55/35 | 8/43/35 |
| deepseek | 34/17/9 | 34/17/9 | 27/24/16 | 27/24/16 | 25/26/18 | 25/26/18 |

rules、Qwen、DeepSeek三份report均与v22逐字相同；所有配对分区、六层指标、生产防御记录以及comparison.models均未变化。本版沿用原始模型输出作后验复评，没有新推理、重采样或训练，不称为新实验。

原始候选合计116，accepted104，rejected12。46条accepted money仍为21 exact、23 approximate、2 unsupported，21条派生amount非null；46条全部保留source_relation_unresolved，0条“精确且无复核issue”。已在先前版本恢复的Qwen年假工资804.60及少1条context mismatch，本版相对v22没有变化。relation warning包括保守防御，并不能据此称全部模型表述都错；accepted和exact也不等于关系已验收或可直接计算。报告中的calculation_authorized固定false仅作诊断，本次没有验证UI确认或实际计算授权。

新v22只读桥、归档恢复器与v23控制器已静读：只允许exact v22 --check，沿用同一900000毫秒绝对预算和每层2000毫秒保留，归档验证先于临时恢复，finally只清理自有目录；v23先历史验证再一次当前compute并绑定85+3。未发现本轻量范围阻塞。MONEY已提供的native7和有界恢复/throw清理证据已按其他复核者证据读取；本次未重复运行。当前package可解析，包含162个唯一mjs入口和2个Python入口，并发2，无合并冲突标记。

主侧执行与本次审计分列：本次只读核对了父native7、write和check收据及原日志摘要；父write退出0，用时164.309秒，父check退出0，用时165.572秒，父记录278保护项不变（与本次387项范围不同）。父取得的本地CI收据记录应用496fb2740593c9c1d4ba95578686310c2caf2798 / run39137932695 SUCCESS；未由本复核者重新查询远端。ROOT完整整合检查在本收据形成时仍运行中，**未写为通过**。

独立实跑记录为 `postfreeze-evidence/round30/v23-light/v23-light-audit.execution.json`，完整明细为同目录 `v23-light-audit.stdout.json`；源脚本 `v23-independent-report-check-final.py` SHA256为 `f5f1748c31fed01935f6562145408d3113ab3363ad5a01cccb75e16e0f145a59`。准备草稿在执行前静读发现input层级取值不对，已保留草稿并仅在另存final中修正；没有将该未执行草稿记成产品失败。所有新增交付由独立copy-index列出，旧ROUND30应用收据及95文件索引不覆盖。

本复核未参与相应产品或评分器实现，请求配置为GPT-6.1 Sol / ultra，实际backend未独立核验。样本与暂定非专家技术标签沿用冻结边界；本报告不构成法律意见、真实案件可用性、人工验收或生产部署证据。
