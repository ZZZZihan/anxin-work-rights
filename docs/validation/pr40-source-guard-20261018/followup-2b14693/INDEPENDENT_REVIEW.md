# PR #40 后续 P2 独立技术验收（最终 156 项）

独立工作树：/Users/xuzihan/Documents/Projects/国创/anxin-pr40-independent。
基线：2b14693175860f5d1b627760861c746861a3c928。
本 Agent 只编写新增测试、临时复现和报告。产品修复由 root 与 coverage Agent 完成，独立验收时复制到隔离树。未修改冻结的旧 63 项测试，未提交、推送、合并、部署或操作生产。

## 最终可复现结果

- 新增 lib/material-fact-pr40-followup.test.ts 共 156 项。纯 2b14693 上 22 通过、134 失败、0 跳过。证据 independent-before.json。
- 复制 root 最新 event/source/coverage/store 实现与 coverage/store 测试后，在隔离工作树实际复跑 156 新增 + 63 原独立 + 114 币种 + 9 coverage = 342/342 通过、0 跳过。证据 independent-after.json。
- 同一最终隔离树独立执行两条临时 D1、真实 facts 路由测试，选中 2/2 通过；其余 32 条未选中。覆盖非空 v2 读取、确认/计算保存时不落库临时诊断、再次读取重建诊断，以及非总额/日期候选重读后仍有归属核对。证据 independent-api.json。
- 新 156 项测试、产品实现、coverage/store 测试在主树与隔离树逐字节一致。旧 63 项与 /tmp/anxin-pr40-independent-f539e69-63.test.ts 冻结副本逐字节一致。git diff --check 通过。

原始 131 项基线、317 项中间整合结果和 147 项/333 项中间结果均保留，不用于替代最终 342 项证据：
/tmp/anxin-pr40-followup-baseline-2b14693.json；/tmp/anxin-pr40-followup-independent-final-317.json；/tmp/anxin-pr40-followup-baseline-2b14693-expanded.json；/tmp/anxin-pr40-followup-independent-final-expanded.json。

## 本轮独立审查和回归

156 项通过真实 ingest -> reviewFactsAgainstSources -> buildFactView 路径，覆盖全部七种金额角色、非完整总额、个人/班组/单位/未知 scope、全部六种日期角色，包含主体/期间借自其他块、同句双事件、转述者被当受益者、清晰单事件正向。核对问题进入 reviewIssues；原值、引文、representation、模型原回答、用户确认和输入状态保留，不只测试冻结 validator。

本轮额外复核发现 generic 关联只按模型 meaning 检查付款方向可被错标签绕过。原文“王甲2024年7月支付工资8000元。”分别标 rate/arrears/award/other_money，曾实际出现 accepted=1 且 reviewIssues=[]。临时复现证据 /tmp/anxin-pr40-payer-meaning-probe.json，脚本 /tmp/anxin-pr40-payer-meaning-probe.test.ts，均保留。最终回归新增四种错金额角色、五种非 payment_date 错日期角色，连同原 payment_date 用例覆盖六日期角色。root 改为按源文支付/付款/给付词也触发收款方向核对，最终全部通过。

另新增“另一工人/班组工资也计入上述总额”“有日期金额另一行也计入上述总额”的三条回指材料，验证即使已人工确认主体和期间，仍不可提示为个人完整总额。separateEvent 已收紧为有限独立事件，未知尾句不能借“另一”或另一个姓名跳过。organization 七金额角色及 payment unknown、个人/班组/未知付款者均补了实际 review 告警回归。

正向金额 payment 继续用“收到工资”，日期 payment_date 正向用“收到工资”，award 正向用“裁决应得工资”。“支付/给付”只能确定付款方向，不能据此把付款人标成工资受益者。

legacy v2 非空候选通过服务器 source-review 获得 sourceCoverage，再交给无原文客户端显示 possible_missing。原协议、raw 和 rejected 保留，损坏旧 raw 不修写；来源缺失、未 ready、SHA 不同或 revision 改变时清除旧运行时诊断。helper JSON 往返显示和 D1 路由读取/保存均通过。

## 技术复核结论与边界

1. 完整个人 due/paid 沿用更严格的总额关联门槛；其余角色、scope 和日期经过局部单事件归属门槛。未知相邻分句、跨块限定与有限语法外关系进入核对，不凭全文共现通过。受益归属不能仅信模型角色；源文方向词也参与失败关闭。
2. 仅 ready、同 evidence id、同 SHA 与 analysisRevision 的 source 可进入运行时覆盖和候选复核。buildFactView 保留 reviewIssues，Panel 调用 getReviewedExtractionCoverage 并使用既有核对与可能遗漏展示。
3. sourceCoverage 是响应诊断；store serializer 显式剥离，helper 无当前来源先清旧值。冻结 getExtractionCoverage、v2/v3 规范化和提取协议均未被本 Agent 修改；已有 v3 persisted coverage 仍作兼容回退。

在本次有限语法、同源上下文扫描和上述回归范围内，最终未发现剩余可复现阻塞。该语法保守接受有限明确事件，复杂转述、跨句指代、付款受益方向不明、罕见含连接字姓名等可能要求人工核对。此结论不保证全自然语言理解；启发式未发现遗漏不等于提取完整，也不授权计算。

342 项合成运行时回归与两条真实路由/临时 D1 测试分别记账；受控服务回复不代表外部真实模型质量。全量项目检查、构建、HTTP、浏览器与用户人工验收由 root 单独汇总，不能用中间结果代替最终整合检查。

## 冻结文件指纹与模型配置记录

新增 156 项测试 SHA256：154f7622a076d32059f349588bab3c368e25834877665e13a0924e650b76effa。
event-review SHA256：fdaa9bea4191fcf4bb0143a8f402f7e07293cbd558711e728a3177a8cc570e68。
source-review SHA256：8680300379a55fc8b903f498a72e834163ba1b76eb56bb8c6df3d0b539b1dede。
coverage-review SHA256：43a1313fe4da8cd9730e77cdf096002af331fb989274a6abe8bcee436c173b4b。
store SHA256：e84b3249db5584b28f1fc2f7ef4ab51bb75fcfa1508fc118fdb2bde86b01dc84。

本轮延续 root 明确请求的 gpt-6.1-sol / ultra 配置约定，未再委派。只能根据委派工具参数和可见信息记录请求配置，无法独立核验平台实际服务模型或推理档位。
