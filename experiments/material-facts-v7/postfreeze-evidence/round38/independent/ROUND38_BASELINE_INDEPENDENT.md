# ROUND38 固定旧基线独立回归

基于精确 d963425ef16831768395ba6a233df272dbaee196 的 78 个 lib git blobs，本人分别用 Node24.22.0 与 Node26.11.0 执行锁定 20 项，各为 **5P15F、exit1、0skip**。五个本轮 finding 均有实际旧行为证据；最终产品尚待父侧整合后复测，不把基线失败当作修复完成。

15 个失败：高达/高達/低至 direct+完整及最小 quote/source/history 6 项；翻一倍 2 项；发薪支付日期布局 1 项；重复币种符号 4 项；同一唯一位置前置工资包装两顺序去重 2 项。5 个控制通过：日期否定/他人/invalid32、已支持发放及错 role、单币种金额、同额不同人、同额不同块的两事件不折叠。

原始 raw、representation、代码点位置和材料字节都保留；历史强制 exact 仅可降级，旧 null 不可升级；不生成确认或 calculation。日期只能说明约定发薪日，不证明实际收到。accepted 与金额可用分开检查；没有执行评分器、历史 CLI、完整检查、HTTP、构建、模型或 UI。

初稿将 archived batch validator 的既有重复拒绝误当 schema 失败，实际 4P16F 中 3 条是测试前置检查问题。初稿和原日志保留；更正为逐候选验证合法 schema，再重新执行完整固定旧基线，正式为 5P15F。没有借修改预期迫使产品通过。

脚本 SHA256 ce208da7a20513ef80a28a15e2013b36a699c98ebbfacb475fedc3402e1e5397。所有 78 基线文件在两次执行后逐 SHA 不变。移交索引把 .ts/.mjs 原文备份映射成 .snapshot，避免进入接收方应用编译/执行扫描；OWN 的真实可运行基线仍保留原路径。

请求 GPT-6.1 Sol / ultra；实际 backend 不能独立核验。没有修改 ROOT/CODE/产品、冻结数据、旧结果或旧回执，也没有提交推送。
