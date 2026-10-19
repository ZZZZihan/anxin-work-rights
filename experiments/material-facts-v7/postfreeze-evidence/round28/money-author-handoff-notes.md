# ROUND28 金额作者交付说明（产品已锁定）

固定基线为 b4974a3938b865147aa5714e659a4b19d4a8c771。仅修改 OWN 的 material-money-v4.ts、material-fact-range-review.ts，以及新增一个作者自动测试。基准完整 lib 与 assess.mjs 由该提交只读归档到 b497-baseline；不读取 holdout，不调用模型，不改冻结数据、原始结果或既有证据，不提交或推送。

纯角分金额新增有限的后置人民币标记：单数角/分，角在分前，显式人民币/人民幣/RMB/CNY 位于一端，最多一个标记；沿用 BigInt 精确分。匹配原始 token 后只改解析副本，raw、matchedText 和 code-point span 不改。非法层次、重复数字/标记、无币种、外币、未知、概数、范围、倍数/算式和不支持费率仍无精确金额。新完整 token 的共享范围端点同步识别后置标记，同块裁掉前一元/角/分的候选不能借尾端成为精确金额。

純比例分类只在既有完整锚定语法的检测副本中折叠 為→为。含真实货币的公式、遮盖/未知比例不因此变成 definite no-money。范围后缀只增加有限普通续词的词界例外；真正以上/以下/以内及其工资、金额、范围续文保持不可精确。内陆/內陸普通词中财务数字陆只在剩余数字验证副本中消除，不变更原文或位置。

实际执行（作者自检，不是非实现者审查，也不是业务验收）：

- 最小固定基线：12/12 红，日志 minimal-before.actual.log。
- 原始157作者脚本：基线81P76F；首修151P6F，原始脚本和日志均保留。
- 最终同一157脚本：固定基线81P76F → 当前157P0F。
- ROUND26/27旧作者回归486P；既有混合角分191P；三文件ESLint退出0。没有运行完整check、HTTP、历史深链或任何模型。
- 157项包含raw/quote/code-point定位、fresh ingest、forced历史exact读时降级、不升级历史unsupported、不写原state/history；同事件规范金额的六层评分TP及同额不同事件六层不能借TP。

首修6个失败的准确边界：2个同块纯分裁剪安全漏点已加token边缘守护；1个普通內陸词被财务数陸误计为第二数已修；另3个额外OCR词内换行正控（以下\n列、以上\n海、以内\n部）虽whole/full-quote parser可精确，源文local-clause旧边界会先截成以上/以下/以内并保守降null。最终脚本对这3项保留source-only null，明确不称本轮修复了该可用性残余。author-initial-157.snapshot、author-fixedb497-before.actual.log、author-after-first.actual.log保留原预期和真实失败；最终fixed-baseline日志重新实跑，未把旧红挪作最终相同脚本证据。

组合必需闭合：新支持2分RMB后，['😀王甲工资5角','2分RMB。'] 的第二块裁剪可错误得到0.02；此实际发现已保存在cross-block-subunit-probe.actual.json，并已交父代理与DATA。DATA负责source existing truncatedMoneyToken的layout.before有限前缘守护；本作者的2产品文件不为此改动。最终集成收据另附组合结果，未完成前不称整体通过。

本轮检测仍是有限语法，并不穷尽中文叙述。未知语法保留人工核对；测试通过不代表法务判断、真实生产确认、用户人工验收或部署。
