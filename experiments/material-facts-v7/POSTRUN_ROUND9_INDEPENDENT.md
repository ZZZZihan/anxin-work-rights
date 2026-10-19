本轮四项修复已完成非实现者复核，在这四项范围内未发现剩余阻塞。范围是 round9 的相对日无金额与相对日工资总额两项，以及随后 round10 的历史复验超时和 memory monitor 未落盘就结束两项。后来新增的计价桥、符号系数、连接词区间、阿拉伯元角分四项已另交 round11 处理；本结论不表示整个 PR 已无缺陷、已获人工业务认可或已部署。

4305959322：parser 仅在完整的“日或相对日 + 既有工资名词”无金额语法中返回 not_monetary，覆盖今日工资、每日工资、某日工资等明确无金额名称。未知、遮盖、概数、区间和真实数值没有被全局清除。独立测试经过 parser、runtime ingest、raw 保存、历史候选显示与评分六层，确认新候选拒收时原 raw 仍保留；历史 representation 不被静默删除或升级，空金标的 raw 三层仍各记一个 FP，accepted 三层为空。

4305959326：source-review 只对没有显式标准的裸“日(基本)工资”加入有限相对日前缀豁免。每日、每天、日薪、日工资标准、后置 /日 等真费率优先，姓名尾字也不能冒充“今日”等期间。独立覆盖 full quote、最小金额 quote、源文完整 block、Unicode 码点、历史 forced-exact 复核、历史 unsupported 不自动升级、真实日期金额和另一句费率。最终 48 项在真实 36ad568 原实现为 18 通过、30 失败，最终 parser 912f97c3… / source 315e2baa… 为 48/48；整合应用源码也实际独立复跑 48/48。

memory monitor：最终 run.mjs 72646a5a… 用一个 monitorTask 覆盖完整的 memory 查询和 append，清 interval 后仍等待该 task 与 stdout 写入队列全部完成，才写 terminal results/outcome 并释放共享实验锁。晚到查询或写入错误记录 Error.name 和 monitor_error，不因 worker 已退出而丢弃；terminate 检查自身子进程是否仍活着。实现者用 append 屏障回归；本审查者另用真实合成 sysctl 子进程查询屏障，保持查询未完成、worker 已关闭时实际尝试共享锁。原 runner 两项均失败，最终两项均通过：成功查询落定后才能终止归档和解锁，晚查询错误使 attempt 失败并保留原 finish_reason。没有调用真实模型或制造主机压力。初次名为 monitor-query-before-red.txt 的文件实际已是更新后的绿色运行，原样保留并附上下文；真实旧红是另取确定旧 runner 后的 monitor-query-baseline-red.txt，未把初次绿色文件冒称红基线。

历史执行：旧 archived v5 内部的 60 秒是已报告的真实风险，本机原入口实际 41.117 秒 PASS，没有复现 60 秒超时，不伪造一次原始红。data 实现者的最终原生完整旧链经显式策略为 43.465 秒 PASS，保护的 412 份文件字节不变。本审查者审阅两次实际日志并保留同字节副本。新增 historical-execution-v1 / policy-v1 只对精确白名单的只读复验调用生效；当前父 controller、wrapper 和历史 gate 均接入同一 API。旧 .snapshot 字节完全不改，不使用 PASS 缓存或改写源文。

策略是每个根进程共享一个绝对 15 分钟预算，嵌套每层预留 2 秒清理时间，后续兄弟调用不能重置预算；外部 gate 父上限 960 秒。只有子进程环境携带显式状态与 preload，stdout JSON 保持原样，策略回执写 stderr。Symbol.for 注册表在不同临时模块 URL 间复用真正 native 函数和同一 preload，避免重复包装；异哈希冲突拒绝。独立 4 项原生探针通过，覆盖非白名单/写命令拒绝、绝对预算递减、伪造和耗尽状态拒绝、双 URL、真实验证错误透传及无关子进程原有超时不被放宽。受控短预算测试是机制验证，不能当成本机重现原 60 秒缺陷。

v8 独立 5 项门禁全部通过，用时 127.04 秒。正向核对 43 个依赖；真实 v7 wrapper 对历史清单同 JSON 空白改写和归档源代码字节变化均在进入 callback 前拒绝。两次完整 v8 CLI 负门禁先运行真实历史链，再分别以 exit 1 拒绝当前清单空白改写和当前执行适配器仅注释漂移，实际用时 72.34 秒与 53.50 秒；拒绝原因是预期校验断言，非夹具超时。保护清单的前后哈希一致。此前历史 gate 的原断言保留，改为在对应精确归档内执行并使用显式执行 API。

