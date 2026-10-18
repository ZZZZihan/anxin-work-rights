# v3 报告与封存链路独立技术复核

复核完成时间：2026-10-17T03:28:01Z。结论：下列修复已完成并复验，当前未发现阻止正式冻结的报告或封存链路缺陷。结论只涵盖源码审查、公开开发夹具、临时合成运行记录和离线回归，不代表正式模型成绩或人工法律专家验收。

## 范围与独立性

本轮只读审查 `reporting.py`、`freeze.py`，并核查它们与 `run.py`、`assess.py`、`dependencies.py`、`guard.py` 和冻结 v2 Qwen worker 的接口。复核者未参与本轮 reporting/freeze/run/assess 的主实现；复核者此前参与 facts/guard 实现，因此这里的独立性限定于报告与封存链路，不能扩大为事实模块由完全不同作者复核。

请求的子 Agent 配置为 `gpt-6.1-sol`、`ultra`；这是任务请求配置，不据此宣称已独立核验底层实际运行配置。本轮未读取新留出集作者目录、新 test/gold 内容或正式模型结果；只在封存完成后读取 `freeze.json`，对照本记录列出的源码哈希。没有调用真实模型、API、训练或 Git 操作；没有修改 v3 根级源码和测试。所有独立 probe 写入系统临时目录，随后清理。

## 已发现并关闭的问题

1. **全新进程导入到 v2 同名模块。** 原 dependencies 把 v2 放在搜索路径首位，导致 `reporting.py --help` 导入 v2 freeze 并因缺少 `verify_run` 直接失败。主 Agent 已在显式加载依赖后恢复 v3 优先；另把 guard 的手动路径插入统一收口到 dependencies，消除“先导入 guard 再导入 reporting”的第二种导入顺序故障。复验两个 CLI 的 `--help` 均正常；全新进程依次导入 guard/freeze/assess/run/reporting，并断言五者 `__file__` 都在 v3。
2. **Qwen worker 没有原生 `request_messages` 字段。** 冻结 v2 worker 原生只记录 `rendered_prompt`，若要求所有后端直接携带前者，真实 Qwen 记录会被拒绝。主 Agent 已由 v3 build_messages 缓存实际组装的消息，在 Qwen finalize 写入 receipt；freeze 同时逐字核对消息和实际 ChatML 非思考模板。独立 probe 确认正确模板通过、篡改 rendered_prompt 被拒绝。本复核未加载真实 tokenizer；主 Agent 对真实开发输出的模板核对属于另一份实跑证据。
3. **匿名编号可被穷举反推后端。** 初版编号由公开的后端、案例标识和输出构成。现为带 32 字节随机 salt 的编号，salt 仅保存在私有 mapping，blind 包去掉显式 case_id、后端和实验臂；summarize 使用已保存 salt 重建整个包和映射。相同案例、同一后端、完全相同 canonical 输出合并评审，再映射回对应实验臂。措辞或材料内部标识仍可能让审查者推测来源，不能据此宣称完全盲法；mapping 在判定锁定前必须不提供给语义审查者。
4. **跨平台相对路径分隔符。** source/dependency 清单和 run protocol 现统一使用 `as_posix()`。该修复消除了同一字节文件在 Windows/POSIX 上仅因路径分隔符不同而校验失败的问题。

## 实际检查及结果

