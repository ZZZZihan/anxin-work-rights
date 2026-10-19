# 明确人民币与无金额描述修复交接

仅修改自有树 `lib/material-money-v4.ts`，新增一个作者测试 `scripts/material-fact-explicit-rmb-classifier.test.mjs`。CODE/ROOT、冻结数据和结果均未写入；无模型、训练、服务、构建、深链、Git或部署操作。

- 固定旧 money SHA `52c27591d57551dd874d61f6c2b1da7195c1be9df7da1e342dd2ace8da76710b`：最初117项70通过47失败；扩展后的同138项86通过52失败，原日志均保留。
- 新 money SHA `f46a54c089e609f8a860eaa9449a979c7fc92279482e535682bdf6d8028cdbc1`；新测试 SHA `96b6f9ec3fb13d18cd8fb1fc0f980965b89d5595f2f0ab6fe5c4d72ff424713e`。
- 最终138项全部通过，含完整/裁剪quote、原始raw与码点、历史强制旧exact降级、历史unsupported不升级、跨块范围及尾部角分、真实费率和另一事件对照。另当前7套相关native639通过、3套Vitest281通过、syntax两文件与scoped lint通过。

本模块支持四类有限规则：完整无金额成数/折扣拒收；传统无金额工资标签拒收；数字后明确人民币/人民幣/RMB/CNY完整金额；仅在明确命名人民币时解析单数字角分，例如人民币5角2分→0.52。BigInt按整数分处理，不执行比例或算式，不舍入，不新增裸角分解析。

新语法必须与主侧三个独立修改共同集成：range `7dd7c385…`、currency `a64cb875…`、source `8921edbb…`。源文“人民币5角”下一块“2分”的实际137通过1失败已保留，主侧source修改后才138通过；不得仅复制money声称整体验收。完整hash见JSON receipt。

`explicit-rmb-existing-final.log` 的636通过1失败来自误选自有树旧测试：它仍期望4萬圓不支持，和此前ROUND22已支持萬的能力冲突。没有改旧测试；原日志保留，改用CODE当前已把该值列为精确金额正例的测试，在同一隔离新money上得到639通过。

上述是作者在macOS Node26.11的合成与局部回归证据，不是Node24执行、HTTP、CI、真实模型或业务人工验收。主侧集成与未参与实现者复核另行记录。
