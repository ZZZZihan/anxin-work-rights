# PR #40 第三轮审查修复与独立验收

本页追加记录 `b6419b2c36444171356a2c22fe8107bbfe1da411` CI通过后自动审查发现的三项P2。前两轮证据保持原样；本轮修复当前生产路径，不改冻结v2/v3协议或历史实验分数，不把程序守护称作模型能力提升。

## 最小复现与修复

1. **同字不等于同一处线索。** `王甲2024年7月完整应付工资8000元。李乙2024年7月完整应付工资8000元。` 只提王甲money/date两项时，旧诊断把两处金额和日期都标covered。运行时现在核对source ID/SHA、唯一quote/value与Unicode源文位置，仅对应span可覆盖；第二处money/date为false，显示possible_missing。歧义引用不猜首处，冻结signal识别集合及计数不变。
2. **修饰语不能在去重时消失。** 相同labels/value的“约8000元”先于精确“8000元”时，旧去重拒绝后者。新增生产运行时适配器先保留整包schema/40项限制，再复用冻结单项校验，结合完整源文后的规范化status/value、归属提示和唯一位置去重。近似/范围/待核不压掉精确事实，归属错误不压掉正确归属；同位置的全引文/裁剪引文仍可去重。原raw、输出格式、原index、候选ID和无效项拒绝理由保留。
3. **成功取消须确认消费待重试记录。** 删除证据时触发器已经持久记录任务，原路由远端DELETE成功后未清journal。[真实基线失败](http-cancel-before.json)记录删除200/pending=false、远端任务404但journal仍1条；服务离线后的本人PATCH又DELETE一次并误报pending。现在仅成功后按user/case/job清记录；远端或数据库确认失败均保留待重试，其他用户、案件与任务不受影响。

## 验证记录

- [新增50项去重独立基线](dedup-independent-before.json)：纯b6419b2为14通过/36失败；覆盖修饰词、范围边界、先后顺序、裁剪引文、同位置去重、错误归属与正确归属并存、原始回答及协议限制。
- [去重与位置覆盖独立80项](dedup-coverage-independent-after.json)：50+30全部通过；另[取消实际D1/R2独立7项](cancel-independent-after.json)通过。
- [最终独立整合122项](independent-integrated-after.json)：新50+coverage30+证据取消7+store35，122/122通过、0跳过，代码文件与主树哈希对齐。[独立验收报告](INDEPENDENT_REVIEW.md)记录由未实现相应模块的Agent交叉复核；[运行时去重只读复核](RUNTIME_DEDUP_REVIEW.md)另保留12项补充动态检查及其较早46项版本的范围说明。
- 主Agent最终 `npm run check` exit0：31个Vitest文件848项通过，类型/ESLint/构建、数据/运行时、材料与事实运行时通过。macOS按既有约定跳过1项Linux Tesseract，精确最终提交的Linux CI另行核对并记录于PR。
- 新增实际facts路由/D1检查：新poll保留近似与精确两候选及原索引，原raw和无效拒绝理由保持，重读一致、无自动确认/计算。模拟已保存历史结果后GET不重解析、不迁移旧拒绝记录。
- [取消Agent实际HTTP14组](http-cancel-agent-after.json)通过，包含原8组及证据删除6组：成功后离线无多余DELETE、失败保留重试、精确owner/case/job、重复删除不取消新任务、事务回滚、远端成功而ACK写失败后的幂等恢复，cleanup PASS。
- [最终构建取消HTTP14组](http-cancel-final.json)再次通过，使用主树最终dist，cleanup PASS。[最终真实浏览器](browser/README.md)验证相同block重复8000元及2024年7月仅首处覆盖、遗漏提醒可见、原raw仍2项、没有自动确认或计算；主Agent目视复核两张截图，控制台无错误/警告，临时资源全部清理。
- 主Agent在浏览器与取消环境清理后串行复跑[最终事实HTTP10组](http-facts-final.json)，全部PASS，未复用旧结果。
- v6 preflight通过，36项冻结文件未变；本轮未运行模型/训练，未改变原始实验输出或评分。

## 残余边界

覆盖检查仍沿用有限启发式信号，不保证识别所有金额、日期或真实语义；covered只说明该原文位置有候选，不说明事实正确。有限归属语法仍可能使复杂但合法材料要求人工核对。

新的去重只用于新提取结果；已经保存的旧候选和拒绝记录不会在GET中静默重解析，历史受影响记录需重新提取并人工核对。已有人工确认不会自动撤销。原始模型回答始终保留。

取消队列仍依赖后续本人案件请求重试，不是后台自动清扫。合成D1/HTTP与浏览器技术验收不等于真实材料、法律专家或用户人工验收。仍依赖PR #36，未合并、未部署。
