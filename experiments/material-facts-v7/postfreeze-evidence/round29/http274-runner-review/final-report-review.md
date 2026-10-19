# HTTP274 最终报告只读核对

结论：本次只读核对无阻塞。相同 runner SHA `878f329c…`，剥除唯一 ROUND29 新增块后恢复旧248脚本全部字节，旧断言没有修改。

| 主侧实际运行 | 通过 | 失败 | 合成输出 | 重启快照 | cleanup |
| --- | ---: | ---: | ---: | ---: | --- |
| fixed baa8 最终有效修前 | 253 | 21 | 275 | 252 | PASS |
| e2d6 中间修后 | 273 | 1 | 275 | 272 | PASS |
| source4a6/c600 最终修后 | 274 | 0 | 275 | 273 | PASS |

三份报告的 **275 个 raw 字符串、候选数组、finish_reason 逐项一致**，274 个场景名称与顺序一致。修前已通过的252个非重启场景，其最终观察内容逐项相同；重启场景的快照数增加是新增通过场景进入持久化快照的结果。

本轮26项最终全部通过：3个新前置RMB金额支持且旧unsupported/null不升级；17项不安全金额及人工旧exact在读时降级为null；3个支付日程、3个跨块日程正反控均通过。原 `round19_arithmetic--2000` 修前PASS→中间FAIL→最终PASS，原期望未改。

公共断言检查原始raw、value、quote、representation、码点位置及source SHA；所有新26项回执均记录数据库/raw/history不变。最终273个重启快照核对存储状态/raw/history不被读写迁移，并保持未确认、不可计算。1375次服务调用全部已鉴权，550个完成的临时服务job在持久化后才退役；最终cleanup PASS、failure/interruption为空。

这是非作者HTTP夹具及主侧实际JSON证据的只读复核。本Agent参与相关产品源码实现，故不将此称为自身产品的独立源码审查。没有启动HTTP、build、fullcheck、历史链或模型；没有重新打开已清理SQLite独立重做其断言。重启不宣称逐项重验所有派生金额。本结果不是模型或人工业务验收。

原静态收据、修前253/21、中间273/1、raw及其失败均未改写。详细报告路径、SHA及序列摘要见 `final-report-review.json`，复制索引见 `final-index.json`。