独立产物检查不导入原评分器。验证原 60 个结果文件、首跑 manifest、freeze、v1–v7 manifest 固定字节，v7 的 39 份归档代码快照，v8 的 43 个当前代码哈希，以及 v8 精确五文件集合。逐案检查 pairs/missing/extra 的完整互斥索引分区，重算 3 backend × 12 case × 6 layer = 216 个层的 TP/FP/FN、precision、recall、F1，每个 backend 固定 43 项金标事实。三路 v8 report 与 v7 逐字相同，逐案语义和 production-defense 诊断变化为 0；没有重新推理、重新抽样、改分母或重标金标。

以下均为 TP/FP/FN：

| Backend / 候选层 | Basic | Relational | Strict |
| --- | --- | --- | --- |
| rules raw | 2/0/41 | 0/2/43 | 0/2/43 |
| rules accepted | 2/0/41 | 0/2/43 | 0/2/43 |
| Qwen raw | 16/47/27 | 10/53/33 | 8/55/35 |
| Qwen accepted | 16/35/27 | 10/41/33 | 8/43/35 |
| DeepSeek raw | 34/17/9 | 27/24/16 | 25/26/18 |
| DeepSeek accepted | 34/17/9 | 27/24/16 | 25/26/18 |

raw/accepted/rejected 分别是 rules 2/2/0、Qwen 63/51/12、DeepSeek 51/51/0。三路 amount 非空为 2、8、10；无复核 issue 的精确金额均为 0，calculation_authorized 全部为 false。accepted 只表示候选进入审阅，不能当成已授权计算。保守 guard 的已知误警、暂定非专家标签与旧评分边界限制保留在此前报告，不以全阻断宣称语义全部正确。

本轮审查者独立执行 59 项测试（48 业务 + 2 monitor + 4 policy + 5 v8 gate）全部通过，四个新增测试脚本的限定 ESLint 退出 0。主侧真实 HTTP 39/39、cleanup PASS 的报告已经审读并复制；审查者没有启动 HTTP。旧构建在修正夹具容量后为 33 通过、6 个真实业务失败；前两次 27/12 包含 MAX_JOBS32 容量耗尽导致的 6 个夹具失败，四份原报告全部保留。容量修正仅回收夹具拥有的 completed 服务队列项，持久化 D1 前后快照相同，raw、历史、源文与重启断言继续执行。主侧未改动 v8 --check 及完整 npm check 均已实际退出 0；审查者读取完整最终日志与 PASS JSON，并保留同字节副本。全量包含 1789 项 Vitest（46 文件）、1146 项 runtime evidence，以及 Python 9/11/16。全量检查和真实 HTTP 由主侧执行，59 项独立测试和 216 层复核由本审查者执行，分别记录；这不替代随后精确 head 的 CI。

v8 manifest 为 `8fa3100c348a94af0471e93a5a2dab8d405df2dd4debc603b3fe3dbe89fac06b`；原 manifest 保持 `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee`。完整 43 个代码哈希、旧 manifest 哈希、指标和证据哈希见新增 round9-review.independent.json。证据本机来源是隔离 review 树 `postfreeze-evidence/round9/`，仓库目标是 `experiments/material-facts-v7/postfreeze-evidence/round9/`；其中 author- 前缀的历史执行日志来自 data 树 round10，由实现者执行，不冒充本审查者执行。正式复算脚本是 `v8-independent-report-check-final.py`（SHA-256 76b150e6f592ca05cb9afce3958dbb9a7ab063022e5dda0f8d362b23a012cc7e）；早期同名草稿保留且不作为正式证据，不覆盖根树已保留副本。

审查者未实现这四项核心修复，只编写独立测试、复算和复核。请求模型为 GPT-6.1 Sol / ultra，无法独立核验实际客户端配置。没有 build、模型调用、训练、生产部署、Git 提交或推送；没有修改旧结果、源文、标签、快照或旧回执。共享执行预算是有界运行政策，不保证任意机器性能；字节检查也不是对抗任意外部恶意写入者的系统级原子快照。新的整合检查、CI、合并与人工验收分别记录。
