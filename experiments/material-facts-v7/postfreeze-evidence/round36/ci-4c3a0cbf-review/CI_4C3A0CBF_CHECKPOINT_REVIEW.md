# PR45 exact 4c3a0cbf CI 只读核对

**CI 实际通过；应用因四条新审查继续阻塞交付。** 本收据只对应 `4c3a0cbfe60623695de5dda67d17339d5e827ac8` 的 [run 39153210775](https://github.com/ZZZZihan/anxin-work-rights/actions/runs/39153210775)，不覆盖此前 fa77 失败。

远端 check job 的 27 个步骤全部 success。Ubuntu 24.04.5、Node 24.21.0、npm 11.19.0、Python 3.12.15。完整检查日志实读：Vitest **1789/1789、46 files**；材料 **68/68**；运行时 **8896/8896**，fail/cancelled/skip 均为 0，运行时耗时 **87.668646547 秒**；Python 三组 **9、11、16** 均 OK。原五个进程树断言逐字保留，并与新增四个就绪记录确定性检查一起实际 9/9 通过。

实际 checkout 为 PR merge `1e400774523ec1081d715f0576a5987fddb8eabf`。API 的 merge parents 包含本 head；merge tree 与 head tree 均为 `2f1745c02a5326975d05f032356eeddbfad8c240`。从 fa77 到本 head 仅修改 process-tree 测试一文件，产品、共享进程组 helper、四个 HTTP runners、package 均无差异。11 个精确头文件在审计前后与 CODE 相同。

下载并保留原始日志 ZIP（29 个文本成员）和完整日志；两份 artifact ZIP 共 11 个成员（9 JSON、2 worker logs），本地 ZIP SHA256、GitHub API digest 与上传步骤日志三方一致。材料 ZIP 为 `a1f536dbe74452c3da0fe1331067169ec8cf35a456944de75d0a103e9738ac28`；基础 HTTP ZIP 为 `1de9b6481500c2be1c2b7218a02ebd553b6f32d733a9f7daea6340d45bbe4769`。

九份报告分别记录：基础 HTTP **21**、合成隔离 **30**、材料文本 **8**、候选/确认 **10**、取消 **14**、轮询 **4**、网络恢复 **10**、v7 **410**、图像/PDF **17**，全部通过；四份带 cleanup 字段的报告均为 PASS、failures=[]。v7 的 **411** 份原始 payload/candidates/finish_reason 与父侧本机参考仅排除 evidenceId/jobId 后一致；**409** 份重启快照原始/历史保持一致。旧 e99 远端报告中的 **387** 个非重启场景按唯一场景名逐项相同。图像使用真实 tesseract，PDF 增加 poppler，结构化均为规则、model=null；这不是视觉模型或新模型评估。

冻结验证步骤通过。v6 日志明确执行 owned temporary tree 内的原 verify 与 summary，`current_product_validation=false`、`summary_checked=true`，并未把历史 v3 替换成当前产品。v4 / replication / v5 / v6 四份原 manifest 对应的 **58+50+20+19=147** 个结果文件，本机 SHA 与原 manifest 及 exact head Git blob 一致；审计后重算仍不变。该核对未自行运行历史 CLI 或评分器。

此前 fa77 run 39152232243 的 **8891P/1F**、就绪文件空 JSON 错误、后续 HTTP skipped 与 79 份失败证据全部保留且重算 hash 不变。本次修复夹具的成功不回写旧失败。补充审计脚本另有两次过强假设失败：新旧场景按前缀位置比较，以及把 PDF/PNG OCR 引擎名视为同一个；原脚本与错误说明均保留，最终按场景名及实际引擎类型核对 exit0，均不算产品/CI 失败。

最新 reviews API 于 **2026-10-18T18:21:58.238092+00:00** 读取 head 仍为本提交：**129 threads / 4 unresolved**，原 7 条已 resolved。新增为 **4308160109 辭職字形 P2、4308160112 日期边界评分 P2、4308160118 翻倍/加倍 P2、4308160120 王和欧多人主体 P1**。审计已向主 Agent 立即报告，未擅自修复或回复；本次不把 CI 通过写成新问题已修复。

GitHub deployments API 对 head 和 checkout merge 各返回 0 条，仅说明这两个精确 SHA 在该 API 无记录，不证明其他部署系统不存在上线。legacy combined status 为 pending/0 contexts；实际 Actions check-run 已 completed/success，不能把空上下文状态当作另一项等待检查。

本次仅读取远端/API/下载日志及文件 hash；未执行本机全检、HTTP、构建、评分、模型、重跑 CI、评论、合并、推送或部署。父侧本机完整检查和 HTTP 记录单独标源。本人曾实现 event-only R36 补丁，因此不将该补丁的技术自检称为非实现者复核；DATA 的独立 44 检查另有证据。人工业务验收仍未完成，合成数据/程序计数不代表真实案件正确率。

详细机读收据为 `ci-4c3a0cbf-review.independent.json`；完整复制白名单为 `copy-index.ci-4c3a0cbf.json`。请求配置继续 GPT-6.1 Sol / ultra，实际 backend 未独立核验。
