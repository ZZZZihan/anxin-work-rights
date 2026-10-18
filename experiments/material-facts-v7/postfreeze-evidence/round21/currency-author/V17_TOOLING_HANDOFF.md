v17 工具交接（仅准备，未发布）

已从 ROOT 已有归档复制并核对 v16 的67份快照，与 v16 manifest5e229a…全部一致；archive manifest仍为100ed6ba…，没有重抓当前应用或覆盖旧archive。ROOT已具该目录，无需再次覆盖。

新链为：还原v16的67份绑定代码，以新增窄桥只运行 archived corrective-assessment-v16 --check，继承不变v1的900000ms共同绝对预算及每子层2000ms清理余量，再对原输出计算当前版本一次。旧policy与v9–v15桥字节未变，新union为70。v17仍不在旧白名单中；未放宽--write、run或任意脚本。

可复制六文件及SHA-256：

- `experiments/material-facts-v7/historical-v16-execution.mjs`：`1ca2f597c71319bc71706e9b4082eeae384745da62ced84ba4e15e0a9d81e17c`
- `experiments/material-facts-v7/verify-correction-v16.mjs`：`28f55d58b19b8b11a6a5e04490e2aee8ef08d16130413523a767d8330c372630`
- `experiments/material-facts-v7/corrective-assessment-v17.mjs`：`e31fcec9e1f7a3c95780e581b8b103f7542527221cde1b028ddd5ae6f1d3d903`
- `scripts/material-facts-v7-historical-v16-execution.test.mjs`：`9d21cc323455ce20fe672195a75facda2dd01ae9785185fe997adbb58ee86219`
- `scripts/material-facts-v7-correction-v16-gates-independent.test.mjs`：`d9185a9f202e0cc4be979c2113d4183a97d5619b9dc07cabaaabd611109ea1e4`
- `scripts/material-facts-v7-correction-v17-gates-independent.test.mjs`：`1bbc1305cd508a57b4a59749f099a3add7362d076351c64ef6c1bdebc5b91481`

作者实际执行新桥7项原生子进程测试：7 PASS / 0 FAIL；6文件syntax通过，scoped lint exit0。原生夹具测试共享预算、允许目标、嵌套状态、两URL预载、错误透传和临时receipt清理；它们不代表实际完整历史链已执行。本次没有运行converted-v16或new-v17的深层门禁，没有--write v17、模型、构建或HTTP。

v16原current gate字节已先保存snapshot，转换后从archive验证旧绑定。新v17 gate保持两个current CLI各960s外层预算、parent1980s，并在临时副本拒绝manifest空白与currency模块字节漂移；需待主侧正式产物后另行执行。

change_reason涵盖明确普通后缀词、unsupported前置费率及模型subject吞词反控、元年终奖/年假支付用途、Unicode属性词界Node24/26兼容。最终应用具体哈希由主侧定版后绑定，本作者没有生成结果。

package/workflow由主侧处理：保留转换后的v16历史gate，加入新native-v16与current-v17 gate、最终应用tests；CI运行历史verify-v16及正式发布后的current-v17 --check，不在CI中写入v17。全部日志/hash/边界见v17-tooling-handoff.json。
