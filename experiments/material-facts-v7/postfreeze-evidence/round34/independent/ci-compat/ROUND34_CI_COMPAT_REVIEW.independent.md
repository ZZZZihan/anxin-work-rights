# ROUND34 CI兼容独立复核补充

限定兼容改动通过。本人在真实 CODE 工作树分别使用 Node v24.22.0 与 v26.11.0 执行原锁定8项和独立小时上/下界2项：每个运行时均10项通过、0失败、exit 0。四个被观察产品文件执行前后字节一致。请求 GPT-6.1 Sol / ultra；实际 backend 无独立核验依据。

精确旧基线为 `1cc56d6bc52b67f5c53e7805a9bac0614dfaecd1`。独立归档78个lib文件逐项复核不变。旧8项在两个运行时均6通过、2失败，真实失败分别为下一行裸“每月”误附着金额、以及“/月以上”总额分类不兼容。另2项传统小时上下界在旧基线本来通过，属于回归护栏，不计新增修前失败。

实际差异只涉及 money/source 两文件。明确斜杠继续读取有限layout分母；下一行裸“每月”不附着前额。合法分母后的既有界限仍须降为非精确；检测副本有限折叠“時”，原文与码点不变。完整“月亮”等词不借用“月”枚举。

测试分别核对fresh、强制存储旧exact及旧null；source只读复核不改传入对象、不升级旧null，raw、representation及emoji码点保持。下一行裸“每月”的4000金额派生值恢复，但来源关系仍有warning；accepted、派生金额、来源可用事实、人工确认与计算授权没有混作一个结论，未生成确认或计算。

最终产品 SHA：

- `lib/material-money-v4.ts`：`575b5a27165dde253ed4e7ff85de93fdd3b01ddf2f2af930de9fdf745808095d`
- `lib/material-fact-source-review.ts`：`5bee328a03deb6e072f2c8e9760ec100a8d5628a14f4670ff38e40d814f84766`
- `lib/material-fact-event-review.ts`：`01a7bc8c76dd1bcb77fc7316485d4283c3c7d7ff80e0d3c4910801114a822eed`
- `experiments/material-facts-v7/assess.mjs`：`3cafbd4bbf51bedb7f8629fa0f4f4cdeb3220c6dfbf666747def192bcd311ca3`

原ROUND34 18项回执与原失败日志不改写。本次没有重跑该18项，没有本人执行作者202/557套件，也没有HTTP、构建、评分器、历史CLI、完整检查、模型或业务人工验收。新ROUND35两项审查进入独立待测阶段，本补充仅证明上述兼容范围通过，不代表整份PR通过。
