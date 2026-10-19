HTTP148 与后置界限的非实现者复核（范围闭合阶段）

本复核仅针对 ROOT 实现的 range 后置界限与 HTTP runner；复核者同时承担 money/arithmetic 的本轮实现，后两模块的自检不混称独立审查。未修改任何产品或 ROOT 文件。

原 131 场景保留是逐字节核对结果：删除唯一 ROUND20 新块后，整个 runner 与 37e 原文件完全相同。17 新场景包含 11 个应 null 的强制旧 exact 场景，以及 6 个合法 exact 场景；均调用 rawAndLocations 核对原始队列输出、representation、quote 和 CP 锚点，GET 后比较完整 D1 revision/state 与 history，且加入 worker restart 持久快照。报告以 wx 建立，保留失败观察、syntheticOutputs、serviceCalls 与 cleanup。旧 cleanup 和 process-group helper 本轮未变。

初次只读探针发现四万元不到三天付清、四万元未满三个月已付清等时长后缀可用性回归，已通知 ROOT。ROOT 在新增后置词后只排除紧接明确数字+时长/次数单位的情形。最终 range SHA 为 2df173877cde687724caaf95262c141482ca80c0adbb4be7f02181cd2c497be7；作者脚本 SHA e9656f7f46fd9adbb74fc7f2f6477940670b547eba1efec8c134f4b5e6906dc1。我独立运行该脚本，实际 97/97 通过（最终新增时间/次数检查 12 项；中间草稿 14 项不作为最终运行数）。自己的 13 行 old/current 探针也确认新增误拒闭合，真金额不到/不止/开外仍 null，标点另一事件不污染。

四万元不止一次催讨、四万元不足三天便付清的 whole literal 在 37e 已为 null，本次仅恢复 crop quote 原来可用的精确值，不宣称改善了既有 whole-value 全局限制。当前有限例外不等于穷尽自然语言消歧，跨版新输出不重写旧冻结。

已只读核对主侧旧 HTTP148 报告：133 通过、15 失败，15 个失败全部属于新增 17 场景，原 131 全通过；另两个真实外币控制本已通过。cleanup PASS。此时尚未收到主侧新 HTTP148 完整报告，不声称最终 HTTP 148 绿，也未自行重跑 HTTP、全项目、模型或深层 CLI。具体哈希及日志见静态、range-final 收据；待主侧报告后另新增比较收据。
