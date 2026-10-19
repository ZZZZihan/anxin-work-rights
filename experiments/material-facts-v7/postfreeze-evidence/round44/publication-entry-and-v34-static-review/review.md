# R44 正式输出入口与 v34 准备静态复核

基线为 ROOT `60ac605ab28a1b2e4f9a179d841c632b91343136`。本次仅只读源码、调用点、已保存 manifest 与字节摘要；未运行测试、评分、历史 CLI 或模型。DATA 曾实现 R43 run 修复，本回执不将其称为自己源码的非实现者复核；v34 工具未参与实现。

## 入口核查

| 入口 | 正式输出/类别 | 精确定位与结论 |
|---|---|---|
| summarize | comparison.json | 60ac 的 summarize.mjs:70–81（77）直接最终路径 wx；锁不解决部分写占正式名。这是本轮已分派 P2。核查期间工作树已接 helper，摘要见 JSON，行为由另一 Agent 验证。 |
| assess CLI | 参数指定 report.json | assess.mjs:201–210（207），同生命周期锁内调用 stage+sync+link helper。 |
| verify full | result-manifest.json | verify.mjs:214–220、263–272（270），完整验证持锁后发布；preflight 不发布。 |
| freeze | freeze.json | freeze.mjs:267–305，独有同级 stage/write/sync/close/link；失败 stage/记录保留，发布后清理失败不回滚正式结果。 |
| corrective v1–33 | 五文件 correction 目录 | 全33控制器共用 publish-artifacts.mjs:15–47；全部内容先写 sibling stage，随后 rename 完整非空目录。 |
| run | 活跃 attempt checkpoint/journals | run.mjs:102–110 的 outcome 是故意可更新 checkpoint，stage→rename；其它协议/raw/日志在独占 attempt 和整段锁中写入，最终不可变 manifest 由 verify 发布。 |
| historical wrappers/bridges/lock | 临时恢复、执行收据、锁元数据 | writeFile 目标为 owned temp tree 或临时 policy receipt/锁 owner；不是正式冻结输出。 |

对基线顶层100份 mjs 的写入/追加/stream/copy 调用枚举，未发现第二处可证的同类“正式最终单文件直接 wx”缺口。该结论不等于所有 I/O 故障行为均已动态验证，也不声称断电耐久。

## v34 准备接线

- 原 v33 manifest `00a764…` 的119份代码逐份核哈希；新 archive 恰为119 snapshot + manifest，archive manifest `72b472b0…`。
- 新三模块与旧119并集为122；immutable helper 已在旧绑定中，重复列入不新增第123项。
- 新 bridge/wrapper 为32→33纯版本递推；26份旧 policy/adapter/bridge 与60ac逐字一致，900000ms绝对预算与每层2000ms保留。
- 当前/历史两 gate 的 `/34`、`/33` schema、previous manifest、122/119、只读/未来版本拒绝和实际 CLI 负断言静读一致；未执行 gate，未将 native 既有通过冒充 gate 通过。
- package 此次观察257个 mjs，无重复/缺路径；保留两Python前置与 concurrency=2，旧脚本未删除，只新增 native33/current34。CI保留更早历史命令，将 current33 改为 verify33 + current34。
- 此为准备态静审；不预先宣称 v34 write/check/指标或本轮 summary 作者/独立测试最终注册完成。

精确文件 SHA、全部定位、范围差异及未执行项见 `review.receipt.json`。未改 ROOT/CODE/OWN 源文件、冻结材料、gold 或结果。
