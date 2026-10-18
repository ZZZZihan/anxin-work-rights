本轮有限独立范围复核通过：最终 CODE 的 27 项在 Node 24.22.0 和 Node 26.11.0 均为 27 PASS、0 FAIL、0 SKIP，两个进程均 exit 0。运行前后 78 个 lib 文件及 5 个独立测试脚本的 SHA 均相同。此结论仅覆盖本次限定的源码、模块、运行时和源文边界；主侧最终整合 fullcheck / HTTP388 在本收据时仍待终态，不据此宣布整个 PR、真实案件或人工业务验收通过。

最终产品以实际字节绑定：

- `lib/material-money-v4.ts`：`13c852da181c401b6f1b55c7279ddcc3f25a1f52f3c4d6e0c8a89e1de9d10df8`
- `lib/material-fact-source-review.ts`：`5c9606f86f4ac95c66436dba6e41fe21f588cb35ba9ffb804eecdee2352e4b28`

本 Agent 未参与这两个产品实现，仅编写独立测试、只读审查及追加证据。请求配置为 GPT-6.1 Sol / ultra，实际 backend 未独立核验。产品集成字节与 checkout HEAD 的身份分别记录在 JSON，不将未提交集成内容冒称某个 commit 的原始树。

27 项由原始范围 14 项、姓名正文可用性 2 项、续写防护 9 项、缺少可选 bbox 1 项、完整既有币种续写 1 项组成。它们覆盖：跨页停止拼接且保留关系警告；同页相邻 OCR 片段的算式、范围、疑问、分币和费率仍不可用；完整“币种＋空工资/金额标签”拒收并保留 raw；姓名正文保留为 unsupported/null；整正后疑问、外币、付款尾部不能被丢掉；历史强制 exact 降级及旧 null 不升级；CP 锚点、原始值、源文与未确认计算状态不变。币种补充测试含 120 个有限组合观察，不是 120 份真实材料。

实际基线是当时未提交的兼容产品 575b/5bee，已完整归档 78 个 lib 文件，不冒称 exact 1cc checkout。原始 14 项在两种 Node 上都是 7 PASS / 7 FAIL，分别是 3 项跨页误拼接和 4 项完整空金额标签误收。姓名正文 2 项本来通过，属于对照，不计为新增漏洞修复。

初版 13c852/0e9b 的原始 16 项双运行时全通过，随后主侧完整检查仍出现 80 个失败叶。独立分类为 47 项旧合成夹具页码契约冲突、30 项同页 null→exact 的真实漏放、2 项姓名金额可用性退化、1 项异常吞掉 accepted 候选。最后一项是新布局比较读取缺失 bbox 导致 TypeError，assessCase 捕获后清空 accepted；它造成的 FP 消失不是评分改善。原 date-name 测试也先通过六层计数，才在 production-defense 金额断言失败，不能把该叶误说成错误获得 TP。

为保留可复验反例，独立续写 9 项在兼容基线为 8 PASS / 1 FAIL，在初版 0e9b 为 6 PASS / 3 FAIL；缺 bbox 单项在初版实际 TypeError 失败。后续 898 中间版仅私列 USD/港币，仍漏美元、港元、EUR、JPY、HKD：独立币种测试真实 0 PASS / 1 FAIL，其中 40 个有限观察误为 exact。最终源码已移除私有两币种枚举，统一调用既有完整 whole-tail 防护谓词并传入实际 meaning/rateUnit。初版完整失败日志、中间快照和所有原始收据均保留，未用最后通过覆盖。

只读技术复核未见本范围阻塞：money 只增加全值锚定的单一币种＋有限空标签分类，不剥掉姓名、数字或未知后缀；source 只沿每一步直接相邻同页片段或有界同排 bbox 续接，跨页不再组成公式，材料整体的关系警告仍保留。无法证实的续文维持 uncertain/null，不宣称构成某个数学表达式。完整币种、问号、付款未知、费率、数字和整正尾部沿共享已有防护处理；两处 bbox 比较均使用 Array.isArray 防御。原文和 CP 位置未重写。

六个旧合成测试仅迁移明确连续 OCR 片段的页码元数据：添加 opt-in samePage 参数并在对应调用启用，默认 page:index+1 不变，金额、状态、历史和评分断言均未删改。分币评分夹具 b1/b2 同页，独立事件 b3 仍在 page2；跨页负控保留。逐文件最终 SHA 与差异记录于 `fixture-migration-final-review.independent.json`。作者报告的 1725 项定向回归不是本 Agent 执行的检查，不与本次 27 项混算。

`canCalculate=false`、due/paid 值为空及未确认状态仅证明合成程序的可用性门禁，不是 UI 验收、人工授权或法律计算正确性。未调用评分器、历史 CLI、模型、HTTP、构建或完整检查，未修改产品、冻结结果、旧报告或旧失败。部分早期文件名含 final，但它们是当时的候选记录；最终收束以本文件、配套 `round35-application-review.final.independent.json` 及本次 `node24/node26-final-27-5c9606f8` 证据为准。真实 OCR 分段、主体身份、应付金额和案件业务仍需独立人工验收。
