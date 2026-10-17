# 材料事实链独立技术复核回执

后续授权与角色说明：本文件按阶段累积保留发现记录。下文初期“未参与推理服务实现”和最初写入范围，描述的是该阶段的事实。之后主 Agent 明确授权本复核者实现 `scripts/fact-jobs.mjs` 的外部内存保护与进程终止，并扩充 `scripts/fact-jobs.test.mjs`；这一段不再属于本复核者的独立审查，已交由主 Agent 复核。领域内核、store/API、Python 推理、评测运行器和评分器仍由其他 Agent 实现，本复核者未修改这些实现。最新整合范围与结果见文末。

复核日期：2026-10-17。复核者未参与领域内核、推理服务或网站接口实现；请求配置为 GPT-6.1 Sol / ultra。本回执只记录实际阅读和运行结果，不以请求配置代替运行时证明。

本轮允许修改仅为本回执和 `lib/material-facts-review.test.ts`。未修改实现、冻结 v1-v3、Git 状态、模型输入、金标或模型回答；未读取真实凭据、未调用 Qwen/DeepSeek、未部署。实现复核阶段未读取开发集或留出集。

## 已完成的领域内核复核

检查 `CONTRACT.md`、`material-facts.ts` 和 `material-fact-types.ts`，独立编写 25 项受控回归。覆盖：未知和明确零、精确分值与上限、非法输入、候选额外授权字段、伪造引用、Unicode 非 BMP 字符定位、遮盖金额、候选批次重新校验、月薪/欠款/判付/单笔付款不自动授权、用户范围及完整性确认、候选逐项核对、actor 注入边界、不同劳动者、所有材料处理要求、范围变更、撤回、generation 变化、同 generation 下来源删除/修订、重新提取和排除来源。

初次运行 22 项通过、3 项失败，发现：

1. `kind: ["due_total"]` 通过 `String(...)` 转换绕过字符串枚举边界。
2. `assertion: ["admitted"]` 通过相同路径绕过断言类型边界。
3. `0000-01-01` 被 JavaScript 日期解析接受，与有效民用日期及冻结 Python v3 日期边界不一致。

实现者修复后，实际复跑：

```text
node_modules/.bin/vitest run lib/material-facts-review.test.ts
25 passed / 25 total
node_modules/.bin/eslint lib/material-facts-review.test.ts
exit 0
```

目前受控用例未发现领域内核把候选自动升为可信金额、把未知转为零、或在完成撤回后继续返回计算计划。`prepareCalculation` 只返回整数分计划；计算与提交是否原子，需要另行复核实际 store SQL，不能由内核测试推定。

合同允许用户在核对原文候选后输入本期完整金额；该输入属于用户补充确认，不等于模型证明了材料完整性。全量金额候选都必须被逐项确认，其他劳动者和期间的候选也保留供用户核对。字面引用合法不证明语义分类正确。

历史仅保留有界动作元数据，当前确认依据在 `confirmation.note` 和 `scopeReview.note`；撤回、重新提取或新材料后不保留旧私有金额和备注。按本轮冻结合同，这是明确限制，不作为永久审计功能缺陷上报。

## 推理任务服务复核

阅读 `scripts/fact-jobs.mjs`、`scripts/fact-inference.py` 以及 `scripts/material-service.mjs` 的新增候选任务入口。

已执行不调用模型的本地真实 HTTP 受控检查：

- 没有服务认证返回 401；带浏览器 Origin 返回 403。
- 请求不能覆盖服务固定 backend；额外 backend 字段返回 400。
- rules 候选任务创建返回 202，读取为 ready，返回 2 项原文候选。
- 删除后再次读取返回 404；任务响应不携带完整 source 对象。
- 独立注入假推理函数检查进行中任务及排队任务取消，二者均从队列删除。

这只证明本机服务的受控 HTTP 行为，不证明网站 D1、实际模型、浏览器或真实公开材料已验收。

### 待修复：默认重定向可能转发 API 凭据

复核时 `fact-inference.py:121` 使用 `urllib.request.urlopen(request, timeout=120)`。默认 opener 会跟随跨来源重定向，并保留请求的 Authorization 头。已用两个本地 HTTP 服务和纯虚构字符串 `Bearer controlled-dummy-only` 实测：第一服务对 POST 返回 302 到第二服务，第二服务 GET 收到该 Authorization。未使用真实 key，也未请求 DeepSeek。

