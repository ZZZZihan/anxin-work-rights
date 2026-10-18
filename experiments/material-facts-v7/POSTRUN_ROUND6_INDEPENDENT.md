本轮未发现新的合并阻塞。已修复原首跑 `result-manifest.json` 只按解析后 JSON 比较、不能保证封存字节未变的问题；同时完成对运行脚本、共享锁、v4 历史复验及 v5 产物的技术复核。当前 v5 manifest 为 `eb79da00daa92966f081a2eba35d7355e258a45d18411570834efc62d632e32e`，35 个当前代码文件的摘要全部吻合。原 freeze、首跑 manifest、v1–v4 产物和旧收据保持原字节。

职责分开记录：本 Agent 实现了原 manifest 字节门禁；未参与实现的 money Agent 对该补丁做了静态复核，并独立复跑 6/6 通过。对于 money 的运行脚本、data 的共享锁以及主 Agent 的 v5 版本链，本 Agent 是未参与实现的审查者。请求配置为 GPT-6.1 Sol / ultra，无法独立核验实际运行配置。

- 原缺口有真实红基线：测试统计 1 通过、5 失败；三种 JSON 完全等价的重序列化均被旧历史 CLI 返回 PASS，导出 API 也进入了回调。修复后 6/6 通过，原字节仍通过完整历史复验，等价改排被拒绝。入口与实际传入旧验证器的临时副本均核固定 `3733e4c…53ee`，旧归档代码不变；未给模块导入或运行前预检添加结果文件要求。
- 原 36 份代码快照和 60 个首跑结果文件的兼容/损坏检查 16/16 通过。v4 原 8 项门禁仍为 8/8；只将执行依赖改为先由 `withCorrectionV4Code` 恢复封存 v4，再执行原断言。脚本新摘要为 `c7d83fd26cfcd7c3b82d5e9acccb9e5e195efc77cda2407e411f6896f21b8ef5`，旧脚本摘要及旧收据不重写。
- 当前主树的合成进程与锁检查 19/19 通过，含 10 项运行生命周期及 9 项共享锁检查。实测延迟落盘的 requesting 事件不会留下退出后的请求计时器；两条输出流各有 20,000,000 原始字节上限，落盘变慢时暂停读取，并保留跨块 UTF-8；忽略 SIGTERM 的合成进程被强制回收，随后 PID 检查为 ESRCH。实际 diagnostic runner 的两项集成检查确认：终态写入前 freeze 和另一 runner 均不能进入；freeze 发布后 runner 不能分配新 attempt。
- v5 新门禁 4/4 通过。只给临时副本中的共享锁 helper 或 run 文件加一行无行为注释，真实 v5 `--check` 均先完成历史链，再明确以 `Correction v5 manifest changed` 拒绝；没有模拟旧验证器，也没有靠夹具超时制造拒绝。测试结束核对源树全部 35 代码和历史摘要不变。

以上最终检查合计 53 个 Node 测试统计项（含父测试）；分别来自 6、16、8、19、4 项检查，不将此前 8 项生命周期的重复执行另加人数或覆盖量。四个本轮变动 MJS 文件使用主树 ESLint 配置及真实相对路径做 stdin 检查，均退出 0；初次跨目录直接执行被忽略的警告不算验证通过。

Python 标准库独立检查没有导入原 scorer 或 verify：逐个检查完整且互斥的 pairs/missing/extra 索引分区，重新计算 36 案 × 6 层的 216 个 TP/FP/FN 分区以及 precision/recall/F1。每个 backend 仍为 12 案、43 条预定事实，三份 v5 report 与 v4 **逐字相同**。这不重做既有来源/事件语义复核，也不以相同分数证明模型改善。

- rules：raw/accepted basic 均 2/0/41，relational 与 strict 均 0/2/43。
- Qwen：raw basic 16/47/27，relational 10/53/33，strict 8/55/35；accepted 分别 16/35/27、10/41/33、8/43/35。
- DeepSeek：raw/accepted basic 均 34/17/9，relational 27/24/16，strict 25/26/18。

上述三元组依次为 TP/FP/FN。非空派生 amount 分别为 rules 2、Qwen 8、DeepSeek 10；全部报告中无 review issue 的精确金额仍为 0，calculation_authorized 仍为 0。accepted、派生金额、可用于核算的事实和计算授权各有含义，不能相互替代；本轮完整性修复不消除既有语义错误或防御误警。

边界：锁只协调使用该协议的 diagnostic 与 freeze，不处理任意外部写者。owner 被杀后保留锁，需要核对 PID/主机及失败记录后明确处理；不按文件年龄自动删锁。释放时校验目录与 owner 文件的身份和内容，遇到变更、未知文件或清理失败时保留证据，原回调错误不会被吞掉。freeze 竞争测试保留实际 createFreeze 关键函数体，但无关数据/旧版本/模型预检用合成桩；实际 runner 集成也使用合成 worker。manifest 双检查不是操作系统级原子快照，不声称防御有任意写权限的恶意并发修改。

本 Agent 未请求模型、未启动真实模型 Worker/HTTP 服务、未 build、未训练、未部署或推送。主 Agent 另行报告 npm check 已退出 0（1789 Vitest/46 文件、494 runtime、67 materials 通过及 1 Linux skip、Python 9+11+16）；这些是主侧整合检查，本报告不冒称独立重跑。主 Agent 随后报告：未变动 v5 的 `--check` 已退出 0，额外 v5 门禁复跑 4/4 通过，scoped ESLint 退出 0，v5 `--write` 已成功；同样单列为主侧验证。

原始证据位于 `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-review/postfreeze-evidence/round6`，复制到仓库时对应 `experiments/material-facts-v7/postfreeze-evidence/round6/`。新 JSON 收据逐项绑定 10 个证据文件摘要、35 个当前代码摘要、测试摘要及历史摘要；旧报告和旧产物不改。证据包括真实红/绿日志、当前整合 19 项进程/锁日志、v4 与 v5 门禁日志，以及 `v5-independent-report-check.py` 和其完整输出。
