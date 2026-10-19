# ROUND29 v22 轻量独立产物验收

v22 的本次轻量独立审计通过，实际进程 exit 0，耗时 0.071226 秒。当前 85 份代码、历史 v21 的 82 份代码快照、最初 60 份结果和全部 216 个逐案评分分区均通过；审计前后 342 个受保护文件 SHA-256 一致。本收据没有执行历史 CLI、五门禁、完整检查、HTTP、构建或模型请求，也没有修改任何当前或历史冻结产物。

审计入口为 `postfreeze-evidence/round29/capture-v22-light-audit.independent.py`，只调用本地 Python 的 `v22-independent-report-check-final.py`。后者不导入评分器，只独立检查保存的匹配分区、指标算术、原始候选与保留索引及文件字节。最终脚本 SHA-256 为 `53bba753b917a7cc8c044abb996d1c6555512ea39b391bb8d122bdb2d00a94b8`；执行记录及完整输出均已保留，准备版和首次执行前的静态补强记录也保留。

实际 ROOT 为 `/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards`，读取 HEAD `2f8311ac3b848a3a59351436ef8f36b0788166d2`。v22 manifest SHA-256 为 `7fbed100eb6fde657242b325ef73a8b7a42faa6ef3472e412958643230cfaa22`；前版 v21 manifest 为 `e9d350b5e634fed62e7688ec940440a8889f90f61cbcd8dba875abcce0b05504`；v21 代码归档 manifest 为 `57b4b9c649415031c461cf0eaa91ea1f7c1cce112415c6d95f20870b42f78a44`。当前集合严格等于前版 82 项加 3 个 v22 执行模块；历史执行策略的原字节保持不变。另逐项核对固定原 freeze/result-manifest、原结果 60 项，以及 v1–v21 历次 manifest 原字节及其全部引用文件。

## 评分复算与报告变化

12 份 holdout、每层 43 条暂定金标，3 路后端 × 12 案 × 6 层，共 216 个分区。每个分区的 TP 配对、FN 缺失、FP 多余索引须无重复且完整覆盖实际候选和金标，配对事件 ID 须与金标及保存的 event alignment 一致。下表为独立从保存分区重计的结果，P/R/F1 另按重计数字计算并逐项核对原报告和 comparison；所有六层配对与计数都与 v21 相同。

| 后端 | 层 | TP | FP | FN |
| --- | --- | ---: | ---: | ---: |
| rules | raw_basic | 2 | 0 | 41 |
| rules | raw_relational | 0 | 2 | 43 |
| rules | raw_strict | 0 | 2 | 43 |
| rules | accepted_basic | 2 | 0 | 41 |
| rules | accepted_relational | 0 | 2 | 43 |
| rules | accepted_strict | 0 | 2 | 43 |
| qwen | raw_basic | 16 | 47 | 27 |
| qwen | raw_relational | 10 | 53 | 33 |
| qwen | raw_strict | 8 | 55 | 35 |
| qwen | accepted_basic | 16 | 35 | 27 |
| qwen | accepted_relational | 10 | 41 | 33 |
| qwen | accepted_strict | 8 | 43 | 35 |
| deepseek | raw_basic | 34 | 17 | 9 |
| deepseek | raw_relational | 27 | 24 | 16 |
| deepseek | raw_strict | 25 | 26 | 18 |
| deepseek | accepted_basic | 34 | 17 | 9 |
| deepseek | accepted_relational | 27 | 24 | 16 |
| deepseek | accepted_strict | 25 | 26 | 18 |

rules 与 DeepSeek 报告和 v21 逐字节相同。Qwen 报告只有 `/cases/7/normalization/0/reason` 变化，对应 `mf7-spp-nanchang-fan` 的原值 `人民币1967万余元`：说明从“金额含多或余的内嵌概数，未转成精确金额。”改成“完整金额带有数量不定、概数界限或正负限定，未截取其中的精确正数。”该项前后均为 `approximate`、`amount=null`；全报告递归比较未发现其他字段变化。完整 `comparison.models` 也与 v21 相同。因此不能写成“三份报告逐字节相同”，也不能把文字变化当作新增精确金额或得分变化。

## 可用金额与证据边界

保存结果中共 46 条 accepted money，仍为 21 exact、23 approximate、2 unsupported；21 个非空派生金额。46 条全部仍带 `source_relation_unresolved`，无警告的精确金额为 0，`calculation_authorized=true` 为 0。accepted 和精确数字派生均不代表人、范围、期间或工资角色已经确认，更不代表计算授权。这些警告也不能反过来解释为 46 条模型语义全部错误，既有保守守护误杀与标签争议继续按此前记录保留。

本次检查验证保存的匹配是否构成完整分区和指标是否正确相加，不重新生成语义匹配，也不冒充法律专家复核。金标仍是非专家暂定研究技术标注，人工及法律验收均未完成。请求使用 GPT-6.1 Sol / ultra，实际运行后端无法独立核验。

ROUND29 应用最终 28 项双 Node 独立结果见另存的 `round29-application-review.final.independent.json`。主侧报告应用 `47e4c305` 的完整检查和同脚本 HTTP274 已通过；本审查没有亲自执行这些检查。v22 完整历史/整合检查由主侧另行负责，本收据不以本次轻量通过代替其终态，不覆盖任何既往失败、主动停止或中间版本收据。

详细机器收据：`experiments/material-facts-v7/round29-v22-review.independent.json`。证据包含审计脚本、准备/静态补强记录、stdout/stderr、执行记录、342 项前后摘要及逐字段差异清单；复制索引将另存 exclusive 新文件。
