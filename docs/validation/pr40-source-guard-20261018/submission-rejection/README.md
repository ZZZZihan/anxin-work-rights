# PR #40：提交明确拒绝与未知回执分离

修复自动审查评论 4305467482。基线是 d845854d0e2a2fc7e3d9a27316d4a7bef40cec0a；隔离树 `/Users/xuzihan/Documents/Projects/国创/anxin-pr40-submit-rejection`，分支 `fix/pr40-submit-rejection-20261018`。只改本任务四文件，未提交、推送、合并或访问生产。

明确的 HTTP 4xx 现在保存为 failed，同一次提取的 UUID 与已经撤销的确认保持不变，现有 route 会返回 HTTP 200 的失败状态。后续 GET 不再轮询不存在的 UUID。HTTP 5xx、网络异常、超时、损坏成功响应仍视为提交结果未知：保留原 UUID 和原有 GET 恢复窗口，不自动再次 POST。

## 文件与安全边界

- `lib/material-service-errors.ts`：独立的 MaterialServiceHttpError(status, message)，避免给已有 mock client 增加新导出要求。
- `lib/material-service-client.ts:16`：先保留 HTTP 状态再处理正文；错误正文不进入用户错误消息。未使用的错误流尽力取消，取消不等待，抛错或拒绝也不覆盖状态。现有本机地址、认证头、redirect 和成功 JSON 语义保持。
- `lib/material-fact-store.ts:249`：仅 typed HTTP 4xx 转 terminal failed，其余失败继续未知回执恢复。后续保存仍用 claimed revision + owner + active case + source generation CAS，晚响应不能覆盖新任务或来源。
- `lib/material-service-client.test.ts`：新增客户端单元回归。

## 实际执行结果

1. 新客户端 41 项测试先在原始产品代码运行：3 passed / 38 failed，exit 1。包括 JSON 429 丢失 status，以及 HTML/坏 JSON 4xx 被正文解析错误遮蔽。原始日志 `/tmp/anxin-pr40-submit-rejection-client-before.log`。
2. 修改后原 41 项：41/41 passed，exit 0。日志 `/tmp/anxin-pr40-submit-rejection-client-after.log`。
3. 客户端、store、recovery、poll-concurrency、cleanup 共五个测试文件：118/118 passed，exit 0。这里包含上述 41 项客户端测试，不能与其相加。日志 `/tmp/anxin-pr40-submit-rejection-focused.log`。
4. 增加错误流 cancel resolve/reject/pending/同步 throw 四项后，最终客户端 45/45 passed，exit 0。日志 `/tmp/anxin-pr40-submit-rejection-client-final.log`。
5. 最终 typecheck、四文件 ESLint、git diff --check 均 exit 0。日志分别 `/tmp/anxin-pr40-submit-rejection-typecheck.log`、`/tmp/anxin-pr40-submit-rejection-eslint.log`。

测试的错误状态包括 400、401、403、404、408、409、410、413、415、422、429，各覆盖 JSON、HTML、坏 JSON；另有不可读/超长错误体、503、超时、损坏成功体、正常成功请求与原请求边界。

## 交付与验证限制

可应用补丁 `/tmp/anxin-pr40-submit-rejection.patch`；机器报告及四文件 SHA256 `/tmp/anxin-pr40-submit-rejection-report.json`。源文件可直接从隔离树复制。

客户端单元测试控制 fetch，不声称是实际网络服务；原有五文件里的 route/D1 回归沿用 controlled client。独立 Agent currency_fix 已返回真实客户端 + route + 临时 D1 回归：原版 13 passed / 18 failed，修复后 31/31 passed。该结果由 currency_fix 独立执行，本 Agent 未重复运行；fetch 仍是受控边界。其静态复核未发现阻塞。覆盖 4xx 不可读/超长正文、七种未知回执恢复、owner/new source/new job/人工确认 CAS，以及旧确认不复活。根 Agent 负责最终完整 npm run check 和生产构建 Worker + 真 rules service 的隔离 HTTP 回归。该报告不把待执行的整合验证算作通过。

请求模型沿用 gpt-6.1-sol / ultra；此说明不是后端实际运行配置的独立核验。本 Agent 没有继续委派。

独立回归原始结果：最小 before `/tmp/anxin-pr40-submit-rejection-before-minimal.json`；完整 before `/tmp/anxin-pr40-submit-rejection-before-full.json`；完整 after `/tmp/anxin-pr40-submit-rejection-after-full.json`；独立技术报告 `/tmp/anxin-pr40-submit-rejection-independent-review.json`。测试文件 `/Users/xuzihan/Documents/Projects/国创/anxin-pr40-submit-rejection-review/lib/material-fact-submit-rejection-independent.test.ts`，仅新测试补丁 `/tmp/anxin-pr40-submit-rejection-independent.patch`。


主代理最终整合：完整 npm run check 通过，41个Vitest文件、1188项全通过，材料Node67通过/1个macOS平台跳过、runtime30通过，类型/lint/build/数据/Python检查通过；v4/v4rep/v5/v6冻结验证通过。真实隔离Worker/D1/R2/rules HTTP：事实10、取消14、并发4、恢复10均通过。恢复新增场景先占满真实服务32个结果记录，原版上游429/Worker202/running，修复后Worker200/failed、remoteUUID404、后续对不存在UUID轮询0次；释放记录后显式重试新UUID成功，服务POST总数2（拒绝1+用户重试1）。原有9恢复场景保持通过。

其余HTTP批次第一次隔离Worker在就绪前退出，没有进入业务断言；保留http-startup-failure.txt，不认定产品根因。停止并行检查后串行重跑事实/取消/并发全部成功。生产未部署；合成技术验收不替代真实案件或人工验收。当前请求显式触发提取会撤销旧确认，即使服务拒绝也不会自动恢复旧授权，已有审计记录保留。未知5xx结果仍在既有有界窗口内核对，不保证跨服务进程恢复。
