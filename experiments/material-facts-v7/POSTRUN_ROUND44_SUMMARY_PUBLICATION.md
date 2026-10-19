# ROUND44：汇总结果的不可覆盖原子发布

PR46 普通评论 [6258861046](https://github.com/ZZZZihan/anxin-work-rights/pull/46#issuecomment-6258861046)指出 summary 发布入口仍直接 `writeFile(..., {flag: 'wx'})`。固定旧提交为 `60ac605ab28a1b2e4f9a179d841c632b91343136`；共享锁能阻止并发，却不能防止部分写失败占住正式 `comparison.json`。本轮只改变汇总文件的发布方式，聚合内容、标准输出、只读检查及锁边界不变。

真实 CLI 配合原生文件大小限制复现：作者512字节、非实现者2048字节两组故障均使旧版留下无法解析的正式文件，下一次实际重试因 EEXIST 退出。修后使用现有 `publishImmutableFile`，完整写入、同步和关闭同目录临时文件后再以不可覆盖链接发布；写入失败保留临时文件，正式目标仍不存在。解除故障后重试成功，原失败临时字节仍保留。已存在文件、目录和符号链接拒绝；发布已成功但清理失败时明确记录警告，不回滚或误报正式结果。

作者同11项旧版6通过5失败→Node24.22/26.11各11通过；其中5个失败是同一发布合同的不同观察，不是5个独立漏洞。非实现者另同4项旧版3通过1失败→两Node各4通过。用例实际运行 CLI 和文件系统，报告内容是合成夹具，不调用评分、历史链或模型。主侧整合同作者及原锁检查19项、独立4项通过，局部lint无错误或警告。证据分别保存在 [作者原件](postfreeze-evidence/round44/summary-publication-author/)、[独立原件](postfreeze-evidence/round44/summary-publication-independent/)和主侧整合回执中。

对固定60ac版本顶层100份实验模块的正式发布入口另做只读核查：assess、verify 已通过共享单文件发布工具；freeze 有独立的完整临时文件与链接发布；33个修正控制器经完整临时目录发布。未发现第二处可证的同类正式单文件裸写缺口。run 的可变检查点、独占 attempt 内原始记录、锁元数据及诊断记录另行区分。这是有限源码核查，不宣称所有 I/O 路径、硬件断电耐久或人工业务验收通过，见[入口和接线核查](postfreeze-evidence/round44/publication-entry-and-v34-static-review/review.md)。

[CI39193050791](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39193050791)因上述新有效问题主动取消，运行终态更新时间2026-10-19 03:23:49Z，详见[取消检查点](postfreeze-evidence/round44/cancelled-60ac-ci/CI_60AC_CANCELLED_INDEPENDENT.md)。前11步成功，历史核验步骤中止；完整工程检查、OCR和HTTP未执行，均不计通过。已完成的本地v33检查和失败记录保留，不能替代本轮最终整合检查。

修改前逐摘要归档v33的119份代码，随后v34绑定122份当前代码并对同一首次输出另存复评；原v1–v33、标签、原模型回答与失败不改写。没有新模型调用、训练、PR合并或生产部署。实际write/check、完整工程检查、HTTP与最终远端CI分别记录在技术验收文档。

本轮完整 `npm run check` 实际退出0，用时4265.285秒：Vitest1789项/46文件通过，材料67通过/1项Linux OCR平台跳过，运行时10372通过/1项Linux保留僵尸进程平台跳过（共10373）、0失败；Python9/11/16项通过，类型、构建和数据检查通过。完整lint为30警告/0错误，本轮变动源码与测试定向lint为0/0。完整原始日志与摘要已保存。隔离HTTP481项通过（38.788秒），482份合成输出、480份重启快照与cleanup通过；原122份代码绑定、60份原结果及与v33一致的三路报告再次逐摘要核对。见[最终本地整合收据](postfreeze-evidence/round44/root-integration/final-local.receipt.json)。新提交的远端CI尚待执行。
