# v7 第三轮独立技术复核与修正评分补充

第三轮三项P2在修复前均有真实失败，当前限定修复通过独立回归。原始首跑、修正评分第一版、旧POSTRUN和旧独审回执均保留；本文件只补充本轮证据，不替代之前的语义审查结论。

审查者没有实现本轮金额分类、运行时去重或评分封存脚本。新增测试仅使用合成材料；未发模型请求、启动服务、build、训练、提交或推送。请求配置为GPT-6.1 Sol、ultra，无法独立核验实际会话配置。

## 真实红绿与技术边界

独立脚本 scripts/material-facts-v7-round3-independent.test.mjs 共26条：修前12PASS、14FAIL；修后同一预期26PASS。红日志包含当时四份实现哈希，失败均为被测行为，无测试夹具错误。

- 4305746125：重复短quote，或唯一整段quote内重复四万元，均无法唯一定位发生位置。旧实现的null-anchor fallback把两项观察合并为一项；修复后两项均留存，不因相同字段假定同一次付款。raw/accepted均为2个不确定FP，没有猜选事件。
- 4305746130：叙述整段value与最小四万元虽可规范到同数值，但整段不是有限货币包装。旧实现叙述先到时挤掉正确最小值；反序又把坏候选掩盖。两种顺序现在均保留两项，六层均TP1/FP1/FN0。真正唯一的人民币四万元/四万元仍合并成一个accepted观察，raw重复仍计FP。
- 4305746128：这个月、这月、当月、该月、上个月、下个月、上一个月、下一个月及带“的”的完整工资名称，无量化金额时明确拒收。10项期间描述修前均undetermined且accepted，修后均not_monetary；raw原回答逐字保留，raw FP不被消除。工资金额不详、未知口径、另议、范围和外币等6类仍可留待核、amount=null，不以“没有可用精确额”代替“已经证明没有金额”。

额外双顺序检查确认：非重叠且各有唯一quote的同额两次付款仍各自命中两个事件；不同assertion不会被合并；Unicode码点包含emoji的源文不改位置。静态复核确认去重只为唯一发生位置存seen，相同span可合并，非等span只允许既有有限币种前缀/整正终止字/工资名词后缀；非唯一位置不进入fallback去重。金额分类只扩展完整锚定的有限月份描述，金额及遮蔽/未知表达的先行分支未放松。

## 修正第一版封存与第二版门禁

新增 scripts/material-facts-v7-correction-v2-gates.test.mjs 实际11PASS（10子场景与父测试）。只在临时副本中修改：缺/多manifest路径、修改/缺少snapshot、第一版manifest字节变化均在回调前拒绝；第一版report仅多一个换行也会阻断第二版重算；回调成功和抛错均清理自有临时目录；第二版已有输出目录时拒绝覆盖，sentinel字节不变。主树第一版manifest与原raw结果在测试前后哈希一致。

verify-correction-v1仅在自有临时树覆盖24份第一版绑定代码，再执行第一版自身的corrective-assessment --check，明确current_code_claim=false。corrective-assessment-v2先通过该门禁，再核原首跑和当前代码重算，输出独立corrections-v2目录，绑定前版manifest与新增两脚本；--write独占创建，--check核全部5文件集合、字节及重算结果。静态审查未见重投模型或改写原/第一版结果的路径。

## 第二版独立复算

继续使用另写的Python码点枚举、金额比较键和最大一对一匹配，未用assess/verify取得独立计数。accepted集合依赖哈希绑定的实际运行时桥接，这不是第二套独立运行时实现。程序、完整明细和代码哈希在 postfreeze-evidence/round3/ 与 accompanying JSON。

36个“后端×材料”的六层逐案TP/FP/FN、18组汇总P/R/F1均与第二版报告吻合，canonical与协议差异均0。与修正第一版逐案匹配和计数也均无变化。每路仍12份材料、43条暂定非专家事实；未改标签、提示或原始回答，没有新的独立模型首跑。

| 后端与层 | basic TP/FP/FN | relational TP/FP/FN | strict TP/FP/FN |
| --- | --- | --- | --- |
| rules raw/accepted | 2/0/41 | 0/2/43 | 0/2/43 |
| Qwen raw | 16/47/27 | 10/53/33 | 8/55/35 |
| Qwen accepted | 16/35/27 | 10/41/33 | 8/43/35 |
| DeepSeek raw/accepted | 34/17/9 | 27/24/16 | 25/26/18 |

本轮修复在合成反例中生效，没有改变这批已保存回答的得分，不能据此声称模型自然输出已经覆盖这些修复边界。原POSTRUN所述跨事件partial误警、少尾整的运行时保守null、主体/角色/日期/陈述层级与暂定研究分类等限制仍在。accepted、非空amount与计算授权继续分开，不授予真实工资计算、法律事实或生产业务验收。

第二版manifest SHA256：1bb6add63ec732bca31dfe65c50844411e7fba45d0addc45b0f69a11a3175f80。原result-manifest仍为3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee，第一版corrections manifest仍为eb5d86b831a8a6df99b52a02cd062fe977a2a03ed5ef5ef168406c1a10a010de。
