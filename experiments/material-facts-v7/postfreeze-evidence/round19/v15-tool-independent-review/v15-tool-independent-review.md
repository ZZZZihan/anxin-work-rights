# v15 工具非实现者复核

结论：在本次静态范围和独立执行的 native7 范围内未发现阻塞。复核者 v7_money 未参与这三份 v15 工具的实现；本轮没有把自己的 ROUND19 金额实现自检当作本工具的独审。

根目录为 `anxin-facts-v7-guards`，开始时 HEAD `4fce552507dd32ad3608da9970eb164d223be377`，审阅包含未提交新工具。所有受审文件逐字节哈希、旧 manifest 前后哈希及 native7 日志哈希记录在相邻 JSON。受审字节在本轮前后相同，旧 freeze/result manifest/修正版 v1–v14 manifest 和 v14 archive manifest 前后相同；v14 所有 61 个 snapshot 另逐项匹配原 code binding，实际文件集无多漏。

v15 相比 v14 是最小版本递推：恢复 v14 的 61 依赖到自有临时目录，以新窄桥执行旧 v14 `--check`，再调用一次当前 `computeCorrection(root)`，绑定 v14 manifest 原始字节 SHA，并将新桥、恢复器、v15 控制器三个路径加入前版集合，合计 64。旧 v14 内继续自己的 v13 递归，没有把旧链改成只核摘要或直接跳过。

15 分钟策略未改：不可变 v1 policy、v1 adapter 与旧 v13 bridge 均保持原字节。新桥继承已有 state 或共用进程 registry 的 root start；根绝对 deadline 不重启，每层扣 2000ms 清理预留，以剩余时限传给原生子进程。真正负面退出保留 status/stdout/stderr，caller-owned receipt 不被子桥删除。这里只读核查了该控制关系；未等待真实 15 分钟跑满。

`computeCorrectionV15` 的当前评分调用在源码中只有一次。基础函数先按旧代码核验首跑，再读取原始 `results/holdout-<backend>-1/results.jsonl` 与既有标签；没有重推理、新模型请求或替换首跑报告。旧链为了验证先前各版仍会按原实现重算，因此不把“当前 compute 一次”描述成“整条历史链只评分一次”。

只有 `--write` 分支发布新 `corrections-v15`，沿用原非覆盖发布函数；`--check` 只读比对新 manifest 原始字节、文件集合和重算值。恢复器只在自有 temp 写归档文件，并在 finally 清理，不写旧冻结目录。

## 实际执行

独立运行实现者准备的 `node --test scripts/material-facts-v7-historical-v14-execution.test.mjs`，exit 0，7/7 PASS，约 1.39 秒。日志为 `historical-v14-native7.actual.txt`。7 项覆盖不可变字节、精确只读目标、根 deadline 继承及 options 不变、无效/过期拒绝、两个 policy URL 下的真实原生嵌套及兄弟子进程、无关进程仍受自己的 timeout、失败 status/stdout/stderr、caller receipt 归属。它们是合成 native child 测试，不是真实 archived v14 数据链。

新 v15 gate 与适配旧 v14 gate 已静态审阅，但其中深层 CLI 本轮均未运行。没有运行 fullcheck、完整 HTTP、模型、训练或部署，也没有写出 v15 修正版。主侧后续实际深链和最终 manifest 验证应单列，不以这份 7 项结果替代。

本轮未改 ROOT/CODE 产品、源码、旧冻结或历史结果；仅在 OWN 新增收据、受审字节快照、差异和实际日志。
