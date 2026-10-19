ROUND20 金额作者自检

固定基线为 CODE commit 37e304de5a1beae2a3f82e91d40dfc1983ac3324。仅 OWN 的 material-money-v4.ts 与 material-fact-arithmetic-review.ts 参与产品修改，另新增作者测试；主树、冻结文件、原始输出与标签未由本 Agent 修改。

两个最小反例修前 0/2 通过：四万元乘以提成比例误为 40000；人民幣四萬圓不支持。最终同一 117 项测试对固定旧版为 44 通过、73 失败，对补丁为 117 通过。第一次 114 项红/绿也原样保留，没有改写旧失败。

修改仅在锚定后支持 萬→万 的严格解析副本；原始 value/quote/matchedText/code-point span 保留。萬、億、兩同时进入数字与运算边界，后两者没有新增精确解析。命名操作数要求明确算符并以系数/系數/比例结尾，汉字名长 2–16 字；允许既有 OCR/格式字符检测副本，标点与独立事件仍隔断。加班、除外等普通词不作为新单字算符路径。没有进行代数求值。

合成测试包含完整原文、裁剪 value/full quote/short quote、原始 source、相邻 OCR block、强制旧 exact 读时降级、旧 null 不升级、emoji/补充平面字符位置、混合角分、外币/约数/区间/畸形数字与正确月费率。915 项既有 native 和 550 项既有 Vitest 均通过；这是实现者执行旧测试，不替代本轮非实现者独立复核。定向 ESLint exit 0。

money 将 candidate.subject 传给 DATA 协调的 optional-subject currency API。固定旧基线的 JS 原接口会忽略第三参；最终类型和币种姓名组合验收需要该 API 的新实现。临时只读 DATA WIP probe 确认王美元/李港元保留 exact，而以美元/按港元伪主体仍 null；不将这四项探针称为最终独立验收。

未运行模型、HTTP、训练、部署、全项目检查或深层历史 CLI。本证据仅限本轮合成及定向既有回归；主 Agent 负责集成后的全项目和 HTTP 检查。系数后缀 grammar 之外的任意中文算式、超过长度上限的变量名称和所有传统数字并非本轮声称穷尽支持的范围。

具体产品、测试、patch 与日志 SHA-256 见 author.final-receipt.json。全部红测与首次绿测保留。
