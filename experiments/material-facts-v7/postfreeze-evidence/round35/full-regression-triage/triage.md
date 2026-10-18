# ROUND35 full-regression read-only triage

本收据只分类已保存的初版 source `0e9b05e2…` 完整检查日志，没有执行测试、HTTP、评分器、历史链或模型，也没有修改产品、测试、ROOT/CODE。

80 个叶失败可精确分为：**47 个跨页夹具契约冲突、30 个同页金额误放、2 个姓名可用性回归、1 个接受层异常契约变化**。不能把80项统称为金额安全漏洞。

原运行：1789 Vitest 通过；运行时8645项=8564通过+80失败+1跳过。原命令退出1。输入日志哈希和每叶原断言都在 `failing-leaves.json`。

## 需要优先修复的同页问题

- 30项本应null而精确：终止词套件28项（16个USD/港币外币尾、12个问号尾），另round25问号1项、round30付款问号1项。它们相关块均page1，不能用跨页策略解释。
- 2项王近/王约：原文标题块被删到空串后未视作可组成片段，正向金额误降null。属于可用性，不是精确误放。
- 1项同词异块评分：日志仅accepted_basic由预期[0,1,1]变[0,0,1]，没有TP增加。fixture省略bbox，初版same-row检查用`!== null`仍索引undefined；父侧/DATA报告assess catch吞了accepted。此处静态读到可达异常条件，未独立执行定位，不能把它描述成评分错获TP。

## 47项跨页夹具

六个旧脚本把相邻文本块页码设为`index + 1`，与本轮“仅直接相邻同页片段或可证OCR同行”语义冲突。47项包含42个精确值vsnull、4个null金额状态uncertain/unsupported差异、1个付款日程nullvs4000。它们不证明同页回归，也不能不经确认就改期望。若原意是同页换块，应经父侧授权修改页码并保留跨页隔断正控。

| Suite | 叶失败数 | 页码语义 |
|---|---:|---|
|material-fact-date-name-boundaries.test.mjs|7|index + 1，跨页|
|material-fact-postposed-unit-source-review.test.mjs|4|index + 1，跨页|
|material-fact-proportion-negative-suffix.test.mjs|5|index + 1，跨页|
|material-fact-source-date-pay-operand.test.mjs|12|index + 1，跨页|
|material-fact-traditional-arithmetic-bounds.test.mjs|14|index + 1，跨页|
|material-fact-whole-money-terminator.test.mjs|28|page1|
|material-facts-v7-assessment-independent.test.mjs|1|page1|
|material-facts-v7-round21-source-rate-author.test.mjs|5|index + 1，跨页|
|material-facts-v7-round25-terminal-safety-independent.test.mjs|1|page1|
|material-facts-v7-round30-money-author.test.mjs|1|page1|
|material-facts-v7-round34-money-author.test.mjs|2|page1|

各跨页脚本的定义行与迁移建议已记录在JSON `fixture_metadata`；父侧明确授权范围以父侧为准，本复核未更改任何夹具。

## 精确80叶表

行号引用原stdout最终失败段；完整原始断言在JSON，不从测试标题推导未执行到的后续断言。

