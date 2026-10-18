# e99 精确提交 CI 独立核对

结论：CI 检查点通过，应用仍因新增审查问题阻塞。该结论绑定 PR45 提交 `e99df1d3061f60b07fd9fa3e0df39f896f97f695` 和运行 [39150212806](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39150212806)，不表示 PR 已完成、已合并、已部署或获得人工业务验收。

实际 checkout 为 PR 合并提交 `a3191b454ee975233238aaf1635565ba5719b272`，其 tree 与 head tree `626f19f8cb9931a31ad111e3701872d76e60e7ef` 相同。27 个步骤全部 success。Ubuntu 24.04.5 / Node 24.21.0 上，Vitest 为 1789/46 文件，runtime 为 8667 通过、0 失败、0 跳过，materials 为 68 通过、0 跳过；检查中的 Python 组为 9、11、16。主侧本机结果为 runtime 8666 通过加 1 跳过、materials 67 通过加 1 跳过，平台差异分别保留，没有合并成同一计数。

已保存原始日志 ZIP、完整步骤日志、两份 artifact 原 ZIP 和全部 11 个成员文件。两 ZIP 的 SHA-256 同时匹配 GitHub API digest 与上传日志。九份 JSON 报告分别为基础 HTTP 21、合成 HTTP 30、production 8、facts 10、cancel 14、poll 4、recovery 10、v7 388、OCR 17，均通过；具备 cleanup 字段的报告均为 PASS。v7 的 389 条 raw/candidates/finish_reason，在仅移除临时 evidenceId/jobId 后与主侧本机最终报告逐项相同；387 份重启 raw/history 快照保持不变。这是远端原报告复核，不表述为本人重跑 HTTP。OCR 为 Linux Tesseract 与规则对合成 PNG/PDF 的观察，不是视觉模型或真实案件验收。

冻结检查实际覆盖 v4 原实验与 replication、v5 verify/summary，以及 v6 新兼容入口在自有临时目录执行原 verify/summary。v5/v6 manifest 日志摘要与本机原文件相同；没有新推理。v6 历史复核不代表当前产品验收，PR45 CI 也不等于另一个 PR46 版本链全套验证。

GitHub API 在精确 head 和 checkout merge 下均未返回 deployment；这仅说明没有相应 GitHub deployment 记录，不排除外部系统行为。CheckRuns 为成功；旧 combined-status 没有记录，不能把其 pending 空状态误报为运行尚未结束。

17:42:56 UTC 的审查快照为 125 个线程、14 个未解决，包含已过时但尚未 resolve 的旧线程、ROUND36 两项和新到的五条评论。`outdated` 不等于已解决。绿色 CI 是 e99 检查点证据，不能覆盖新增边界问题。

初次本地审计脚本把报告的整数 passed 当成布尔值，失败记录已保留；修正报告解析后退出 0。该错误属于审计脚本假设，不计为产品或远端 CI 失败。请求配置沿用 GPT-6.1 Sol / ultra，实际 backend 未独立核验。完整 JSON、原 ZIP、API 及文件摘要见本目录 copy-index。