- 全新进程 `reporting.py --help`、`freeze.py --help`：通过；不会因此读取新数据。
- 先导入 guard 的全新进程模块身份断言：通过。
- v3 完整测试发现：**79/79 通过**。
- 冻结 v2 完整测试发现：**68/68 通过**；仅有旧 synthetic HTTPError 对象清理的 ResourceWarning，不影响退出状态。
- 额外独立 probe 实际执行 `reporting.context → freeze.verify_run → finalize/assess → make_packet → summarize`，不是仅 mock 评分结果。数据为 8 条新造开发夹具、两个后端，共 16 个计划结果位置；使用相同真实 v3 执行与评分函数，不运行模型。具体断言如下：
  - due 未知但模型填 0：无 gate 发生一次危险本地工具调用，gate 没有调用工具，拒绝不消耗尝试。
  - 明确确认 0 和 due 小于 paid 的负差额均可成功执行。
  - 每后端缺失一条、运输失败一条，仍保留全部 8 条和 6 条非终态计划分母。
  - 两条程序终态对模型均为 N/A，系统终态信用不加给模型。
  - 包覆盖所有应追问或实际追问输出；本夹具得到 6 个匿名待评输出，隐藏显式 case ID、后端和实验臂。
  - 删除一个判断、重复一个 review_id、替换 packet_digest 均被拒绝。
  - 把所有实际追问语义判为 false，结构字段匹配的追问也失去综合正确信用；本夹具 gate 非终态综合正确数由 4 降到 2，合法的两个调用保留。
  - 改动 outcome 后，旧评审 mapping 无法继续用于汇总；改动 Qwen rendered_prompt 后，verify_run 拒绝。

## 证据绑定判断与边界

当前报告身份绑定输入、标签、freeze 以及每后端 protocol/results/inputs-visible/outcome 的完整文件哈希。assessment 从原始运行记录重新计算；逐条 parser、protocol acceptance、fact revision、无 gate 和有 gate 的执行 receipt 与确定性重放一致才接收。已有匿名包与 mapping 必须与当前运行重新生成的结果完全相同；semantic 的 digest 和精确覆盖集合必须匹配。实际追问综合正确采用结构正确 AND 独立语义通过，不能因漏评而自动放行。本复核未找到通过漏评、重复评审或替换上述证据而获得虚高报告的可复现路径。

以下是已披露限制，不构成本轮 Mac 本地运行的冻结阻塞：

- v1 common 和 v3 部分文本 I/O 仍采用系统默认编码；非 UTF-8 locale 的系统需要显式 UTF-8 运行环境，例如 `PYTHONUTF8=1`。本轮未做 Windows 真实执行。Qwen MLX/Metal 推理本身也是本机平台限定，路径清单可移植不等于推理后端跨平台。
- 正式报告验证依赖静止的、已完成写入的运行目录；不声称提供跨进程原子快照或防止任意并发文件替换。freeze 是可复现哈希清单，不是第三方签名时间戳。
- 语义评审为另一 Agent 的技术判断，仍可能猜到措辞来源，也不是人工法律专家验收。
- 真实算术异常若与确定性重放不一致，正式报告会拒绝该运行；不能丢弃异常行后发布百分比。调用后报错仍计危险调用的行为已有独立注入回归；这不构成外部工具故障恢复的真实测试。

## 与正式 freeze 对照的最终哈希

正式 freeze 时间：`2026-10-17T03:27:29.332886+00:00`。

`freeze.json` 文件 SHA256：`a85f7d67a110b731ba818f418390079a8f6fd105cc34a1983bf8e64be5bb0cc6`。

以下五个文件的本机实际字节哈希均与 freeze 的 source_sha256 对应条目一致：

| 文件 | SHA256 |
| --- | --- |
| reporting.py | 6589a43810a3e71f861ed40930b6946b967af5ea5192eed9dc814eabe9709e63 |
| freeze.py | 66b6600efb1b3e106186fda35709296aa0eb66b190268e4fc9e412ddb9b6c44b |
| dependencies.py | 27b3fb4cdb4d3a6f7a262c1f5b64a8129b5f70b2d233b2c5e6ce473651d879d0 |
| guard.py | af08d1db4f0390a7f9fa163ed83d239a67144bbdb38292239c7e199d33e1403c |
| run.py | 27ac03b9d10ddd9260b900d4c4b7d7b558cad20b3698f38fa082f6cf402cfae6 |

本记录写在封存源码目录之外；不改动 freeze 所覆盖的根级源码、测试或评分口径。若上述源码字节发生变化，本结论不能直接沿用。
