v29 只读 LIGHT 已实际通过。绑定 manifest `d66b3c2ccb1897c08168fc16372d2aafc35ca75d3ced64debbe5fa6fd536c74c`。这次只读取已存 JSON 和字节，不运行评分CLI、历史链、模型、HTTP、构建或全检查。

核对原freeze124（36份代码归档+88条未变原路径）、原始60个结果文件、父侧prewrite1967路径、当前106绑定和v28归档103；本次共读取并前后保护2214路径，全部一致。输入/临时非专家标签及原首答保持原字节。

重新计数得到12案、43个gold事实、41处事件anchor，216个已存一对一评分分区与18项聚合指标均算术一致。只校验已存pair声明的event与金标event相符，没有另行做语义匹配或专家标注验收。

36份系统输出=24模型响应+12规则输出；候选共116，accepted104，rejected12。规则2/2/0、Qwen63/51/12、DeepSeek51/51/0。46个已接受金额=19 exact、25 approximate、2 unsupported；全部46仍有source_relation_unresolved，exact且无核对issue为0。精确数值不等于可计算或人工确认。

逐字段比较的实际结论：三份v29 report均与v28逐字节相同，comparison.models无字段变化。以下六层顺序为raw_basic、raw_relational、raw_strict、accepted_basic、accepted_relational、accepted_strict；每项为TP/FP/FN：

- rules：2/0/41；0/2/43；0/2/43；2/0/41；0/2/43；0/2/43。
- qwen：16/47/27；10/53/33；8/55/35；16/35/27；10/41/33；8/43/35。
- deepseek：34/17/9；27/24/16；25/26/18；34/17/9；27/24/16；25/26/18。

这是对同一次原始输出的事后处理/复评保存物进行独立算术和保全核对，不能据此称模型重新测试或业务能力提升。数据作者参与本项目，角色限制明确；来源/标注非专家、仅小样本案例隔离、原网页依赖等局限未因LIGHT通过而消失。

收据与日志见本目录final-review.receipt.json、audit.receipt.json、execution.json、protected.before/after.json及v28-to-v29.field-differences.json。执行脚本与可信基线原样留为snapshot，不把未执行prepared目录复制成验收结果。
