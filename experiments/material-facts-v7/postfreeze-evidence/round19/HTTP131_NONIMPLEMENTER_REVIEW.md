# ROUND19 HTTP131 非实现者复核

结论：本轮 HTTP 夹具与最终报告没有发现新的阻塞。审阅者没有参与新增13项的实现，没有亲自启动 HTTP、Worker、模型、构建或深层历史链；本回执来自脚本、已完成报告和原始序列的只读核对。

最终有效对照是旧构建 `http131-before-valid-02cf.json` 的 **122 PASS / 9 FAIL**，以及最终新构建 `http131-after-final.json` 的 **131 PASS / 0 FAIL**；两者 cleanup 均为 PASS。原118项在两次报告中全部通过。仅移除 ROUND19 新区块后，现脚本与 Git 中02cf原118脚本逐字节相同；原有断言没有被放宽或替换。

9条有效红应分别表述为：4条按单位费率错当精确总额、2条年月日期分隔造成金额保守误置空、3条没有货币表达的比例被接收。不能统称9次精确金额泄漏。两条真实减式原本已经安全为 null，含钱50%公式也原本保留 null；正确声明的繁体小时费率仍精确，这4项是正反控制。

前两次报告原样保留。第一份119P/12F混入6条默认period与原文不符的夹具错误；第二份120P/11F中两条只是status期望误写，把原有range/uncertain安全状态误要求为unsupported。这些问题已修正后才形成最终122P/9F对照。第二次与第三次旧报告的132项合成raw/candidates/finish_reason序列相同，说明status修正没有更换合成输出。

最终有效旧报告与新报告共132项合成输出的raw字符串、候选对象和finish_reason按顺序逐项相同（仅排除随机evidenceId/jobId）。规范化序列SHA-256为 `fc9d5d384e45007ba1f2246a590ad0f7fc38b3c73445e7cf4f4533fdfbf94b23`。比较时没有重新解析或重写raw字符串。

新增13项的10条钱候选路径均调用原有raw/原value/quote/representation/sourceSha256/Unicode码点位置检查，其中7条null路径还在临时D1中强制注入旧exact金额，再经真实GET确认读时降级且D1与历史未被改写。3条无金额比例验证拒收、原raw与rejected记录保留，GET不自动确认或计算。公共extract与读取均检查canCalculate=false、确认值为空、calculation=null以及due/paid值未填充；金额比例不被求值。

最终重启检查130份持久快照，包含全部13条新增场景；有效旧红只检查121份，因为9条失败在前置断言退出，未执行其后续history/重启入集。重启断言核对持久state、history、job/material raw及未确认/未计算状态，没有重新逐条断言派生amount。因此可以声称重启不改持久raw与历史，不应扩写成所有派生金额重启后均再次验算。

旧构建使用此前ROUND18成功fullcheck留下的02cf dist。`old-http-build-receipt.json`明确只记录旧HTTP运行后的产物哈希及原构建日志来源；本复核没有把它称为新建的精确旧构建，也没有声称取得运行前后dist字节一致证据。

最终runner SHA-256：`ceb39aeb013789756d96dd9534a9901ab27c705bdfb67ae7eb5b2aa01fd93aed`。

有效旧报告SHA-256：`7e211c271016123c2c47baf620cd61ba681310419f2bfb503a78af32cd47aa7b`。

最终新报告SHA-256：`7922a0e1bf6c85e994ec5345ba09349b2485b1019523602b5ce3593c4ffa0bfa`。

全部输入路径、哈希、类别和验证边界见同目录 `http131-nonimplementer-review.json`。这些是合成模型结果注入下的真实HTTP软件回归，不是真实模型输出或业务/法律验收。模型配置沿用主任务请求的GPT-6.1 Sol ultra；此复核未独立验证实际后端运行配置。
