父任务登记建议（本文件仅建议，package/CI 未改）

1. 在既有 mjs 列表保留已转换的 scripts/material-facts-v7-correction-v25-gates-independent.test.mjs，并追加：
   scripts/material-facts-v7-historical-v25-execution.test.mjs
   scripts/material-facts-v7-correction-v26-gates-independent.test.mjs
2. 历史 v25 CLI：node experiments/material-facts-v7/verify-correction-v25.mjs
3. 当前 v26 CLI：node experiments/material-facts-v7/corrective-assessment-v26.mjs --check
4. CI 当前历史/当前组合从 verify24/current25 递推为 verify25/current26；保留所有旧门禁与原始证据。
5. 冻结前由主 Agent 在最终应用+评分实现整合后执行 v26 --write，再执行实际 --check 与适用门禁；本次没有生成 corrections-v26。
6. 新版本当前 code union = 已冻结 v25 的94路径 + verify-correction-v25.mjs + historical-v25-execution.mjs + corrective-assessment-v26.mjs = 97。新 tests 不属于这97代码依赖。
7. 单个顶层历史链共享900000ms绝对预算，各层预留2000ms清理；门禁两个串行原生 current26 children各outer960000ms，测试总outer1980000ms。不扩大 immutable v1 白名单，不重置嵌套预算。
