# v34 数据Agent只读 LIGHT 核对

结论：**本限定范围 PASS**。正式 manifest 为 `971396f01fe7c8ec9c6457dec36de3097b8f45c1749a1389d87c13ec97e5359e`。本次保存 JSON/字节审计首次执行 exit0，0.881秒；没有调用评分实现、历史 CLI、模型或应用测试。

核对结果：

- **122 当前代码 / 119 份 v33 归档**逐摘要一致；原 freeze 的124绑定通过完整36代码 snapshot与88未变路径还原核验，原60结果绑定全部一致，旧32与完整36档均保留。
- 重新枚举全部 **34个 correction 目录、33个 code archive**并核 manifest 与实际文件集合。前轮 **2604份不可变路径未变**，本次 **2866份读取路径**前后稳定；38份 verification 文件、3份顶层 checkpoint 也纳入。持续追加的全部 postfreeze-evidence 诊断目录不进入稳定性快照。
- **12留出案、43事实、41事件anchor**；开发3案13事实，15案族互不重叠。来源为7个官方网页，其中2页跨开发/留出；这是案族划分，不是网页隔离。标签仍为非专家暂定标注。
- **216份保存分区、18个汇总指标**按已保存 pairs/extra/missing 核算，一对一、互斥穷尽和已声明事件编号一致；没有重新决定语义匹配。
- 三路 report 均与v33 **逐字节相同**；comparison只改变 schema、previous manifest、change_reason 三处元数据，models完全相同。这不是新模型首跑，也不是模型质量改善。
- 保存候选 **116 raw / 104 accepted / 12 rejected**；36系统输出 = 24模型响应 + 12规则输出，仍是原一次留出输出。
- 46个接受金额为 **19 exact / 25 approximate / 2 unsupported**，19非空、27空；46均有 source_relation_unresolved，0个无issue的精确金额。没有自动计算授权或人工业务验收。

| 系统 | raw / accepted / rejected | raw basic F1 | accepted basic F1 | raw relational F1 | accepted relational F1 | raw strict F1 | accepted strict F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| rules | 2/2/0 | 0.088888889 | 0.088888889 | 0.000000000 | 0.000000000 | 0.000000000 | 0.000000000 |
| qwen | 63/51/12 | 0.301886792 | 0.340425532 | 0.188679245 | 0.212765957 | 0.150943396 | 0.170212766 |
| deepseek | 51/51/0 | 0.723404255 | 0.723404255 | 0.574468085 | 0.574468085 | 0.531914894 | 0.531914894 |

父侧实际 write 回执保存为只读引用：exit0，163.974000秒；DATA未执行该命令。本回执不提前宣称父侧并行 --check 或完整npm检查通过。

角色边界：DATA参与过部分数据/运行防护实现，包括R43 run，但未实现本轮v34版本生成或评分代码。本次称“数据Agent只读LIGHT核算”，不称标签独审、自己的run实现独审或人工业务验收。请求模型配置为GPT-6.1 Sol/ultra，实际后端未独立核实。

仅复制 copy-index.json 所列证据；审计recipe复制目标使用 `.py.snapshot`，不将证据代码变成新的活跃产品入口。ROOT/CODE/冻结数据均无写入。
