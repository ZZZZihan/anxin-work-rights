# ROUND18 cancel / poll 中断清理作者证据

只修改两个 HTTP runner 和新增作者测试。源码基线为 CODE `9b4bba2fbc85ccd2a7cd8003a2d4a1f2e0593207`；`owned-http-process-group.mjs` 的作者测试依赖仍为原 `37c86a25…`，作者未改该 helper。原失败日志和旧快照全部保留。

SIGINT/SIGTERM 的处理使用 `process.on` 并首信号幂等，处理器一直保留到 CLI 退出。中断取消请求、启动等待及业务 barrier，释放已建立的 held poll，向本次自有 Worker/迁移进程组发送 TERM，随后仍由 finally 有界等待完整组停止、pending poll 结束和服务关闭。迁移失败与随后清理期间的中断分别记录；中断不会将先前失败替换为成功。若首个信号在报告写入时到达，再写一次包含中断的 FAIL 报告。两脚本的正常 HTTP 业务断言未删改。

作者新增测试直接执行两个完整 CLI（不只提取停止函数），使用合成 Wrangler / material service、一次性 SQLite、真实原生子进程、真实 SIGINT/SIGTERM 和监听端口。每个 runner 四个场景：迁移期间、Worker readiness 期间、首个挂起业务 HTTP 请求期间、迁移已 exit 23 后的 finally 清理期间。后两类在清理过程中重复发送 TERM，并带重定向 stdio、忽略 TERM 的子孙进程。所有场景都有无关组对照。

最终同一测试 SHA `bd1410a7aee1eed46b84e2f0165ad84a6e206903c991b54fc7d32a19f71feb97`：旧版 0 PASS / 8 FAIL，新版中断安全断言 8 PASS / 0 FAIL。旧版八项均观察到 CLI 信号退出后自有 socket 仍开；新版八项均 code 1、signal null、自有 socket 关闭、组内无非 zombie 活进程，无关 socket 存活。

这不是“8 次清理均成功”。原 helper 在本机 macOS 上仍有独立 EPERM 问题：新版四个迁移/readiness 场景的原始报告为 cleanup FAIL，并保留本次临时现场，作者测试明确检查这些失败没有被吞；四个挂起请求/先失败后清理场景为 cleanup PASS。作者测试主要验收信号期间不绕过 finally、资源实际释放、原始失败保留。Linux/最终整合 helper 的清理状态由主侧及非实现者另行验证，不能把这份结果冒充那个结果。

证据：

- `interrupt-author-corrected-fixture-before-red.stdout.log`：最终夹具的真实旧版 0/8。
- `interrupt-author-corrected-fixture-after-green.stdout.log`：最终夹具的新实现 8/8，包含每项 native exit/socket 及 cleanup 状态。
- `interrupt-author-corrected-fixture-execution.json`：执行时间、原始 exit code 与日志 SHA。
- `interrupt-author-static-checks.json`：三文件语法检查和 scoped lint 均退出 0；lint 有环境 React 检测警告，无文件忽略。
- `interrupt-runners.patch`、`interrupt-author-handoff.json`：精确补丁、交接 SHA 与范围。

此前 `interrupt-author-final-after-green.stdout.log` 文件名虽然含 green，实际记录 6 PASS / 2 FAIL、exit 1，必须按内容理解。两条新增迁移失败夹具当时在子孙进程安装 TERM handler 前就退出，未抵达预定中断边界；修正仅给 fixture 增加 ready 握手。该中间失败及其旧脚本日志原样保留，不作为产品回归或最终绿证据。

未执行实际应用 HTTP 全流程、模型调用、重构建、完整 npm check、正式 v14 写入、训练或部署；没有提交或推送。请求模型配置沿用 GPT-6.1 Sol ultra，实际后台配置未独立核验。最终整合验证由主 Agent 执行；非实现者技术复核另列。
