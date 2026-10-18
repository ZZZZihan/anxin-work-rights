本轮收到的三项完整性问题已逐项复核，当前修复范围内未发现剩余阻塞。新 v7 只加强冻结发布、保留目录保护与清单字节核验；原始首跑及 corrections v1–v6、旧回执均保留。此结论覆盖本轮已知三项，不等同于整份 PR 批准、生产部署或业务人工验收。

4305935630（冻结文件部分写入）：检查了最终 `freeze.mjs` 的真实发布路径。文件在同目录以 `wx` 创建唯一暂存，完整写入、sync、close 后才以 link 独占发布最终名称。既有最终文件或发布瞬间出现的同名文件均不会被覆盖。发布前故障保留暂存与失败回执；正常捕获失败释放本次共享锁并可用新暂存重试。SIGKILL 留下暂存与 owner lock，继续 fail closed 等待人工核对。link 成功是提交边界，之后清理或失败回执写入异常不会把完整最终文件误报成未发布；返回有效 freeze，并输出 `FROZEN_CLEANUP_WARNING`、`published:true` 和回执是否写成。独立执行作者的 12 项 native subprocess / 文件系统故障注入回归全部通过，涵盖短写/ENOSPC、sync/close/link 故障、发布竞态、锁覆盖、SIGKILL、失败回执故障与发布后两种清理故障。该夹具原样抽取生产 createFreeze body；无关数据、旧实验、模型身份和 readiness 门禁使用显式合成 stub，因此不把它称为一次真实全实验冻结验收。

4305935635（诊断输出占用预算锁）：最终 runner 在任何 backend preflight、输入读取、实验锁和 attempt mkdir 前，检查规范化的目标 basename，大小写等价的 `.deepseek-budget.lock` 均拒绝。实际预算锁创建复用同一名称常量。独立执行作者 11 项回归全部通过：含大小写与路径归一化、现有控制锁/旧失败证据原样保留、非法配置优先拒绝、拒绝后正常 rules 与合成 DeepSeek worker 路径仍可使用，以及相近但不冲突的普通目录名。合成 worker 只写 sentinel 后退出，没有网络或模型调用。

4305935632（同 JSON 清单改写仍通过）：先在 withCorrectionV6Code 构造的自有完整旧代码临时树中，实际运行两次旧 v6 CLI；追加空白和重排键顺序都保持 JSON 相同且确实返回 PASS，保存了改写前后哈希，原 v6 清单未动。新 v7 在重算并比较语义后，进一步比较当前清单原始字节与确定性序列化的重算结果。独立新增 5 项门禁全部通过：规范清单与 39 个当前依赖正向核对；真实 v6 wrapper 在归档源代码快照改变后、进入 callback 前拒绝；实际 v7 CLI 对两种同 JSON 字节改写均以 exit 1 和 `Correction v7 manifest bytes changed` 拒绝。拒绝不是超时或前置夹具错误。两次负门禁均先完成真实旧历史链校验和当前重算。旧 v6 回归由主侧改为在其 archived wrapper 内执行，保留原断言；旧实验产物和旧回执不回写。

独立产物复核不导入原评分器：验证原 60 个结果文件、原 freeze、首跑 result-manifest 和 v1–v6 manifest 的固定字节；验证 v6 的 37 个归档代码快照及 v7 的 39 个当前代码哈希；逐案检查六层 pairs/missing/extra 的完整、互斥索引分区，并重算全部 TP/FP/FN、precision、recall、F1。范围为 3 backend × 12 case × 6 layer = 216 个逐案层，每个 backend 固定 43 项金标事实，未改分母。三路 v7 report 与 v6 逐字相同，逐案语义或 production-defense 诊断变化为 0。

以下均为 TP/FP/FN；每行的三种评分都用同一固定 43 项事实：

| Backend / 候选层 | Basic | Relational | Strict |
| --- | --- | --- | --- |
| rules raw | 2/0/41 | 0/2/43 | 0/2/43 |
| rules accepted | 2/0/41 | 0/2/43 | 0/2/43 |
| Qwen raw | 16/47/27 | 10/53/33 | 8/55/35 |
| Qwen accepted | 16/35/27 | 10/41/33 | 8/43/35 |
| DeepSeek raw | 34/17/9 | 27/24/16 | 25/26/18 |
| DeepSeek accepted | 34/17/9 | 27/24/16 | 25/26/18 |

accepted 仍不代表可直接计算。三路 amount 非空分别为 2、8、10；本报告保存的 production-defense 中，无复核 issue 的精确金额为 0，calculation_authorized 全部为 false。保守 guard 的误警与可用性限制沿用此前独立报告；本轮没有重标金标、改写历史缺陷说明或声称法律专家认定。

正式 v7 manifest SHA-256 为 `1fb40b4c0694744f5a83c6b9ddc87bfd1958a2b85185fb178273cec13b422e31`；原首跑 manifest 仍为 `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee`。详细 39 个代码哈希、历史哈希、指标和全部证据哈希见新增 `round8-review.independent.json`。独立证据应复制到仓库的 `experiments/material-facts-v7/postfreeze-evidence/round8/`；本机来源为隔离 review 树的 `postfreeze-evidence/round8/`，不能混淆这两个根目录。

审查者未实现本轮 runner、freeze 或 v7 controller，只编写独立门禁并复跑、审读实现者回归。共独立执行 28 项测试（11 + 12 + 5）通过，另有 216 层产物复算与旧 v6 两个真实反例。scope 检查和新门禁 ESLint 均通过。主侧随后完成整合全量 npm check 与未改动 v7 --check，均退出 0；审查者读取实际日志与 PASS JSON 并保留同字节副本。全量包括 1789 项 Vitest（46 文件）、842 项 runtime evidence、材料 67 通过及 1 项平台跳过、Python 9/11/16。全量检查由主侧执行，独立门禁与复算由本审查者执行，分别记录。之前 HTTP 32/32 与业务回归属于主侧 round7 证据，本轮没有重启 Worker、build、重新推理、训练、提交或推送。

边界：原子 link 保证同文件系统的最终名称完整发布，测试覆盖当前本机原生文件系统故障；没有宣称任意断电持久性或对抗任意外部恶意写入者。SIGKILL 遗留锁不能按年龄自动删除。保存的评分分区算术复核与此前独立源文事件复核分别表述，不把重新运行原 verifier 冒充独立语义重标。请求模型为 GPT-6.1 Sol / ultra；审查者不能独立核验实际客户端模型配置。
