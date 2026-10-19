ROUND18 最终应用范围复核通过，未发现这五项已分配问题范围内的新阻塞。此结论只覆盖下列精确代码；v14 版本链完整性验收另行记录。本人未实现产品修改，未更改任何旧回执、冻结产物或源数据。

最终两份 runner 改为：信号处理只记录中断、中止等待和请求、释放暂停回复；真正的进程组终止统一由 finally 执行。迁移等待、启动探测及请求均已接入同一中止信号，删除即时 TERM 不会留下相应的长时间阻塞。这样也避免信号处理与 finally 重复 TERM 短命进程组。迁移先失败后遇信号时，原失败和 interruption 仍分别保留。

本人按原脚本重新执行的 4 项原样提取/native socket 回归全部通过（21630.094292ms）。两个 runner 各接受 SIGINT、SIGTERM 及清理中的重复信号；每项均确认忽略 TERM 的后代监听关闭、端口可重绑、无关进程仍活、cleanupFailures 为空、退出 code 1。证据来自 macOS 合成 pending-operation harness，未把它表述为完整应用 HTTP 或 Windows/Linux 验收。

- cancel SHA256：`5df94b5d749e700148c6b1ce2aa534e85a84e6c8f7fa05dd4d4c5f79b3b473e2`
- poll SHA256：`045c4b72d1a260c27dbfcd7c6922503f6ff927cc127690da32b269661cee7dde`
- owned helper SHA256：`460130907f28e027bcc15368aac87bf82c7e9b7dfa7c22eefe021895cddd007a`

此前独立 61 项业务回归仍绑定未变的 money/currency/source 精确字节：固定 9b4bba2 基线 29 通过、32 失败，最终 61 通过。4 项信号回归用同一最终脚本在该基线 0 通过、4 失败。前一版双 TERM 的 4 项 pending 回归曾通过；后续作者更广泛的迁移/启动夹具发现重复终止问题，旧日志及旧结论保留，本收据明确绑定修复后的最终 runner。

`四元5角` 从旧 unsupported 迁移为 4.50 符合本轮显式混写文法；独立动态探针还验证裁为 `四元` 仍为 null，非法多位角分、重复单位和零桥未被放行。此前三条混写契约迁移的对应证据保留。

只读核对主侧 HTTP118 的新旧报告：同一 118 场景顺序、119 份合成 raw/candidates/finish_reason 序列一致；旧固定 9b 为 106 通过、12 失败，最终 118 通过，两次 cleanup 均通过。重启比较覆盖 117 份 raw/history/state 快照，并不代表再次断言所有派生金额。本人未启动该 HTTP 服务，未执行整仓 fullcheck 或远端 CI；这些结论与主侧实际执行分开记录。

新 JSON 保存全部精确代码、旧收据链接和证据 hash。证据根为 OWN 仓库根目录下 `postfreeze-evidence/round18/`。accepted、amount 非 null 与计算授权仍分别判断；所有这些合成回归均不构成法律或真实模型业务准确率结论。请求配置 GPT-6.1 Sol ultra，实际运行 backend 未独立核验。
