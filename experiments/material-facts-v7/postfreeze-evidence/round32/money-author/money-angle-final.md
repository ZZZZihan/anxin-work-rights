# ROUND32 角普通词与角币边界修复交接

产品与作者脚本已锁定，固定35b同一67项检查由26通过41失败到67通过；旧词界36、混合元角分191、小时费率130合计357项全部通过，范围lint退出0。实现者实际运行环境为Node26.11.0；不把这组自检称作独立审查或最终整合验收。

原始四词“五角星/三角洲/八角亭/五角大楼”此前金额本来就是null，实际错误是classifier标为monetary并被合法money协议接受。本轮完整数字加有限角词全值规则拒绝这些候选，保留模型原raw、rejected索引和原因。

同族实际精确泄漏另记：人民币五角星此前fullparse/fresh变成0.50，裁到人民币五角同样0.50。共享currency词表现识别角星/洲/亭/大楼(大樓)，既有parser、candidate quote和full source guards共用；同句、换行和相邻块的星都不能被裁掉后取得精确角币。raw/quote/value/Unicode码点位置不变，历史forced exact只降null，已有unsupported/null不升。已有普通词历史记录仍保留，不擦除旧提取。

新增API是currency-review中的isNonCurrencyAngleCountWord(value:string):boolean，仅对完整角度、角形、角星、角洲、角亭、角大楼/大樓成立；money classifier还要求整个value为数字+该词。原角度/角形词界复用，不新增泛化词典。人民币五角钱/人民幣五角錢仍0.50；五角钱仍可人工核对且不擅补缺失币种。拉丁文字、未知尾词和含真金额的复杂串不被完整词规则一律拒绝。独立句号/逗号或其他主体的普通词不污染已完整角币。

未执行模型、HTTP、scorer、build、fullcheck或历史CLI，未修改ROOT/CODE、range/event/source、冻结代码/数据/原模型输出，未提交推送。请求GPT-6.1 Sol ultra，实际后端未独立核验。有限词表不能声称覆盖所有普通词，合成回归也不增加自然案件覆盖或业务验收。

精确35b差异见money-angle-fixed35b.patch；原始最小probe、固定前测与后测、既有模块日志和执行JSON均append-only保存。copy index列出产品、测试和本轮必要证据的准确SHA。
