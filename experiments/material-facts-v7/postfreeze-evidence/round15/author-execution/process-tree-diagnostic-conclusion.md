# ROUND15 原进程组测试 EPERM 只读诊断

结论：两轮原 suite 均 5/5 PASS，未复现 full-check 中的一次 redirected-ignore-term EPERM。不修改 helper、测试或产品代码；不追加第三轮，不把两轮通过写成原失败已解决。

原 full-check 2293 PASS / 1 FAIL / 1 SKIP 的完整日志已另存 code-full-check-process-tree-original-failure.log，SHA 41abcec71444bff621132e4efbe222a5ed03e424fd0d8cb3d690928b8b1c226d；原 CODE 日志未覆盖。helper SHA 为 37c86a25a10bcf666ad9144971627f0b83b31a5d3d3d1e70768f09ca7ba94435，suite SHA 为 7323a90a924f44e7873732e7e5441f20ea3572d885f3897df364835a522df8d9，诊断前后相同。

原失败栈的第一个 EPERM 来自 SIGKILL 后 stoppedBy 内的 ownedGroupAlive → process.kill(-child.pid, 0)；随后 catch 再次对自有组 SIGKILL 也 EPERM，组成 AggregateError。它不是 ps 解析或 query timeout 错误；当前证据也未显示迁移、HTTP 应用或金额代码参与此失败路径。原始日志未记录该次 pgid、成员 pid/stat/uid，无法事后证明它是权限变化、进程组退场竞态或 PID/PGID 复用。

第 1 轮直接跑现有五测试，exit0/5PASS，11.68秒，redirected-ignore-term 5.293秒。第 2 轮同样原测试，另有只读 observer 扫描本测试生成的临时 leaf.json 并查询 pid/ppid/pgid/uid/stat/etime，不注入 helper 或测试、不改信号逻辑：exit0/5PASS，约11.86秒。捕获 5 个自有 leaf 和 1 个独立组对照，均 uid501；结束后这些 PID/PGID 无剩余成员，6 个记录端口均不监听，夹具目录为空。suite 自身也实际验证已停止组无非 zombie 成员、端口可重绑、无关组在目标清理期间仍活着。observer 的结束时无关组也已由测试自身清理，这不表示 helper 误杀它。

本机 macOS27.2 arm64、Node26.11.0、uid501。本机 kill(2) 手册将组信号 EPERM 解释为至少一个成员无法被发送信号；这只是错误类别说明，不是已确定根因。本轮同 uid 的观测只证明本轮夹具身份，不能回填到原失败。进程表共有约1344行，但原错误为 EPERM，没有证据据此归因于负载或资源耗尽。

现不建议把 EPERM 改为 cleanup 成功。若以后再现，最小有用诊断是保留当次动作（signal0/TERM/KILL）、owned leader pid/pgid、调用方 uid/euid，以及该组 pid/ppid/pgid/uid/stat 的有限元数据；不采集 cmd/env。可用这些证据区分权限问题与仅退出成员，再决定是否需改判定顺序。当前无足够证据提出已确认的生产修复或最小稳定复现。没有手工发送任何信号、终止无关进程或启动服务；仅原 suite 自己管理其合成进程。
