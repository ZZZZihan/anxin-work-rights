ca3 金额别名及比较键最终交接（追加 v2）

最终仅两文件：lib/material-money-v4.ts 与 scripts/material-fact-traditional-qualifier-comparison.test.mjs。完整 SHA、补丁和原始日志路径见 money-alias-bounds-author-receipt-v2.json。旧回执及全部失败证据未覆盖。

完整旧 ca3 的 138 固定夹具 71 PASS / 67 FAIL → 初修138 PASS；三繁体工资尾词交叉复核再实测150项 147 PASS / 3 FAIL → 最终150 PASS。尾词只取当前 assess 已允许的工资/劳务费/劳动报酬简繁字符类；非法或重复叙述不剥除。六层匹配实际TP1，金额仍null且不授权计算。

最终既有金额Vitest 550/550、语法2文件、限定lint均通过。先前七套旧native 955 PASS / 2 FAIL 是两个被本轮需求取代的‘兩萬圓/一億圓必须unsupported’断言，原日志照存；父Agent已报告将两值移入原exact helper正例，不是静默删断言。作者没有篡改该旧测试。

validateLabel在ca3有literal fallback，实际没有“比较键null导致金标停止”；真实问题是相同事件/相同界限的不同数字拼写无法匹配。不同界限词、前后位置、上下界与exact绝不合并。新兩/億仅解析副本折叠，范围检测副本同折叠，防新增支持放开传统区间端点。原raw/CP/历史存储不变。

未在作者处执行HTTP、构建、全量检查、CI、深链或正式封存；模型/训练/部署/提交/推送均0。
