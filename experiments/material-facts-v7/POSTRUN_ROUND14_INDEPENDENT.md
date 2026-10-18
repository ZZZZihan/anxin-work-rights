本轮独立复核在两个清理问题及相邻 poll/recovery 脚本范围内未发现剩余阻塞。复核者没有参与共享清理 helper 或四个 HTTP runner 的实现，只新增独立测试和证据。本结论不扩展为整份 PR、模型语义、法律准确性或生产部署验收。

旧基线准确为 CODE `92ba4dd615eb3b5a43508902e3e217b96ea6df9c`。相同的最终独立脚本在 Linux 上得到 1 通过、4 失败、5 项新 helper 探针不适用而跳过；macOS 为 1 通过、3 失败、6 跳过。cancel、poll、recovery 的旧停止函数确实已返回，但重定向 stdio 且忽略 TERM 的真实后代仍监听端口，不能重新绑定。v7 的 Linux 反例则已释放端口且可以重绑，只因真实僵尸进程让 `kill(-pgid,0)` 成功而误报失败；重复停止也误报。故障日志保持原样。

最终源码在 Linux 原生运行 10/10 通过（44.887 秒），macOS 9 通过、仅跳过 Linux 僵尸项（29.850 秒）。四个 runner 均覆盖真实后代 socket 释放与重绑、无关进程组继续工作、重复停止。Linux 测试使用本次 Python 进程局部的 subreaper，暂缓收割以保留真正 `Z` 状态，测试结束后收割全部本次后代；没有改 PID1、启动 Docker 或改变系统服务。被保留的僵尸来自本次 subreaper，不冒称已在原 CI 容器 PID1 下重现；内核 Z/kill0/socket 行为是实测证据。

附加探针检查合法 `pgid=0` 行，以及 ps 查询空结果、坏行、查询异常。后三种情况均保留失败，同时仍对自有组发出强杀，socket 随后关闭、可重绑，无关组未受影响。受控 Windows 分支在 POSIX 上以忽略 TERM 的直接子进程测试，56/63 毫秒内完成强杀；这不代表原生 Windows 或 Windows 后代树验收。

源码审查确认四个脚本的 Worker/迁移启动均使用共享拥有关系登记，停止时同时要求 leader close 和无存活的非 Z/X 组成员。信号只发送给该 helper 创建的 child 对应进程组；未知归属不被接受。每次 ps 查询限 1 秒，并另有 500 毫秒 close 余量，因此每个停止阶段可超出其轮询期限一次有限查询，不能表述成严格 5 秒硬截止。查询失败不作为清理成功，会尝试强杀并保留失败。迁移原始失败与清理失败分别记录，阻止继续启动；任何已记录 stop_worker/stop_migration 失败保留临时资源，后续重试成功也不抹掉先前失败记录。静态审查覆盖这些报告/保留边界，未另外注入完整 Worker 迁移错误。

主 Agent 另执行了四份真实 HTTP 报告。本复核者只读核对到 v7 74、cancel 14、poll 4、recovery 10 项全部通过且 cleanup PASS，报告各自哈希写入收据；没有把它们算作本人的运行。主侧完整检查和 v11 只读复验在最后明确通知时尚在执行，最终整合终态由主侧另存证据。

本轮五个改动文件和独立测试均不在 v11 的 52 条 code_sha256 中；52 条当前绑定均匹配，原 60 份结果文件逐一匹配原清单。freeze、原 result-manifest 及 corrections v1 至 v11 的清单哈希均与既有记录一致。v11 manifest 仍为 `42f13c238e7f88c044de27c858327b92ffd20a576970c836b1a52654421b1345`，原 result-manifest 仍为 `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee`。本轮不生成 v12、不重算成绩、不新增模型请求。

独立脚本为 `scripts/material-facts-http-round14-independent.test.mjs`，SHA-256 `3762bc1b93c1d2d37a6ea12735e6883f11c162d4fb6feb6e9f69a5a407736341`。源码检查与限定 ESLint 通过。完整原始证据、源码哈希、Linux 临时目录清理回执由 OWN `postfreeze-evidence/round14/evidence-index.json` 绑定；复制时必须以该索引逐字节核对。测试只控制本次创建的进程组，不涵盖主动逃离该组的进程，也不保证 harness 被不可捕获信号终止后的清理。请求配置为 GPT-6.1 Sol ultra，无法独立核验实际后端。
