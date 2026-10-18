本轮限定问题的独立复核通过，未发现新增的 round7 阻塞。该结论绑定第六版复算 `0c9ef56e30e278c816e088a934df1cb8f0cdc944c262b9bd9f88be146909ee69` 和整合提交 `ba3d5cc5cae1fbe1b5f554c0b9affd649f8fc7cc`，不会改写首跑或前五版记录。报告定稿时，主侧刚收到 4305935630、4305935635、4305935632 三项新的完整性问题，已另开 round8 修复；本轮通过不表示整个 PR 已无缺陷。

本 Agent 未实现币种、费率、算式守护、runner、不完整输出验证器或 scorer，对这些部分进行了非实现者源码复核及实际复测。本 Agent 实现了 HTTP 回归脚本的进程树收尾，因此其 5 项原生进程测试是作者自测；主侧对该补丁进行技术复核并运行实际 32 项隔离 HTTP。本任务请求 GPT-6.1 Sol / ultra，没有独立核验实际运行模型配置。

实际执行的检查及结果如下。

- 独立业务回归 82/82：同一有效夹具在旧业务实现为 23 PASS / 59 FAIL。完整引文、value/quote 同时裁剪及历史强制精确候选均不能抹掉外币、月费率或金额名词之后的倍数/运算。raw、representation、原文与 Unicode 码点位置保留。真正的月费率、日历/相对月份基本工资、另一事件的外币/同额倍数及未知、遮盖、范围、概数金额保持各自边界。完整算式不能在六个评分层借用基础金额事件；这些评分断言在基线已通过。
- 主侧新增 runner/outcome 回归由我独立重跑 21/21：完整结果之后的未终止 stdout 尾片会保留，attempt 不能成功，Qwen 后续批次停止；验证器要求明确的 `incomplete_stdout=false`。这里使用有限本地合成 worker 和实际 outcome 函数，没有模型调用。
- 新 v6 独立门禁 5/5（4 个实质子断言，约 45.2 秒）：验证 v5/current 绑定；改动旧 v5 快照或同 JSON 不同序列化的旧 manifest 均在 callback 之前拒绝；当前 arithmetic helper 仅增加注释后，真实 v6 `--check` 完整通过历史链，再以 `Correction v6 manifest changed`、exit 1 拒绝，未触发夹具超时。
- HTTP 进程树作者测试旧实现 0/5、新实现 5/5，最终整合脚本也 5/5。真实子进程覆盖默认 TERM、忽略 TERM、忽略 TERM 且关闭继承管道、父启动器先退出、无关进程仍存活。返回前确认自有 POSIX 进程组为 ESRCH、监听端口可重绑，重复清理安全。Windows 仅保留父进程 fallback，本组测试在 Windows 跳过。

源码边界是有限而明确的。币种新增前后工资/支付词桥，不能跨人名、数字、标点或换行牵连另一事件；费率仅折叠检测副本，明确“标准”优先，普通日期和相对月份仍保留期间含义；算式仅接金额后的有限名词与明确“的”/运算符，省略“的”的名词+factor+倍要求同一行。原文、码点和 raw 不随检测视图变化。没有对算式求值，也没有把未知值变成零或自动确认。

第六版控制器先用归档代码验证第五版的完整历史链，再用当前基础 scorer 复算一次；37 个当前代码路径、v5 归档验证入口及 v6 控制器均有哈希绑定。独立 Python 检查不导入 scorer/runner，核对原始 60 个结果文件、freeze、首跑 manifest、v1–v5 manifest 固定字节、相同 inputs/labels/raw，以及 v6 五文件与 37 个代码哈希。全部 216 个逐案六层匹配分区均检查索引覆盖、互斥、TP/FP/FN 和指标算术，每路 12 案、43 条事实固定分母。

三路 v5/v6 report **逐字相同**，逐案语义与 production-defense 诊断差异为 0。下列单元格为 TP/FP/FN。

| 路径 | raw basic | accepted basic | raw relational | accepted relational | raw strict | accepted strict |
| --- | --- | --- | --- | --- | --- | --- |
| rules | 2/0/41 | 2/0/41 | 0/2/43 | 0/2/43 | 0/2/43 | 0/2/43 |
| qwen | 16/47/27 | 16/35/27 | 10/53/33 | 10/41/33 | 8/55/35 | 8/43/35 |
| deepseek | 34/17/9 | 34/17/9 | 27/24/16 | 27/24/16 | 25/26/18 | 25/26/18 |

rules / Qwen / DeepSeek 的可派生 amount 数仍为 2 / 8 / 10；没有一条精确金额同时满足“无 review issue”，没有任何 calculation authorization。accepted、amount 字段和计算授权是不同状态。原始首跑存在过的评分/守护缺陷、非专家暂定标签与剩余保守性，继续以此前不可变报告为准；本轮没有重新盲标、抽样或推理。

主侧执行的应用完整检查记录为 1789 Vitest、625 native runtime、67 materials PASS + 1 平台 skip、Python 9/11/16；我读取了日志及整合回执，没有重新执行全套。主侧实际 HTTP 32/32，cleanup PASS，报告 `verification/http-round7.json` SHA `baedbd2a1ec260fb75ad6476ddc1d580eea27f7f3ba75f4943f6d09fac48153d`，边界是生产 Worker HTTP + 临时 D1/R2 + 真实 TXT/rules 队列与显式注入的合成事实输出，不是实际模型或业务验收。comparison 分支的新完整检查在本报告定稿时由主侧运行，本文不抢先记为通过。

证据均在 `postfreeze-evidence/round7/`，逐文件哈希见 `round7-review.independent.json`。有效红基线是 `business-final-before-red.txt` 和 `http-process-tree-final-before-red2.txt`；最终绿是 `business-integrated-final-green.txt`、`http-process-tree-integrated-final-green.txt`、`runner-outcome-independent-green.txt`、`v6-gates-integrated-green.txt`。独立复算工具与明细是 `v6-independent-report-check.py`、`v6-independent-report-comparison.json`。早期 business 夹具误填不在原文的 period、process-tree 夹具缺 import/清理 race 的失败日志保留，未计入有效产品红结果。所有旧报告、冻结产物和旧 receipts 保持原样；本 Agent 没有模型请求、build、Worker 服务启动、训练、提交或推送。
