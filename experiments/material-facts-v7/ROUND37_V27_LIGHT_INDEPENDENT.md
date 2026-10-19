v27 有限 LIGHT 核对通过。实际产物 manifest 为 `37d4f9ae5f64d1dfe97d21a30a0a1d3f7ab4d7df0efa338e2a5f326b0a7cb49e`。本人是金额/算式模块与 v27 工具准备作者，未参与标签及评分器实现；本报告独立于评分器/标签实施，不宣称对整个应用独立。

主侧实际 write 退出 0，耗时 288.810 秒；check 退出 0，耗时 290.874 秒。本人只读核对两份实际回执与其日志摘要，没有再次执行这些命令。

12 个 holdout 案例、43 条 provisional gold、41 个事件锚点索引边界一致。按已保存的 pairs/missing/extra 重新检查六层不相交覆盖分区，共 216 个案例层分区、18 组 TP/FP/FN 与 precision/recall/F1；每个匹配的事件 ID 与已保存 event_alignment 一致。这是已有匹配结果的计数核对，不是重新进行语义评分或专家标注复核。

100 份当前代码、97 份 v26 归档代码、60 份原始实验结果摘要全部匹配。本人保护集共 1948 个路径，核对前后完全相同；包含主侧预先记录的 1726 个受保护路径，均匹配旧摘要。冻结输入、标签、原始输出、旧修正报告与旧代码归档未改写。

实际三路汇总：

| 路线 | raw | accepted | rejected | 接收金额 | 精确 / 概数 / unsupported | basic / relational / strict accepted F1 |
|---|---:|---:|---:|---:|---|---|
| 规则 | 2 | 2 | 0 | 2 | 2 / 0 / 0 | 8.89% / 0 / 0 |
| Qwen | 63 | 51 | 12 | 21 | 9 / 10 / 2 | 34.04% / 21.28% / 17.02% |
| DeepSeek | 51 | 51 | 0 | 23 | 10 / 13 / 0 | 72.34% / 57.45% / 53.19% |

合计 116 raw = 104 accepted + 12 rejected。46 条被接收金额中，21 exact、23 approximate、2 unsupported；21 条 amount 非空。46 条全有 `source_relation_unresolved`，`exact_money_without_review_issue` 为 0。`calculation_authorized=false` 是报告的保守常量，不代表本人实际验收了生产确认/计算流程，也不能把 exact 解释成可直接使用。

三份 report 与 v26 逐字相同；18 组指标、分区和 production_defense 差异均为 0。一次首跑的原始输出仍未变化，没有新投模型。本轮没有新增此前已有的 804.60 单项修正收益，不把重复后验复评称为新独立实验。

首次 LIGHT 调用在本人准备脚本的旧 schema 断言处 failclosed：manifest/26、archive/25、comparison/26 未更新为 27/26/27。它尚未进入分区重计，1948 个保护路径仍前后相同。原 stdout/stderr/execution 和脚本全部保留；仅在新 `final/` 目录修正三处断言后完成实际 PASS。此项是审计脚本适配错误，不是 v27 产物失败，亦不写成首次检查通过。

请求配置为 GPT-6.1 Sol / ultra，实际 backend 未独立核验。本次没有导入评分器、执行历史 CLI、模型、HTTP、build 或完整项目检查；不替代真实业务、法律专家或用户人工验收。重复信号夹具复核另有独立收据，不将其本机目标通过代替最终远端 CI。