| ID | 脚本:定义行 | stdout行 | 实际 → 预期 | 分类 | 测试标题 |
|---:|---|---:|---|---|---|
|1|material-fact-date-name-boundaries.test.mjs:171|9984|'0.02' → null|跨页夹具契约|a new RMB cents fragment cannot crop the preceding amount ["😀王甲工资5角","2分RMB。"] full=false|
|2|material-fact-date-name-boundaries.test.mjs:171|10006|'0.02' → null|跨页夹具契约|a new RMB cents fragment cannot crop the preceding amount ["😀王甲工资5角","2分RMB。"] full=true|
|3|material-fact-date-name-boundaries.test.mjs:171|10028|'0.02' → null|跨页夹具契约|a new RMB cents fragment cannot crop the preceding amount ["😀王甲工资5元","2分RMB。"] full=false|
|4|material-fact-date-name-boundaries.test.mjs:171|10050|'0.02' → null|跨页夹具契约|a new RMB cents fragment cannot crop the preceding amount ["😀王甲工资5元","2分RMB。"] full=true|
|5|material-fact-date-name-boundaries.test.mjs:171|10072|'0.02' → null|跨页夹具契约|a new RMB cents fragment cannot crop the preceding amount ["😀王甲工资5角​ \t"," 2分RMB。"] full=false|
|6|material-fact-date-name-boundaries.test.mjs:171|10094|'0.02' → null|跨页夹具契约|a new RMB cents fragment cannot crop the preceding amount ["😀王甲工资5角​ \t"," 2分RMB。"] full=true|
|7|material-fact-date-name-boundaries.test.mjs:178|10116|'0.02' → null|跨页夹具契约|a cropped cents tail cannot borrow another equal-amount event in any of the six scores|
|8|material-fact-postposed-unit-source-review.test.mjs:115|10137|'4000.00' → null|跨页夹具契约|explicit continuation across source blocks ["😀王甲工资4000元按","月计。"]|
|9|material-fact-postposed-unit-source-review.test.mjs:115|10159|'4000.00' → null|跨页夹具契约|explicit continuation across source blocks ["😀王甲工资4000元","按小时计。"]|
|10|material-fact-postposed-unit-source-review.test.mjs:131|10181|'4000.00' → null|跨页夹具契约|a rate cannot discard its attached unknown layout tail ["😀王甲工资4000元按月计","未知。"]|
|11|material-fact-postposed-unit-source-review.test.mjs:131|10203|'4000.00' → null|跨页夹具契约|a rate cannot discard its attached unknown layout tail ["😀王甲工资4000元按件计酬","（待核实）。"]|
|12|material-fact-proportion-negative-suffix.test.mjs:87|10225|'4000.00' → null|跨页夹具契约|proportion source layout ["😀王甲工资4000元","乘以对折。"]|
|13|material-fact-proportion-negative-suffix.test.mjs:87|10247|'4000.00' → null|跨页夹具契约|proportion source layout ["😀王甲工资4000元乘以","半折。"]|
|14|material-fact-proportion-negative-suffix.test.mjs:103|10269|'4000.00' → null|跨页夹具契约|negative suffix source layout ["😀王甲工资4000元","（负数）。"]|
|15|material-fact-proportion-negative-suffix.test.mjs:103|10291|'4000.00' → null|跨页夹具契约|negative suffix source layout ["😀王甲工资4000元为","負數。"]|
|16|material-fact-proportion-negative-suffix.test.mjs:103|10313|'4000.00' → null|跨页夹具契约|negative suffix source layout ["😀王甲工资4000元（负","数）。"]|
|17|material-fact-source-date-pay-operand.test.mjs:79|10335|'4000.00' → null|跨页夹具契约|unsupported denominator layout ["😀王甲工资4000元按","季度计。"]|
|18|material-fact-source-date-pay-operand.test.mjs:79|10357|'4000.00' → null|跨页夹具契约|unsupported denominator layout ["😀王甲工资4000元","按周计。"]|
|19|material-fact-source-date-pay-operand.test.mjs:110|10379|'4000.00' → null|跨页夹具契约|arithmetic explicit layout ["😀王甲工资4000元+","奖金。"]|
|20|material-fact-source-date-pay-operand.test.mjs:110|10401|'4000.00' → null|跨页夹具契约|arithmetic explicit layout ["😀王甲工资4000元","加上加班费。"]|
|21|material-fact-source-date-pay-operand.test.mjs:110|10423|'4000.00' → null|跨页夹具契约|arithmetic explicit layout ["😀王甲工资4000元乘以","提成。"]|
|22|material-fact-source-date-pay-operand.test.mjs:110|10445|'4000.00' → null|跨页夹具契约|arithmetic explicit layout ["😀王甲工资4000元加","上加班費。"]|
|23|material-fact-source-date-pay-operand.test.mjs:138|10467|'4000.00' → null|跨页夹具契约|traditional numeral subunit continuation cannot be hidden ["😀王甲工资4000元","貳角。"]|
|24|material-fact-source-date-pay-operand.test.mjs:138|10489|'4000.00' → null|跨页夹具契约|traditional numeral subunit continuation cannot be hidden ["😀王甲工资4000元","參角。"]|
|25|material-fact-source-date-pay-operand.test.mjs:138|10511|'4000.00' → null|跨页夹具契约|traditional numeral subunit continuation cannot be hidden ["😀王甲工资4000元","陸分。"]|
|26|material-fact-source-date-pay-operand.test.mjs:151|10533|'4000.00' → null|跨页夹具契约|prefix payroll operand source layout ["😀王甲工资奖金+","4000元。"]|
|27|material-fact-source-date-pay-operand.test.mjs:151|10555|'4000.00' → null|跨页夹具契约|prefix payroll operand source layout ["😀王甲工资奖金乘","以4000元。"]|
|28|material-fact-source-date-pay-operand.test.mjs:151|10577|'4000.00' → null|跨页夹具契约|prefix payroll operand source layout ["😀王甲工资加班费","加上4000元。"]|
|29|material-fact-traditional-arithmetic-bounds.test.mjs:86|10599|'4000.00' → null|跨页夹具契约|traditional coefficient source edges next-block prefix=false fullQuote=false|
|30|material-fact-traditional-arithmetic-bounds.test.mjs:86|10621|'4000.00' → null|跨页夹具契约|traditional coefficient source edges next-block prefix=false fullQuote=true|
|31|material-fact-traditional-arithmetic-bounds.test.mjs:86|10643|'4000.00' → null|跨页夹具契约|traditional coefficient source edges next-block prefix=true fullQuote=false|
|32|material-fact-traditional-arithmetic-bounds.test.mjs:86|10665|'4000.00' → null|跨页夹具契约|traditional coefficient source edges next-block prefix=true fullQuote=true|
|33|material-fact-traditional-arithmetic-bounds.test.mjs:121|10687|'4000.00' → null|跨页夹具契约|bound stays attached through permitted layout 超過 next-block|
|34|material-fact-traditional-arithmetic-bounds.test.mjs:121|10709|'4000.00' → null|跨页夹具契约|bound stays attached through permitted layout 不超過 next-block|
|35|material-fact-traditional-arithmetic-bounds.test.mjs:121|10731|'4000.00' → null|跨页夹具契约|bound stays attached through permitted layout 不得超過 next-block|
|36|material-fact-traditional-arithmetic-bounds.test.mjs:121|10753|'4000.00' → null|跨页夹具契约|bound stays attached through permitted layout 將近 next-block|
|37|material-fact-traditional-arithmetic-bounds.test.mjs:174|10775|null → '4000.00'|跨页夹具契约|payment schedule source-layout boundary ["😀王甲工资4000元每月","15日支付。"]|
|38|material-fact-traditional-arithmetic-bounds.test.mjs:193|10797|'uncertain' → 'unsupported'|跨页夹具契约|proven source-layout arithmetic keeps unsupported classification ["😀王甲工资4000元×","2。"] quote="4000元"|
|39|material-fact-traditional-arithmetic-bounds.test.mjs:193|10822|'uncertain' → 'unsupported'|跨页夹具契约|proven source-layout arithmetic keeps unsupported classification ["😀王甲工资4000元×","2。"] quote="4000元×"|
|40|material-fact-traditional-arithmetic-bounds.test.mjs:193|10847|'uncertain' → 'unsupported'|跨页夹具契约|proven source-layout arithmetic keeps unsupported classification ["😀王甲工资4000元＊","２。"] quote="4000元"|
|41|material-fact-traditional-arithmetic-bounds.test.mjs:193|10872|'uncertain' → 'unsupported'|跨页夹具契约|proven source-layout arithmetic keeps unsupported classification ["😀王甲工资4000元＊","２。"] quote="4000元＊"|
|42|material-fact-traditional-arithmetic-bounds.test.mjs:197|10897|'4000.00' → null|跨页夹具契约|a bare mask or actual unknown is not exempted as arithmetic ["😀王甲工资4000元暫","定。"]|
|43|material-fact-whole-money-terminator.test.mjs:85|10919|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"整","tail":"USD","layout":"block","fullQuote":false}|
|44|material-fact-whole-money-terminator.test.mjs:85|10941|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"整","tail":"USD","layout":"block","fullQuote":true}|
|45|material-fact-whole-money-terminator.test.mjs:85|10963|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"整","tail":"港币","layout":"block","fullQuote":false}|
|46|material-fact-whole-money-terminator.test.mjs:85|10985|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"整","tail":"港币","layout":"block","fullQuote":true}|
|47|material-fact-whole-money-terminator.test.mjs:85|11007|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"整","tail":"？","layout":"block","fullQuote":false}|
|48|material-fact-whole-money-terminator.test.mjs:85|11029|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"整","tail":"？","layout":"block","fullQuote":true}|
|49|material-fact-whole-money-terminator.test.mjs:85|11051|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"正","tail":"USD","layout":"block","fullQuote":false}|
|50|material-fact-whole-money-terminator.test.mjs:85|11073|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"正","tail":"USD","layout":"block","fullQuote":true}|
|51|material-fact-whole-money-terminator.test.mjs:85|11095|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"正","tail":"港币","layout":"block","fullQuote":false}|
|52|material-fact-whole-money-terminator.test.mjs:85|11117|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"正","tail":"港币","layout":"block","fullQuote":true}|
|53|material-fact-whole-money-terminator.test.mjs:85|11139|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"正","tail":"？","layout":"block","fullQuote":false}|
|54|material-fact-whole-money-terminator.test.mjs:85|11161|'4000.00' → null|同页精确误放|single terminal preserves the existing attached guard: {"terminal":"正","tail":"？","layout":"block","fullQuote":true}|
|55|material-fact-whole-money-terminator.test.mjs:115|11183|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"人民币","tail":"？","layout":"block"}|
|56|material-fact-whole-money-terminator.test.mjs:115|11205|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"人民币","tail":"USD","layout":"block"}|
|57|material-fact-whole-money-terminator.test.mjs:115|11227|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"人民幣","tail":"？","layout":"block"}|
|58|material-fact-whole-money-terminator.test.mjs:115|11249|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"人民幣","tail":"USD","layout":"block"}|
|59|material-fact-whole-money-terminator.test.mjs:115|11271|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"RMB","tail":"？","layout":"block"}|
|60|material-fact-whole-money-terminator.test.mjs:115|11293|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"RMB","tail":"USD","layout":"block"}|
|61|material-fact-whole-money-terminator.test.mjs:115|11315|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"CNY","tail":"？","layout":"block"}|
|62|material-fact-whole-money-terminator.test.mjs:115|11337|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"整","label":"CNY","tail":"USD","layout":"block"}|
|63|material-fact-whole-money-terminator.test.mjs:115|11359|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"人民币","tail":"？","layout":"block"}|
|64|material-fact-whole-money-terminator.test.mjs:115|11381|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"人民币","tail":"USD","layout":"block"}|
|65|material-fact-whole-money-terminator.test.mjs:115|11403|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"人民幣","tail":"？","layout":"block"}|
|66|material-fact-whole-money-terminator.test.mjs:115|11425|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"人民幣","tail":"USD","layout":"block"}|
|67|material-fact-whole-money-terminator.test.mjs:115|11447|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"RMB","tail":"？","layout":"block"}|
|68|material-fact-whole-money-terminator.test.mjs:115|11469|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"RMB","tail":"USD","layout":"block"}|
|69|material-fact-whole-money-terminator.test.mjs:115|11491|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"CNY","tail":"？","layout":"block"}|
|70|material-fact-whole-money-terminator.test.mjs:115|11513|'4000.00' → null|同页精确误放|one explicit RMB suffix cannot hide a continuation after the ending: {"terminal":"正","label":"CNY","tail":"USD","layout":"block"}|
|71|material-facts-v7-assessment-independent.test.mjs:94|11535|[ 0, 0, 1 ] → [ 0, 1, 1 ]|接受层异常|identical words in another block cannot match the expected block event|
|72|material-facts-v7-round21-source-rate-author.test.mjs:78|11563|'40000.00' → null|跨页夹具契约|layout/detection preserves explicit unsupported rate "王甲每季度工资\n", blocks=true|
|73|material-facts-v7-round21-source-rate-author.test.mjs:78|11585|'40000.00' → null|跨页夹具契约|layout/detection preserves explicit unsupported rate "王甲每周\n工资", blocks=true|
|74|material-facts-v7-round21-source-rate-author.test.mjs:78|11607|'40000.00' → null|跨页夹具契约|layout/detection preserves explicit unsupported rate "王甲每\n周工资", blocks=true|
|75|material-facts-v7-round21-source-rate-author.test.mjs:78|11629|'40000.00' → null|跨页夹具契约|layout/detection preserves explicit unsupported rate "王甲工资按\n季度计", blocks=true|
|76|material-facts-v7-round21-source-rate-author.test.mjs:78|11651|'40000.00' → null|跨页夹具契约|layout/detection preserves explicit unsupported rate "王甲每週工資標準為\n", blocks=true|
|77|material-facts-v7-round25-terminal-safety-independent.test.mjs:45|11673|'4000.00' → null|同页精确误放|a cropped terminal cannot hide the attached continuation: ？|
|78|material-facts-v7-round30-money-author.test.mjs:96|11692|'4000.00' → null|同页精确误放|neighbor payment question remains unavailable despite local sentence cut|
|79|material-facts-v7-round34-money-author.test.mjs:112|11715|null → '4000.00'|同页姓名误降|unique name remains anchored across wage layout {"owner":"王近","layout":"block"}|
|80|material-facts-v7-round34-money-author.test.mjs:112|11738|null → '4000.00'|同页姓名误降|unique name remains anchored across wage layout {"owner":"王约","layout":"block"}|

本复核是金额模块作者对未参与实现的source-layout初版做只读失败分类；独立于此次source实现，不是人工材料验收。它不证明后续修版通过。请求配置GPT-6.1 Sol ultra；未独立核验实际后端。
