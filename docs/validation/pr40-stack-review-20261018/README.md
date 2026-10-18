# PR31/36/40 首次整合检查

PR40 `80772b4` 合入 PR36 `090b070` 的工作树：npm run check 通过（855 Vitest、30 Node runtime、54 材料项中53通过/1平台跳过、类型/lint/构建/数据/Python全部成功）。首次检查仅新增测试一处 TypeScript unknown 类型报错，补显式返回类型后完整重跑通过。

三份实际 HTTP 报告分别为事实10组、取消14组、并发poll4组。最初同时启动3个Worker时事实/取消尚未ready就退出（原始失败保留）；单独重跑事实、取消均通过。没有把启动失败算成行为通过，也没有确认其根因。CI按串行运行。

独立Agent静态检查了三个冲突点：source-review/runtime-ingest/response序列化/持久取消均保留；UI单调版本与scopeDirty都保留；31冻结验证和40取消HTTP、36pollHTTP同时保留。新增生产adapter测试确认远端messages没有文件名/材料ID/hash；24001字在D1路由及服务排队前均明确400且不创建任务。

此记录对应首次整合，随后PR36自动审查发现poll短暂失败与提交响应丢失两条P2，合并暂停，后续另行修复与复测。不是最终合并验收，不涉及生产或外部模型调用。
