# ROUND38 五项应用范围独立轻量复核

结论：本轮五项具体 finding 与锁定控制的轻量模块/运行时/历史读取检查 **PASS**，范围内静态未见阻塞。此结论不替代主侧完整检查、HTTP、精确远端 CI 或人工业务验收；d963 的远端失败仍按原始 ECONNRESET 证据保留。

同一份 SHA ce208da7a20513ef80a28a15e2013b36a699c98ebbfacb475fedc3402e1e5397 的 20 项测试，固定 d963 完整 78 lib 基线在 Node24/26 各 5P15F，实际 CODE 最终整合在 Node24.22.0 与 Node26.11.0 各 **20P0F、exit0、0skip**。执行耗时分别 0.251s / 0.414s。7 个受保护源文件前后 SHA 相同。

本人未实现这五处本轮改动。只读精确 diff 审查确认：

- shared bound 只新增有限高达/低至；高达可有强调确数语义，当前保守留待人工核对，是可用性取舍。
- 翻一倍沿现有明确算式锚定与严格 FACTOR 检查，保留基数原文并不给出计算后的金额。
- event 只在完整 recurring payment_date 布局新增发薪，不改变主体、否定、他人收款及群体边界，不宣称实际到账。
- postfix ¥/￥沿原共享重复币种 guard 拒绝，不丢弃尾标后截取精确值。
- runtime 只允许一次有限前置工资/劳务费/劳动报酬包装；原唯一发生位置、同块嵌套锚点、归一化状态与事实属性/issue 条件全部保留。同额不同人或不同块仍两条，不按同额猜事件。

测试保留 raw、representation、代码点位置以及无确认/无 calculation。unsafe full/min quote 的 fresh 和 forced historical exact 都降为 null；历史原 null 不升级，未变为零。支付日期只有日程含义，accepted/数值 exact 不代表真实可用事实或计算授权。去重两种输出顺序及两个独立事件控制均通过。

精确产品哈希：

- lib/material-money-v4.ts `b6c0d054856d2cda2cb472eedb88d8c877add7906138cd4850aa9859f70f619e`
- lib/material-fact-range-review.ts `25ccc83f024934e40d76c01cbeb14c6b6a836287f741d3380168d21f384942b6`
- lib/material-fact-arithmetic-review.ts `3b3f0536484e5be4c73bbb3c9f31093245fc3ed5731120d1048209c4e914f329`
- lib/material-fact-event-review.ts `a6fdae5c33726253ed0f530b225a98bed00f76b3baa6019402f2973629194362`
- lib/material-fact-runtime-ingest.ts `6121c35537f7512449bf66b9bc810bb71d0ead6f643cbf2355363df581639cab`


初稿旧 batch validator 去重前置检查问题及 4P16F 原日志原件保留；正式逐候选合法 schema 后重新跑出的 5P15F 旧红也保留。没有修改原锁定 20 项断言来适配实现。本人没有执行作者全集、HTTP、全检、评分器、历史 CLI、模型、CI 重跑或 UI；没有改产品、ROOT/CODE、冻结记录、旧证据、提交或推送。

请求 GPT-6.1 Sol / ultra；实际 backend 不可独立核验。
