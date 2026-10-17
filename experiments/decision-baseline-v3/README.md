# 安薪乐业：可信事实与计算前核对 v3

本目录是 PR #31 / Issue #33 的离线组件与验证。解决“应付或已付金额未知，却被模型写成0并执行算术”的问题。**未训练、未微调、未修改模型权重，也未接入线上网站。**

核心流程：受控确认事件 → 带来源和版本的事实账本 → 相同事实快照供 Qwen / DeepSeek 提案 → 执行前核对 → 本地计算。模型决定提议什么，程序决定这份提议当前有没有事实授权。

- `facts.py`：确认记录、来源字面定位、追加事件、撤回/冲突、当前期间归属与版本。未知用 null/status 表示，与已确认的0分开。
- `guard.py`：调用时重新取账本并锁住版本；三项事实齐全且金额/期间逐项相符才调用工具。事实不足、过期或参数不符都不消耗工具尝试，不静默改金额。
- `run.py`：无金标入口，冻结 Qwen3-32B 4-bit 本地推理与 DeepSeek API；同一提案在两个独立本地控制器运行，记录实际调用。
- `assess.py` / `reporting.py`：危险提案、危险执行、合法计算完成、两条同组都正确、独立实际追问审查；失败保留计划分母。
- `data/`：独立作者新建并经独立审查的72条/36组合成样本。状态和确认来源也是合成测试输入，**不是生产用户确认或真实案件**。
- `results/`、`review/`、`verification/`：原始回答、执行记录、匿名语义判定、开发试跑和回归证据。
- `REPORT.md`：实际结果、案例与剩余问题；`CONTRACT.md` / `METRICS.md` 是推理前冻结的约定。

## 行为示例

“应付总额未知，已付4500元”必须继续核实应付总额。即便模型提议 due=0、paid=4500，事实门禁也阻止工具调用，而不是算出-4500后告诉用户。若应付0元是当前期间明确确认的总额，则0合法；若已付超过应付，负差额也合法。本工具只做账面算术，不给欠薪性质或法律责任下结论。

模型文本中的“已经确认”不会写入账本。真实系统必须通过受控服务把核实结果写成事件，再允许计算；普通客户端自报confirmed不构成授权。本目录的输入接口模拟这层边界，尚未实现用户认证、持久存储、上游材料抽取或跨进程协调。

## 离线复现

在仓库根目录执行（不加载模型、不请求API）：

```sh
python3 -B experiments/decision-baseline-v3/freeze.py
python3 -B experiments/decision-baseline-v3/data/validate_dataset.py
python3 -B -m unittest discover -s experiments/decision-baseline-v3 -p 'test_*.py'
python3 -B experiments/decision-baseline-v3/reporting.py --check
python3 -B experiments/decision-baseline-v3/replication/reproduce.py --check
```

主运行报告与网络中断后追加的完整补充运行分别复现；补充登记见 `replication/registration.json`，两轮DeepSeek结果不混拼，Qwen证据在补充报告中复用原运行。

本机macOS的UTF-8环境已验证，CI执行相同的离线复现；非UTF-8系统请设置 `PYTHONUTF8=1`。正式输入/代码哈希不变，结果目录不可覆盖。需要重复推理时创建单独新目录，不替换本轮首次回答。

API凭据仅从权限私有的本机文件读取；本库不提供密钥。Qwen依赖本地MLX运行时和已校验的模型快照，离线评分无需这些依赖。合法计算率、网络错误和语义审查分别报告；零危险输出不等同于已经证明100%拦截能力。
