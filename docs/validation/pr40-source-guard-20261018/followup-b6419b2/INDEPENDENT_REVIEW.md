# PR #40 本轮三项 P2 独立技术验收

日期：2026-10-18。基线：b6419b2c36444171356a2c22fe8107bbfe1da411。
独立工作树：/Users/xuzihan/Documents/Projects/国创/anxin-pr40-independent。
主实现工作树：/Users/xuzihan/Documents/Projects/国创/anxin-structured-material-facts。

## 结论

对与主树逐文件 SHA256 一致的最终整合版本，独立执行 122 项，122 通过、0 失败、0 跳过。在运行时接收边界、覆盖线索的位置绑定及删除证据后的取消日志确认范围内，未发现剩余可复现的实质阻塞。此为合成输入与临时 D1/R2 的独立技术回归及源码复核，不等于真实模型质量评估、全自然语言正确性或用户人工验收。本轮未提交、推送、合并、部署或操作生产。

## 基线与修复后证据

- 独占新增文件 lib/material-fact-pr40-final-review.test.ts：50 项，SHA256 d6eb7b2bc64d3674e8c711171fb7d8ce95234297c71bf8c41fc1b1e542d9cc32。
- b6419b2 原版：14 通过、36 失败。原版没有新 runtime helper，测试明确使用旧生产冻结 validateCandidateOutput / ingestCandidates 作为基线，并非把缺少模块当作 36 个失败。证据：/tmp/anxin-pr40-final-review-baseline-b6419b2-final.json。
- 最终独立整合：新去重 50/50，覆盖诊断 30/30，证据取消真实路由 7/7，store 真实轮询/D1 路由 35/35。总计 122/122。证据：/tmp/anxin-pr40-final-review-independent-integrated.json。
- 8 个最终整合文件运行前后均与主树同 SHA256。证据：/tmp/anxin-pr40-final-review-integration-sha.json。
- git diff --check 通过；lib/material-facts.ts、material-fact-types.ts、material-facts-v2.ts、material-fact-types-v2.ts、material-facts-v3.ts、material-fact-types-v3.ts 与 b6419b2 均无 diff。
- 本轮没有重跑旧 63/156/114 冻结回归，也没有重跑历史模型实验；最终全量 check/build/HTTP 由主 Agent 独立记录。

## 新去重行为与接收边界

原版同标签且 value=8000元时，会用 quote=entry.value 求语义键，抹掉完整引用中的近似、下界、范围、不确定或选择限定，首条候选可把后续精确候选拒绝为重复。50 项覆盖六类限定、两种先后顺序、完整/裁剪引用、同金额不同范围/边界、同一实际位置完整/裁剪重复、受归属守护阻断的 exact 与可用 exact、正常精确重复、无效中间项、原始全局索引、围栏输出、40 项上限、未就绪来源、标签差异、歧义位置，以及历史原记录读取。

新 runtime adapter 先复用冻结 validator 检查原始信封和上限，再逐条复用冻结校验；用 source review 后的金额状态、金额值、原标签、安全问题码及必要的可核验原文位置作去重键。新候选的 ID 仍绑定原始索引，invalid/rejected 保留原始索引和原因，raw、fenced 格式及模型/后端元数据保持。测试实际经过 reviewFactsAgainstSources→buildFactView，不能仅以 validator 接受证明业务可提示。单纯规范化降级路径 source_amount_context_mismatch 不制造同位置的新观察；其他安全问题仍区分受阻候选，防止其挤掉可用 exact。

生产仅 store.poll 切换 ingestRuntimeCandidates；source review 与确认/计算门槛仍照常执行。冻结 validator、normalizer、实验调用方均未改。历史已存 candidates/rejected 不自动重解析，不升级或改写 raw；GET 保留原有接受/拒绝结果，需重新提取才采用新去重。代码与旧文件未变不等于已重新运行历史实验或证明分数提高。

## 覆盖诊断交叉复核

覆盖线索需匹配同证据/SHA、同 block、唯一 quote/value 及精确 Unicode codepoint 位置，只覆盖候选 value 所在范围，不能靠另一处同字面金额或日期覆盖当前线索。运行时只能降低冻结启发式 covered，不能把漏提变成已提。legacy v2 继续通过同源 server review 返回临时 sourceCoverage，原始 schema/raw/持久化记录不迁移。该提示说明可能漏提，不证明事实归属、真实性或完整性。

## 证据删除取消交叉复核

DELETE 的 D1 原子批次同时捕获当前 owner/case/job 并触发持久日志，批次成功后才取消远端任务。远端成功后仅按认证 owner、捕获 case、捕获 job 精确删除日志；远端失败或本地确认失败保留重试。7 项真实临时 D1/R2 路由用例验证：成功确认、远端故障后证据行已删仍可重试、其他 owner/case/job 隔离、重复/缺失/外人证据不取消新任务、事务回滚不调用远端且保留文件、远端已取消但确认失败后的幂等重试。

取消 HTTP 脚本另外只读复核：仅创建本地隔离 Worker、D1/R2、材料服务；新报告前移除旧报告，断言失败或清理失败写 FAIL 且退出非零，临时服务配置权限 0600，最终关闭服务并清理临时目录。本轮未独立重跑该 HTTP 脚本；不能把只读复核当作真实 HTTP 通过。

## 可见模型配置与边界

本 Agent 沿用明确请求 gpt-6.1-sol / ultra；未进一步委派。可核对的是请求参数与本会话可见信息，不能独立证明后台实际模型或档位。修复采用有限语法与保守降可用性，范围内未复现阻塞不保证所有中文/跨文档语义可准确解析。
