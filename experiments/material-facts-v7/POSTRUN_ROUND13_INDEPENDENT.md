# ROUND13 独立复核

本轮两项产品问题、其引入的财务未知文本误拒，以及新增 v11 只读版本链，在所列范围内均未发现未处理的阻塞。此结论不等于整个 PR、法律正确性或真实业务人工验收。

同一份最终 46 项独立测试在精确旧版 `25bc6e0` 实际为 28 绿 / 18 红，在最终 CODE 和 ROOT 都为 46 绿。完整 `5元五角`、`5元零五分` 等有限混写分别派生 5.50、5.05；完整 `5分鐘`、`5分米`、`5角度` 不再作为金额候选接收，原始 raw 仍保留。候选 accepted、金额 amount 可用及计算授权分别断言，不能相互替代。

初版整合曾把 `十万分红`、`三万分红`、`三万分摊`、`五万分配` 确定拒收；已用实际中间 a21169/089364 源码保留 4 项全红复现，最终收窄后均保留为待核且 amount=null。中间版已含新混写 parser，不冒称原始 25bc 基线。三处旧测试由完整混写 unsupported 改为精确值有明确新契约依据；源文 `5元五角` 裁成 `5元` 仍不可用。测试继续约束裁剪、外币、费率、未知精度、历史 unsupported 不升级、raw/representation/码点不改、同额不同事件与六层最大匹配。

非实现者逐项审读了 money/currency 实现和新增 historical-v10 / verify-v10 / controller-v11 三模块。新的执行桥只允许历史 v10 的 `--check`，继承原 v1 的 15 分钟共享绝对时限及每层 2 秒清理余量，旧白名单、旧快照字节不变。独立 native 两项探针在 ROOT 实际通过，包含接近耗尽的真实终止及非只读命令在 spawn 前拒绝。DATA 作者准备的 v11 门禁由本复核者审读并实际执行，5/5、exit 0，总耗时 252.163 秒；两个真实 CLI 负例分别以退出码 1 拒绝同 JSON 空白改写（67.609 秒）和当前 range guard 注释漂移（182.839 秒），均不是 timeout。49 文件还原和抛错清理也通过。

独立 Python 不导入评分器或 runner，对门禁前后分别核对原始 60 文件、历代固定 manifest hash、49 个历史 v10 快照、52 个当前代码路径和 v11 全 5 文件。两次结果完全相同，v11 manifest 为 `42f13c238e7f88c044de27c858327b92ffd20a576970c836b1a52654421b1345`。逐例从配对、missing、extra 集合重算完整且互斥的 216 个案例层分区；每路 12 案、每层固定 43 个事实，TP+FN 始终为 43，六层汇总和 precision/recall/F1 吻合。保留前序独立事件/属性语义审查；此处明确为保存匹配分区的独立算术复算，不冒称重新实现全部语义评分器。

下表每格为 TP / FP / FN，三路 report 与 v10 逐字相同：

| 后端 | raw basic | accepted basic | raw relational | accepted relational | raw strict | accepted strict |
| --- | --- | --- | --- | --- | --- | --- |
| rules | 2 / 0 / 41 | 2 / 0 / 41 | 0 / 2 / 43 | 0 / 2 / 43 | 0 / 2 / 43 | 0 / 2 / 43 |
| Qwen | 16 / 47 / 27 | 16 / 35 / 27 | 10 / 53 / 33 | 10 / 41 / 33 | 8 / 55 / 35 | 8 / 43 / 35 |
| DeepSeek | 34 / 17 / 9 | 34 / 17 / 9 | 27 / 24 / 16 | 27 / 24 / 16 | 25 / 26 / 18 | 25 / 26 / 18 |

raw / accepted / rejected 分别为 rules 2 / 2 / 0、Qwen 63 / 51 / 12、DeepSeek 51 / 51 / 0。amount 非空分别为 2、8、10；无 review issue 的精确金额为 0，calculation_authorized 也全部为 false。防御标记并不表示所有模型语义全错；可用数值也不等于已确认、可计算。冻结样本本轮没有报告或分数变化，新边界的行为证据来自保留的合成回归，未重新调用模型。标签仍是非专家暂定技术标注。

主侧运行的同脚本 HTTP 74 场景，旧版 68 绿 / 6 红，当前 74 绿，均 cleanup PASS；73 份重启快照的 stored/raw/history 不变。本人只读审了新增 10 项、公用原文/码点/不自动确认断言及保存报告，未亲自启动服务。首轮 derived 值断言和重启持久化核对分开，不把重启称为第二遍全部金额验收。主侧应用全量记录为 1789 Vitest、1981 runtime 通过，随后 70 项 classifier 探针另跑通过；精确 `92ba4dd` 的 CI success 由主侧保存回执记录，本人未独立查询远端。主侧 v11 write/check 保存结果均 PASS。随后主侧 comparison 全量检查也实际退出 0，终态日志为 2329/2329 runtime、1789 Vitest、材料 67 通过及 1 平台 skip、Python 9/11/16；本人只读核对了其终态日志并单独保存整合完成观察，不把它冒称本人重跑。精确 PR46 新 head 的 CI 待主侧提交后另记。

精确产品源码为 money `543fdbfb…`、currency `9031c597…`；新桥 `da4de9e0…`、verify-v10 `25bbec41…`、controller-v11 `22b9d21c…`。全 hash、原始红绿日志、门禁耗时、复算明细及证据索引见同目录 `round13-review.independent.json`。证据原目录为 `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-review/postfreeze-evidence/round13`，整合目录为 `experiments/material-facts-v7/postfreeze-evidence/round13/independent`；同名已有文件逐 hash 吻合，不覆盖旧失败、旧回执或冻结产物。先行产品 only 回执保持原时点，后续结果由本新件补充。

本复核者未实现本轮产品/版本链，未改旧冻结/标签/模型输出，未启动服务、build、模型调用、训练、部署或 Git 写操作。请求使用 GPT-6.1 Sol / ultra；实际后端配置无法独立核验。
