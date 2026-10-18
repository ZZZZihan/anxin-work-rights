# ROUND40 精确提交 CI 独立核查

结论：PR45 精确提交 `6d081321b24b9fadd0088d6cc5b6c60e985eda26` 的 [CI 39161803412](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39161803412) 已终态成功，27 个步骤全部通过。该结论限定于此应用提交；不是 PR46/v30 完整整合或人工业务验收。

日志实际 checkout 为合并提交 `b9f1e1b179e3743f60f731623f81273ad8d7bef4`，其父包含精确 head；API head tree、本机 Git tree 与该 checkout tree 都是 `599301cb16f63cd78c36c9172f13dce58a8aa7d6`。91 个当前源文/测试文件与精确提交逐字相同，147 份原始实验结果和 11 个历史 manifest 与既有散列及该提交一致。

下载原始日志 ZIP 后逐步骤读取，实际 Node 为 **24.21.0**：Vitest **1789/46 文件**，运行时 **9720/9720**，材料测试 **68/68**，两组均 **0 失败、0 跳过**。Python 按步骤可见 37、11、68、79、9、11、16 项完成；lint 为 0 error、22 warning。冻结比较步骤均通过，v6 实际使用受控临时树执行原 verify 与 summary，不是拿当前产品源码伪装旧冻结验证。

两份 artifact 原 ZIP 的 SHA 均与 GitHub API digest 和上传原日志一致，11 个 ZIP 条目中包含 9 份 JSON 结果。HTTP 各报告计数为 21、30、8、10、14、4、10、481、17，均通过；cancel/poll/recovery/v7 的 cleanup 都 PASS。

v7 HTTP 为 **481/481 通过、482 份原始输出、480 份重启快照不变**。只剥每份输出顶层 evidenceId/jobId 后，CI、主侧有效修前 467P14F 与修后 481P 的全部原始值、candidate 和 finish_reason 完全相同；旧 464 个观察逐 name 保留，唯一变化是重启核对数 463→480。OCR 17 项通过，实际 OCR 引擎记录仍是 Tesseract 中文与 OCR 规则、model=null；没有把它称为真实模型推理。

最新读取时（2026-10-18T20:19:24.278251+00:00）PR45 head 仍为同一提交，**146 个审查线程全部 resolved，0 未解决**，没有把 outdated 充当已解决。精确 head 与 checkout merge 的 deployment API 都返回 0 记录；这只描述所查两个 SHA，不代表其它 SHA/外部主机。未合并 PR、未部署、未发评论、未改线程、未触发重跑或模型。

本记录由独立读取原日志、下载 ZIP、散列与 JSON 比较产生；主侧本机 fullcheck/HTTP 的运行不冒称由本 Agent 执行。先前失败证据 107 项重新散列未变。请求配置为 GPT-6.1 Sol / ultra，实际服务后端未独立核验。
