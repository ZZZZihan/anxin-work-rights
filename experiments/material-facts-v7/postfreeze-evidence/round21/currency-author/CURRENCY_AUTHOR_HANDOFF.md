ROUND21 currency 词界作者交接

固定基线为 `91a364f0fd54cdeaa95a69d0a9e48d231f5b22f7`，只修改 OWN 的 `lib/material-fact-currency-review.ts`，新增 `scripts/material-fact-currency-payment-purpose.test.mjs`。API、parser、source-review、range/arithmetic、ROOT/CODE 工作树及冻结对象均未改动；没有模型、构建、HTTP、训练、部署、提交或推送。

共享元词界现在把明确年终奖、年假补偿/工资识别为金额后用途；`4000元`、裸 `4000` 的真实邻接元单位都可保留。元年自身、元月、元件、元音、元宝、二元论、三元催化器等仍不可作为货币单位；未泛化豁免所有年字词。月工资例明确按 rate/month 测试，词界修复不解除其他费率角色守护。

姓名前置边界只做等义替换 `(?:\p{L}|\p{N})$`，保留 Unicode 字母/数字语义，不改有限姓氏/币种名形状，不增加主体信任。真实 Node26 probe 显示字符类+尾锚对 𠮷、𐐀、𝟘、𞥐 误返 false，分支写法均 true；emoji 仍 false。此为观测到的正则行为差异，不称 Unicode 数据库缺字。😀𠮷王美元不能把王美元当完整姓名豁免，句号分隔后的王美元可正常使用。

同一最终124项作者夹具，在固定旧库下 **65 PASS / 59 FAIL**，仅 overlay 最终 currency 后 **124 PASS / 0 FAIL**。三项既有作者回归 suite 实际 **423 PASS / 0 FAIL**，syntax及 scoped lint exit0。测试同时进入真实 runtime store 与强制旧 exact 的读时路径，断言原始 raw/value/quote、来源 SHA、Unicode 码点位置和历史不变，没有自动确认/计算。全部为原生合成测试，不能当模型或真实业务验收。

最初120项夹具误将 payment.completeness 写为 not_applicable，导致13/107；已完整保存并标 fixture-invalid，未计为产品修前红。修正夹具后的120项有效红为63/57，增加父侧要求的Han姓名边界后最终有效红为65/59。中间显式Han字符类补丁122/2也保留，最终没有采用该枚举方案。

文件 SHA-256：

- currency：`188a2a2ba520743efb6568f31c5b30256ee11899cac8ff03b01cf8a90688a099`
- 新作者 test：`9faa2e153907b71c7faaa96757850de2a9e1d738df497d59606b7fdcdd78a97e`
- 精确91a→final补丁：`08f61e1c78b1f9a703b7c9a4bb40e465af8227b7af0660bbdab6c71173660115`

所有日志、snapshot和真实 Node26 probe 的哈希及可重复调用方式见同目录 currency-author-receipt.json。运行新作者测试时设置 MATERIAL_FACT_TEST_ROOT 为固定91 lib副本（或待集成ROOT），MATERIAL_FACT_CURRENCY_ROOT 为目标currency所在工作树。旧脚本/历史证据未覆盖；最终 npm全量、Node24和HTTP由主侧分别执行与报告。
