本轮限定金额与范围端点修复已锁定，只修改作者工作树的两个生产文件和一份新增作者测试。主集成树、冻结数据、原始模型输出和旧日志均未修改。

固定基线为 CODE `1c875b7ebd594c672eb6a3e294a6cb3118034feb`。同一份最终 262 项测试在该基线上实际得到 65 通过、197 失败，其中 196 项是行为断言失败，1 项是基线没有新增共享 status API。最终两个生产文件得到 262/262 通过；固定基线依赖只覆盖这两个最终文件后，原有 485 项 Vitest 和 285 项原生回归也均通过；三文件范围的 ESLint 退出 0。

最终共享 `attachedMoneyQualifierStatus(before, after)` 返回 `unsupported | approximate | null`：带符号金额保留 unsupported，数/几、上下界与概数为 approximate；布尔接口继续兼容。有限币种矩阵覆盖人民币、人民幣、RMB/CNY 大小写及全角、¥/￥，金额单位元/圆/圓，前置及后置限定，后置最多两个 wrapper、范围双端、显式布局续行。明确的新主体、数字、句界、日期和期间对照保持精确；新词只锚定金额 token，避免把“不满三个月工资合计四万元”中的期间限定套到金额上。

原文、quote、Unicode code-point 位置保留；不从概数、范围、遮盖、历史已不可用状态恢复精确金额。测试全为合成 fixture，不是模型效果、真实案件、生产确认流程或法律准确率验收。跨原始 block/相邻 block 的边缘重建与 source-review status 接线由主 Agent 实现，作者 262 项没有冒充独立验证那段新接线；主侧整合 fullcheck、HTTP 和非实现者复核应以本 receipt 的最终哈希再执行。

所有实际红与中间绿日志追加保留。之前名字含 final 的日志仍对应当时文件哈希，并非覆盖或追改；本次锁定版本以 `qualified-money-bounds.final-receipt.json` 为准。后续停止扩展产品规则，除新实际阻塞外仅整理证据。

- `lib/material-money-v4.ts` SHA256 `f7c2e936088985b631a77c17d63c86fec6dfcc4ef50d0c54d322b14dbdc3d148`

- `lib/material-fact-range-review.ts` SHA256 `7443d995944173c0cc43e080bba9d3f117778d79f999abf6463af41b0febe574`

- `scripts/material-fact-qualified-money-bounds.test.mjs` SHA256 `ec8f9ce0ff75a9b8e30f3dc431a70e77dd5066883c319ac0ef7647982399b79f`
