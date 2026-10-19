仅据主 Agent 已运行的 HTTP 报告和锁定夹具进行只读复核，未发现本次夹具或报告的阻塞性不一致。本人参与 event 实现，因此此处只称非 HTTP 作者的夹具/证据复核，不称本人产品的独立源码审查。

- 当前 runner 与锁定 snapshot 同 SHA `4e5125e91638921849c5f691d352e0b9e0cfbaa72f1fdc202dcd768aa163b59d`。移除 ROUND31 的 4084 字节新增块后，逐字还原旧 HTTP310 runner（SHA `d9a38da7a062b6c78c94b2c32abb1ccb158fd90a655efccb987f9a91cbb29627`）。
- 同一 322 场景实测报告为修前 316P/6F、修后 322P；cleanup 均 PASS。前后 323 份 raw/candidates/finish_reason 按序完全一致；仅运行产生的 evidenceId/jobId 不作相同要求。删去新增 12 份输出后，精确还原旧 311 份输出。旧 309 个非重启观察结果也与旧310最终报告逐项一致。
- 新增 12 场景含日期 4 正/2 负、小时费率 3 正、错误总额角色 1、待定全值/裁剪 2。实际修前真红为 4 个日期正例和 `/小時`、`/時` 两个费率正例；`每小時` 及 5 个负控原本通过，不将其算作新修复的失败。
- 修后 3 个小时费率正例先 fresh exact4000，再将数据库历史值设为 unsupported/null，GET 仍 null，且 revision/state_json/history 未被改写。错误总额及待定两例只核 fresh null 和 GET null，没有强制旧 exact seed，不能宣传为这些新增案例的旧 exact 降级测试。
- 公共断言核 raw 原串、原 candidate 属性、source hash、Unicode 码点 quote 定位，以及未确认时不可计算；本次仅读取代码和 PASS 报告，未亲自重放 D1 或原文块。日期支持只是技术关联提示，不等同业务事实已认证。
- 修前 6 例在首个 fresh 断言即失败，后续 GET/历史/快照代码未执行，不能倒计为修前通过。故实际重启快照为 315→321（旧309 + 本轮6→12），而非两次都覆盖321。重启断言核存储快照/raw/history和未确认状态，不重新逐个断言派生金额/issue。
- 两次均有 1615 条认证服务调用、646 次当前运行后端任务回收，均标明先持久化；323 个 jobs 与323个 fact-jobs。非模型推理，非人工业务验收。

输入 SHA、逐场结果、失败后未执行的具体断言与限制见 JSON。所有原始报告和旧夹具保持不动。本复核没有启动 HTTP、build、fullcheck、历史链或模型。
