v24 实际轻量产物独立核对通过，状态为 **LIGHT_ARTIFACT_PASS**。正式 manifest 为 `86560d13902cba7458cae1d5c1b9175c01442c404a4d47bd17305950206e795e`。本次只读 ROOT 已发布文件，没有运行评分器、历史 CLI、实际五门禁、完整检查、HTTP、构建或模型。请求使用 GPT-6.1 Sol / ultra；实际后端配置未独立核验。

独立 Python 检查退出0，用时0.064秒，stderr为空；398份保护文件前后哈希相同。当前91项代码逐文件与 manifest 相同；v23的88项归档逐文件与旧代码 manifest 相同，归档 manifest 为 `ee708f860f36e7daefa543ebbb4cb4f6eff223097848bad0b82aebecd0ec383b`。固定原 freeze、原60个结果文件、v1至v23结果 manifest 及其列举的产物、35份冻结材料与原始失败证据均按原摘要核对，没有覆盖历史。原始材料、暂定参考和三路 raw 输出没有变化。

12份材料每层固定43条非专家暂定参考，共3路×12份×6层=216个分区。本次独立检查每层配对索引的一一性、pairs与missing/extra的互斥完整分区、保存的event ID与暂定参考及保存的alignment对应关系，再从列表重数TP/FP/FN并重算precision/recall/F1，共18组汇总与已保存报告一致。检查了41个参考事件锚点的码点界限。这里核验的是已保存配对的约束和算术，**没有重新裁决源文语义、重跑评分器或把暂定标签当法律结论**。

| 路径 | 层级 | raw TP/FP/FN | accepted TP/FP/FN |
| --- | --- | --- | --- |
| rules | basic | 2/0/41 | 2/0/41 |
| rules | relational | 0/2/43 | 0/2/43 |
| rules | strict | 0/2/43 | 0/2/43 |
| qwen | basic | 16/47/27 | 16/35/27 |
| qwen | relational | 10/53/33 | 10/41/33 |
| qwen | strict | 8/55/35 | 8/43/35 |
| deepseek | basic | 34/17/9 | 34/17/9 |
| deepseek | relational | 27/24/16 | 27/24/16 |
| deepseek | strict | 25/26/18 | 25/26/18 |

三份逐案报告与v23均逐字节相同，完整JSON差异、六层分区差异和金额防护差异均为空。raw/accepted/rejected分别为rules 2/2/0、Qwen 63/51/12、DeepSeek 51/51/0。规则、Qwen、DeepSeek报告摘要依次为 `0553db2f6eb0801c6311021f16ce67268a165cd8198afe66fa4821ee737dbaf7`、`c9c010d4bd857745f52385bc13b4e4d36aa6b715a508f6b1df8f0b5d7e564f38`、`1c782cd8ff265bfb9308562f917bb7ce3f153f949a883078d3b2aabaed0523e3`。没有新推理或新增自然样本。

46条accepted金额候选仍为21 exact、23 approximate、2 unsupported；21条amount非空，46条全部保留`source_relation_unresolved`，没有无review issue的精确金额。与原首跑相比，仅Qwen `mf7-bjkfq-2025-2222` raw C[1] 的“八百零四元六角”在源文终止字“整”保护修复后恢复804.60，并去掉一个`source_amount_context_mismatch`；这是此前v18已有的修正，本次相对v23没有新增变化，仍带关系警告。accepted、exact、非空amount分别是不同字段；报告中的`calculation_authorized=false`是保存的政策常量，不能作为UI或真实后端授权流程已验收的证据。

新三个工具、native合同脚本和当前门禁脚本只作静态复核：只读v23桥、绝对截止继承、88份旧字节恢复、91项当前绑定和原子新目录发布未发现本轮新增阻塞。主侧实际write/check的收据及引用原日志摘要已只读核对：write退出0/181.910秒，check退出0/183.688秒，主侧379份保护字节未变。两项执行由主Agent完成，本复核没有重复执行。独立准备脚本在任何运行前发现一个版本迁移键冲突，另存final修复，prepared及说明保留，没有删改失败或放松固定摘要。

产品改动的独立Node24/26各20项及范围审查，见[ROUND32应用独立回执](ROUND32_APPLICATION_REVIEW_FINAL_INDEPENDENT.md)；本报告不重复执行、不冒称本人完成主侧HTTP或远端CI。当前v24完整整合和最终PR46精确提交CI由主侧另行记录，本回执不将其标为通过；旧v23完整检查不能替代新版本。

这些是小样本、来源集中的后验复评和技术证据。原始失败、后续修复、主侧执行与本次非实现者轻核分别保留；没有人工法律/业务验收，没有完整真实用户确认流程验收，也没有生产部署结论。不能由本次重数推断模型总体能力、真实金额可直接采用或训练已就绪。

详细JSON：[round32-v24-light-review.independent.json](round32-v24-light-review.independent.json)。执行证据、398份前后保护摘要、逐模型计数和全部差异保存在`postfreeze-evidence/round32/v24-light/`；复制清单单独列举每个OWN源路径、ROOT目标、大小和SHA256。