固定初始 URL 不能保证后续重定向仍属于同一可信来源。建议像冻结 v3 一样安装拒绝重定向的 handler，让任何 3xx 作为失败回执，禁止转发凭据后再校验最终地址。需要以同样本地受控用例复核修复。

### 待修复：宣称的 Node 下限不能原生导入 TypeScript

`scripts/fact-jobs.mjs:4` 直接导入 `../lib/material-facts.ts`，且被原 OCR 服务无条件导入。`package.json` 和材料演示文档仍宣称 Node >=22.13.0；该范围中的 22.13–22.17 默认没有开启 type stripping。Node 官方历史说明默认启用始于 22.18.0 / 23.6.0：[Modules: TypeScript](https://nodejs.org/api/typescript.html)。当前 CI 使用 24，本机受控服务检查使用 26.11.0，不能覆盖旧下限。

建议统一提高声明下限至 22.18，或在全部启动入口显式启用适用的 TypeScript 运行支持；不能只修改新评测入口。

## 仍待独立复核

- D1 store/API：认证与所有权、当前完整来源集合、revision/generation CAS、上传 intent/失败/删除/归档/恢复同步、后台结果落库竞态、同一 SQL 条件写入计算及 receipt。
- 实际本地网站 HTTP 和浏览器：新材料与撤回使旧结果失效、冲突处理依据保存、刷新后恢复及错误恢复。
- 开发集金标的独立语义和引用复核（主 Agent 已授权，但截至本回执阶段尚未读取）；留出集保持未读。
- 全项目必需检查由主 Agent 对整合版本运行；本回执不宣称整合、CI、合并、部署或用户验收完成。

## 后续修复复验与评分复核

以上“待修复”是发现时的历史记录。实现者已增加 `NoRedirect`，并将 package 与演示文档下限统一提高到 Node 22.18。独立复验中，拒绝重定向的 opener 对本地 302 返回 HTTPError，第二来源请求数为 0。没有使用真实凭据或真实模型。

进一步阅读 `experiments/material-facts-v4/assess.mjs` 和 `run.mjs`，新增 6 项独立评分回归，实际发现并保留两个初始失败：

1. 原始候选数组中的 null / 缺少值条目被过滤，造成 raw false positives 少计。
2. 基础匹配任意交换了同类型同金额、不同属性的候选，造成 strict 全对时属性诊断仍报错。

实现者修复后，31 项独立回归全部通过。失败请求仍按所有计划输入产生 FN；重复候选最大一对一匹配；parseable 但 finish_reason 非 stop 不算业务成功；strict 逐项比较类型、金额规范值、主体、期间、口径、断言，且只使用通过原文引用校验的输出。`attribute_errors` 的“同类型/金额中最少局部属性差异”仅是诊断，不取代 strict 一对一指标。

运行器拒绝覆盖已有输出目录，预先记录输入/代码哈希和参数，保存逐条首次结果，并把全量计划输入交给评分器；无自动重试。Qwen 的外部监测覆盖加载和 prefill，内部监测覆盖逐 token 生成。这是静态复核结果，本复核者未启动模型或读取实际模型回答。进程与网络失败的真实运行回执由主 Agent 单列。

## D1 与网站接口复核

已阅读最终出现的 `material-fact-store.ts`、schema 与 0004 migration、facts route、服务客户端、材料删除端、旧 OCR 分析写入口和新 UI 的状态处理。当前代码通过以下连接实现授权失效：

- D1 batch 同时读取所有材料及 generation；候选来源从数据库旧 OCR blocks 重新校验，浏览器不能提供任意 source。
- 触发器覆盖上传 intent、证据更新与删除、旧分析插入/修订/删除、案件单位或所有权变化、归档和恢复。
- 重新提取先保存 starting claim，清除旧范围/金额，再提交外部任务。提交失败仍保持旧授权失效。
- 后台完成使用原 revision + generation 提交；被新材料、其他用户动作或重试抢先更新时返回冲突并取消迟到任务。
- 算术整数分差额与 receipt 在同一条 owner + active + revision + generation 条件 SQL 内写入。条件失败时没有新 receipt。
- 删除事务先读取事实任务 ID，再阻止旧结果附着和清除派生状态，随后尽力取消临时服务任务；服务不可达时向调用方返回待清理标志。

实际重新运行作者的 17 项 D1/API 集成测试及本复核者的 31 项独立测试，共 48/48 通过；整树 TypeScript 检查通过。作者的测试被独立执行并经源代码复核，但不应改称由本复核者独立编写。

另一次单独 Node/Miniflare 的额外 generation 探针在初始化或执行阶段未返回结果，已停止其自身进程。该探针没有产生可用验收回执，不计入通过项；没有据此推断产品回归。其原计划测试的更多写入口不能冒称已独立运行通过。

截至本次复核，尚未亲自对完整网站执行生产构建 HTTP 或浏览器。独立技术复核不替代主 Agent 必须完成的这两项整合验收。

## 开发集独立标注复核

经主 Agent 后续明确授权后，仅阅读 dev 的输入、初版标签、定位及摘录收据，没有读取模型输出或留出内容。独立发现工资争议隔离期间、两个实际出勤期间、另一范围的 6000 元月薪主张和工资支付记录期间共 5 项漏标；作者在不读模型回答的前提下裁决修订，并保留首版。

修订后的 3 份输入不变。39 项 gold 的 quote/value Unicode code point 切片与 33 项预声明备选逐字引用、excerpt 和 block SHA 均核验通过。冗余字段等价仅限 worker.subject 的 null/自身值，以及 period.period 的 null/自身值；金额候选的主体和期间没有因此放宽。

独立回执位于仓库外 `training-assets/benchmarks/material-facts-v4/authoring/dev.independent-review.json`，绑定 4 份 dev 文件 SHA。没有独立重新抓取原网页或核对原 HTML 字节；来源获取与脱敏收据仍属作者证据。此复核不宣称真实案件有效性、模型成绩、法律结论或留出评测已通过。

## 最新角色边界与进程保护交接

经后续明确授权，本复核者只实现了 `scripts/fact-jobs.mjs` 中的进程保护和相应 `scripts/fact-jobs.test.mjs`。主 Agent 已回报对该实现的源代码复核未发现问题；整合必需检查仍由主 Agent 对最终版本执行。不得将本段自检改称本复核者的独立审查。

生产阈值固定，调用方只能提交来源，不能修改保护参数。Qwen 启动前须取得可解析且为正常级别的本机内存状态；启动后每 2 秒由父进程采样，覆盖尚未输出 token 的加载和 prefill 阶段。critical 立即停止，warning 连续 10 秒停止，正常状态重置 warning 计时，swap 相对启动前增长超过 4 GiB 停止，监测错误也停止。两后端均有从子进程启动起算的 600 秒绝对超时。

取消、内存保护、超时、输出超限及进程错误统一请求 SIGTERM；3 秒后仍未退出则 SIGKILL。收到 error 不会提前释放任务，必须收到实际 close 后取消、关闭或队列下一个任务才能完成/启动。退出后的迟到内存采样不能再发送信号。可解析的原始模型回答仍保留给 store 现有失败复查路径；外部停止或非零退出不能作为正常 stop 授予候选成功。

实际运行结果：

```text
node --test scripts/fact-jobs.test.mjs
21 passed / 21 total（含 5 个初始内存状态子用例）
npx eslint scripts/fact-jobs.mjs scripts/fact-jobs.test.mjs
exit 0
npm run test:materials
44 passed / 45 total，1 项 Linux 专用真实 OCR 检查在 macOS 按平台跳过
```

新增用例覆盖起始异常/不可测内存不启动、预检期间取消、无 token 阶段 critical、warning 连续时间与恢复重置、启动前 swap 基准、监测失败、迟到采样、两后端绝对超时、raw 保留、输出超限、缺失可执行文件、cancel/close 等真实退出。另用真实 Node 子进程模拟忽略 SIGTERM：约 3.2 秒后 SIGKILL，第二个受控进程只能在首进程实际 close 后启动。该检查没有加载模型、读取凭据或访问外网。

## 隔离评测运行器最终复核

主 Agent 将 Qwen 改为每份文书使用独立进程，网站同样每份材料启动 worker。开发阶段重新运行必须完整另存尝试，不能挑选重跑成功行拼表；运行参数和输出文件由主 Agent 的实际运行回执另证，本复核者没有读取模型回答。

本复核者发现初版隔离运行器仍使用 3600 秒总限/620 秒阶段限，与声明的单文书 600 秒不一致；error 早于 close 释放、输出超限未统一升级、迟到监测写入边界也需对齐。另以当前运行器源码在内存中仅替换导入的 I/O 边界作受控复现：一个 worker 先输出合法 stop 行再非零退出，outcome 为失败，但评分器按原 stop 行仍得到 TP=1、文书全对。这证明执行失败与评分终态存在实际错位。

实现者修复后，重新阅读源码并复跑同类受控 harness：

- Qwen 第一个 worker 输出合法 stop 后 close(1)：只启动 1 个 worker，第二份计划输入不执行；原始 events 保留 stop，评分用结果保留 `original_finish_reason=stop` 并以 `process_error` 作为终态。全量两份输入评分 TP=0、FN=2，文书全对为 0。
- 两份正常 close(0)：启动两个独立 worker，全量严格配对 TP=2；观察到实际源码注册的绝对超时为 600000 ms。
- 初始内存为 critical：不启动任何 worker，计划两份输入仍产生 FN=2。

上述 harness 使用真实当前 `run.mjs` 源码，仅在内存注入文件、进程、时钟边界；没有修改运行器文件，也不是实际 Qwen/DeepSeek 推理或完整 CLI 验收。源码确认 Qwen 预读正常内存及 swap、等待 close、统一 TERM→KILL、退出后监测保护、首个失败即停批。DeepSeek 一个批次含多个独立请求；后面的第三次请求错误导致批次非零退出，不能抹掉此前已经成功完成的独立请求，因此其逐请求结果继续评分。

目前没有发现必须阻止整合的评分公式问题。`METRICS.md` 的 raw/basic/strict 区分与实现一致：原始数组坏项保留 FP 分母、失败与未调用输入保留 FN、最大一对一匹配、六项语义属性加有效原文引用，协议可解析不等于语义正确。`accepted_count` 是 validator 通过的原始候选数量，即使生成未完整结束也可能大于零；正式业务结果必须读取 `completed` 与 `accepted_*` 配对指标，不能单独把该数量当成功。

运行器遇到未以 LF 结束的最后 stdout 片段，只记录 `incomplete_stdout` 标记，完整 JSONL 行才进入 events。未完成片段不是可评分结果；如果后续要求逐字保留全部管道字节，还需另存该尾段。本轮不将 JSONL 行级事件记录宣称为完整进程字节审计。

## 最新独立复跑与开发集口径

独立复跑未参与实现的领域/评分 31 项和作者编写的 D1/API 17 项，实际 48/48 通过。前者是本复核者独立编写的测试；后者是独立执行并阅读的作者测试。未把 48 项都称为独立编写，未把这些用例等同完整网站 HTTP/浏览器、CI 或用户验收。

作者在首次留出推理前统一日率和事件断言口径后，再次仅复核 dev。输入 SHA 不变，当前为 40 项 expected、32 项备选：30/11/约100 的每日费率口径为 unknown，组件累计 700.78/88 仍是 partial；同一 10321 元支付在当事人主张和行政认定两个断言事件下分别保留 claimed/decided expected，不再由备选跨断言合并。已重新核对原文、全部 quote/value Unicode 切片、备选字面支持、双 LF 摘录定义及 block SHA。39/33 版独立收据按字节保存在作者的 `versions/dev-first-independent-review/`；最新独立 JSON 收据绑定 labels SHA `c16fef5d2fa69270e65d2b3b99ddae86a5a9a6e35721082109679beb5fa980d6`。

本次最终源码复核绑定的主要文件 SHA256：

```text
lib/material-facts.ts c7ca5ea8892142ceb08b4b9a74ec8fa829be3c921d5f32d5ff91e9b69df779b9
lib/material-fact-types.ts 482bfd611104c213358b0ff194969df6926fa96847d30e531bab40a21fff476f
lib/material-fact-store.ts 7b7af4e440cd8d42daa6d56761a95cbba2de511a747b22e62e7cd67353523090
scripts/fact-jobs.mjs cf443435543a8a3362f5569d0544e041e4071a2c07f686de15671cfa3b8dda6c
experiments/material-facts-v4/run.mjs 048a6860ff96f1f3a920154d7255cf10f2c716e6d66d4be2f1eb50688fdb31b6
experiments/material-facts-v4/assess.mjs f20b5c2b080724f8da5be80e75201de4e38673032825806e28817b14e56b8457
experiments/material-facts-v4/METRICS.md 1d8586f7aa6d0f2daa426f628680c7f7603ce14e3dd935deac283fc00461b165
```

截至本回执，复核者仍未读取任何实际模型回答或留出内容，未自行运行模型，未接触真实 key，未修改冻结 v3、prompt、scorer、run 或 store 实现，未进行 Git、合并、部署或线上写入。完整生产构建 HTTP、浏览器操作、整合必需检查和模型实际运行结论由主 Agent 对最终版本单列。
