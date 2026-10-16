# 公开数据检索基线

由 `npm run eval:retrieval` 生成；`npm run eval:check` 重新运行产品检索器并逐字核对报告。

数据指纹：`94593cc65bc34e1d739f22b6a66c95e19ff768e083f435bada899fc86309ac8e`

题集 SHA-256：`8f246287cc124d0d2da8007f84fd0d6bb8a2a5031c88a03cd0cea0fdadf027c0`

人工题面由 Agent 根据公开原文编写，尚未经过法律专业人员复核。所有分数都是初始检索观测，不能视为法律准确率。

检索只接收 query 和统一的 limit=6，与当前 HTTP 入口一致；人工标注 topic 仅用于分组统计，不用于过滤或排序。

| 范围 | 题数 | Hit@6 | MRR@6 | 已标注记录召回@6 | 域外空返回 |
| --- | ---: | --- | ---: | --- | --- |
| 全部 | 128 | 46/118 (39.0%) | 0.216525 | 46/131 (35.1%) | 8/10 (80.0%) |
| dev | 88 | 29/82 (35.4%) | 0.179675 | 29/92 (31.5%) | 6/6 (100.0%) |
| test | 40 | 17/36 (47.2%) | 0.300463 | 17/39 (43.6%) | 2/4 (50.0%) |
| case_retrieval | 94 | 34/94 (36.2%) | 0.224823 | 34/94 (36.2%) | — |
| no_answer | 10 | — | — | — | 8/10 (80.0%) |
| provision_retrieval | 24 | 12/24 (50.0%) | 0.184028 | 12/37 (32.4%) | — |

Hit@6 和 MRR@6 的分母只包含有相关记录标注的题；域外题单独统计。召回率是对有限已标注目标的微平均，不是对全部相关文档的召回率。

原始引用结构校验通过 4632 次（按每题每条返回引用计，包含重复使用的段落）。它只验证来源与原文一致，不代表论证正确。

每题完整结果、分母、数据与实现哈希见 `baseline.json`。案例和法规整组划分可防止同组改写题跨集合，但语料仍可被检索，不能称为对未见法律知识的泛化评测。

## 待改进样本

以下样本保留失败事实。没有穷尽标注的其他返回记录可能同样相关，不能一律视为误检。

- labor-eval-case-01-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-01-03 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-01-04 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-02-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-02-04 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-03-04 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-04-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-04-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-04-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-04-04 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-09-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-09-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-09-04 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-10-04 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-11-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-12-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-12-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-12-04 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-13-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-13-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-13-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-13-04 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-14-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-14-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-14-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-14-04 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-01-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-02-03 (test): missed_some_annotated_records; 首个标注目标名次 6
- labor-eval-provision-03-01 (dev): missed_some_annotated_records; 首个标注目标名次 2
- labor-eval-provision-03-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-04-02 (test): missed_some_annotated_records; 首个标注目标名次 4
- labor-eval-provision-04-03 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-05-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-06-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-06-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-06-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-07-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-07-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-08-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-08-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-provision-08-03 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-no-answer-02-01 (test): unexpected_results; 首个标注目标名次 未进入前6
- labor-eval-no-answer-02-02 (test): unexpected_results; 首个标注目标名次 未进入前6
- labor-eval-case-15-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-16-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-16-02 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-17-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-17-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-18-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-18-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-19-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-19-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-20-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-20-02 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-21-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-21-02 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-22-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-22-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-23-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-23-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-24-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-24-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-25-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-25-02 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-26-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-26-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-27-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-27-02 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-28-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-28-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-29-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-30-01 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-31-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-31-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-32-02 (test): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-33-01 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
- labor-eval-case-33-02 (dev): missed_all_annotated_records; 首个标注目标名次 未进入前6
