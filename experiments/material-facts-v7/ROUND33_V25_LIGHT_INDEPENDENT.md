# ROUND33：v25已发布产物LIGHT独立复核

本次限定范围内通过，未发现产物绑定或报告计数阻塞。复核实际读取ROOT的v25文件，没有执行评分器、历史CLI、controller、HTTP、构建、模型或重型测试，没有修改ROOT/CODE。

复核人是金额模块实现者，未参与评分器或标注实现。因此这是对已发布产物的独立字节/计数复核，不是对自己金额实现的非作者复核，更不是用户业务验收。请求模型配置沿用GPT-6.1 Sol / ultra，实际backend未独立核验。

- v25 manifest：`4eef4eeeba7df54d6f40a67ff4cca3170de8788b1ab9578b45c29d06ed1cb8ca`。
- v24 manifest：`86560d13902cba7458cae1d5c1b9175c01442c404a4d47bd17305950206e795e`。
- 当前94份代码逐项匹配；v24归档91份snapshot与v24绑定逐项一致，目录集合无遗漏。归档manifest：`c744b35909cf57064abc4e4ffd3a613b99be045879d5d9d5959c4f263b3b5528`。
- 首跑60文件、原freeze、v1–v24 manifest/产物及冻结材料/失败证据绑定均吻合。父侧write前1690项保护散列仍匹配；本次扩展保护集合1747项在Python核对前后逐字节不变。
- 12个holdout案例、43条gold、41个anchor span一致。每个anchor的code point边界有效，pairs上的event ID与gold及已保存event alignment一致。
- 对3模型×12案例×6层共216个分区，逐一检查配对/漏报/多报索引覆盖及一对一性；由分区独立重算18项汇总的TP、FP、FN、P/R/F1，与报告和comparison一致。
- 三份v25 report与v24逐字相同；comparison.models相同。这里是在相同首跑输出上复评，未发新请求。

| 模型 | raw/accepted/rejected | accepted basic F1 | accepted relational F1 | accepted strict F1 |
| --- | ---: | ---: | ---: | ---: |
| 规则 | 2 / 2 / 0 | 8.89% | 0% | 0% |
| Qwen | 63 / 51 / 12 | 34.04% | 21.28% | 17.02% |
| DeepSeek | 51 / 51 / 0 | 72.34% | 57.45% | 53.19% |

46条accepted money为21 exact、23 approximate、2 unsupported；全部46条仍有`source_relation_unresolved`。exact且无review issue为0。`calculation_authorized=false`是report保守常量，不能作为实际生产状态确认流程或计算授权已经运行验收的证明。关联警告可能包含可用性误警，本LIGHT不重新判定每条警告的业务语义。

主侧实际执行回执已闭合：write退出0，用时195.9818269169773秒；check退出0，用时198.22624529100722秒。本复核只读校验两份回执及其stdout/stderr散列；stdout均为PASS，stderr中结构化历史执行政策回执均为PASS。复核人没有重跑这两条命令。主侧write/check后回执均记录1690项保护字节不变、94代码绑定匹配、原60匹配、三报告与v24逐字相同。

边界：独立算术核对以报告已有配对为输入，不重新作语义匹配；anchor边界有效不等于法律标注正确。标注仍是非专家provisional；12例和集中来源不足以证明真实案件普适准确率。原始错误、后验修复、CI、HTTP和用户业务验收属于不同证据。本次不声称已完成新的模型对比、业务验收、训练、合并或部署。

完整18项计数、逐模型诊断、主侧回执路径/散列及复核边界见同目录JSON；实际Python标准库脚本、stdout、stderr、执行回执、前后保护散列见`postfreeze-evidence/round33/v25-light/`。
