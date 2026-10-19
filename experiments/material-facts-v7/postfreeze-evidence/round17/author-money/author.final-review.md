ROUND17 作者范围已完成并锁定。固定基线为 CODE `eb867361742bff21f9d724fb4b212afbe6123c6d`，只修改两个授权生产文件。金额 full literal 与完整 quote 使用主 Agent 提供的共享元/圆普通词守护；明确无金额工资语法只加入“本期”和“拖欠／欠付／未付”；唯一位置嵌套去重只补充“人民幣”有限拼写。currency/source 的完整词界和 scorer alignment 由主 Agent 实现，不计作本作者实现。

最终同一份 125 项作者测试：固定 eb 两产品与原依赖为19通过、106失败；覆盖本作者两产品和主侧 currency/source/assess 最终依赖后125全部通过。已有 money485项与runtime47项合计532项也通过，范围ESLint退出0。六层评分测试覆盖金额缺失 rawFP 与 accepted拒收、单发生位置传统包装两顺序、两次同额事件均保留并对齐。原文、representation、Unicode code-point位置及历史状态不改写均有实际断言。真实金额“元工资／元整／元角分／元人民币／元/月／元组装费”及未知、遮盖、概数、区间保持既有边界。

最初历史测试误用常量3.00与scorer字段读取路径错误已修正，原始日志保留且明确不算产品失败证据。最终 fixed-eb-before-red 用相同最终测试重跑，不含这些 harness 错误。

这不是项目全检、真实HTTP、模型表现、法律准确性或业务人工验收。没有模型调用／训练／部署，也没有提交、推送、修改 CODE 或旧冻结材料。

- `lib/material-money-v4.ts` SHA256 `638ce714a35886481731c6c1bfd58e8887597b6d15940c3c3ed0ef7b7fecee8f`

- `lib/material-fact-runtime-ingest.ts` SHA256 `93b6b213871eb3fd8d98fd3f3eb1bd735190746438b96bbf69e9c745971296ea`

- `scripts/material-facts-v7-round17-money-author.test.mjs` SHA256 `29c5f472ae47aed86e6c74acc022fb0c644c02d1b1cdbadcc3dd912b70eb0748`
