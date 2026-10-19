# 最终人民币与无金额描述交接（v2）

最终 money SHA `7aac6f8e52cd95ca77a71f443f10450c8f27d9bcafeb9d7cb3a0cf2450d5cbad`；唯一新作者测试 SHA `0414c7d896986ee8a057c903467b952c2e3062a8567b4743141b1a57d5ac017f`。主侧可复制这两个文件；请不要用初版f46覆盖最终版本。

四类有限修复与原文/历史约束见 `EXPLICIT_RMB_HANDOFF.md`；最终版本另外处理非实现者发现的 comparison 交叉：`人民币2分内/之内` 的规范比较需要保留同一明确人民币证据。先保留原有剥离外层币种以识别限定词的行为，仅当内部 literal 无法精确比较时恢复同一个人民币前缀。`人民币不满四万元` 的旧key继续成立，裸 `2分内` 不获得币种，不产生计算金额。

实测证据：

- 同一最终141项在固定52c275旧money+旧lib上87通过54失败；最终money+主侧range7dd7/currencya64c/source8921依赖上141通过。
- 修comparison前f46的141项139通过2失败已保留；初版money和138项作者测试均有字节快照，旧receipt/patch不覆盖。
- 最终money相关7套现有native639通过；3套Vitest281通过；两文件syntax与scoped ESLint退出0。
- 原有109/8、137/1，以及误选旧4萬圓预期造成的636/1日志全部保留并在receipt解释，不混称成功。

作者仅在macOS Node26.11执行合成/局部测试。没有启动HTTP、构建或全check，没有深历史链、模型请求、训练、生产/Git操作。主侧集成、双runtime独审、HTTP及CI分别记录。最终JSON为 `explicit-rmb-author-receipt-v2.json`，补丁为 `explicit-rmb-money-v2.patch`。
