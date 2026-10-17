# 材料到用户确认的事实链 v4

本轮不训练、不部署。新 PR 依赖 PR #31；v1-v3 全部冻结。应用和新评测共用 lib/material-facts.ts 的唯一 TS 领域内核，Python v3 只作兼容行为参照，不宣称网站直接运行其内存锁。

## 材料与候选输出

输入为真实材料读取出的 blocks（id/page/text），保留 evidenceId、文件 SHA256、分析版本及来源。模型只输出 `{"candidates":[...]}`。每个候选严格为 kind/value/quote/blockId/subject/period/qualifier/assertion，不能输出 confirmed、计算指令或授权字段。

- kind：worker/employer/period/monthly_rate/due_total/paid_total/arrears/award/payment/other_amount。
- value 是原文连续子串，quote 是同一 block 的精确子串且包含 value；不改写引用、不补日期、不推算金额。引用位置由程序按 Unicode code point 计算，不信任模型 offset。
- subject：原文明示的对应劳动者名称或 null；period：原文明示的该项所属期间连续子串或 null。两者非 null 时必须在同份材料中出现，不能仅据出现就宣称语义对应已被证明。
- qualifier：wage_period/employment_period/contract_period/other_period（period）；gross/net/partial/unknown（金钱）；unknown（主体）。不能把任职或合同期间当工资期间。
- assertion：claimed/admitted/decided/narrated/unknown；仅原文明确承认才是 admitted，外层“经查”中的当事人主张仍 claimed。行政/司法命令支付金额用 award；月薪、单笔付款、欠款、判付均不能自动作 due_total/paid_total。
- 最多 40 个候选，源文本至多 24000 Unicode 字符；超过限额明确失败，不静默截断。不接受来源指令；文书全部是不可信内容。

程序逐条保留格式/字面支持校验结果、被拒候选和原模型回答，未通过不静默纠正。字面引用通过不证明语义正确或材料真实。所有提取都只成为候选，旧材料界面的 confirmed 仅表示原文核对，不授予工资总额资格。

## 用户动作与持久化

网站沿用案件认证/所有权。用户须显式确认劳动者、用人单位、工资期间开始/结束；分别输入本期完整应付与完整已付总额，确认金额口径、核对当前候选，并在存在冲突或补充修订时写明核实依据。明确零合法，空白不是零；模型提案不能调用用户确认接口。确认记录的 actor 由服务端认证产生，不由客户端提供。

新材料从上传 intent 起、状态变化、分析修订、删除、案件归档/恢复均推进 D1 的 material_generation。所有事实动作使用 revision + generation CAS，并检查 owner 和案件未归档。所有材料须完成候选提取或被用户明确说明为何与本次核算无关；失败/未处理材料不能悄悄忽略。改变范围、撤回、重新提取或新材料都使金额确认失效。冲突不投票、不自动采用最新数字或裁判结论，保留原候选和用户处理依据。

计算只在 scope、due、paid 已确认且材料完整覆盖时授权。以整数分表示金额，并在同一 D1 条件写入中计算/记录结果，CAS 失败不产生授权执行 receipt。TS 内核只生成核对通过的计算计划，不在数据库提交前偷偷执行工具；实验明确区分候选提取与脚本模拟用户确认，不能把金标确认算作模型能力。

## 测试约定

使用来源独立的真实公开文书，开发与留出按案件/关联工程分组；文书叙述不称工资条或流水原件。只共享必要短摘录和出处；原始网页留本机。公开可读不等于开放训练许可。本轮只做推理评测。

主指标预先固定：候选类型/金额规范值/主体/期间/断言属性、引用定位、漏提/多提和字面拒绝；分别统计原输出与程序接受输出。所有失败保留计划分母，不能把没有输出算正确。另作脚本化确认/冲突/撤回/新材料/所有权/并发的程序测试，和模型成绩分开。API请求首次结果保留，预算和停止规则在推理前冻结；测试后不回改输入或金标抬分。
