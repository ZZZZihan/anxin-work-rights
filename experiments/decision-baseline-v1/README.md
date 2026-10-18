# 安薪乐业：微调前决策基线

这个实验判断当前可见信息是否足以计算某段期间的工资算术差额，并提出追问、计算工具调用或工具失败动作。它不训练模型，不修改线上功能，不自动执行真实案件写入。

先读 [样本示例](SAMPLES.md)、[数据说明](data/AUTHORING.md)、[冻结协议](CONTRACT.md) 和 [冻结清单](freeze.json)。结果和逐题分析见 `REPORT.md`；每组原始输出、协议、评分及运行状态保存在 `results/`。

数据为 Agent 编写且由另一 Agent 逐条复核的合成情境，不是人工专家标注或真实咨询。24条train仅作为训练候选和规则开发材料，12条dev用于开发检查，72条test由36个留出语义/对照组组成。没有启动SFT、LoRA、DPO或RL。`train.sft.jsonl`是整理后的候选格式，不代表已经训练或允许自动训练。

所有基线接收相同的自然会话和可信工具状态。规则实现者只允许接触train/dev四个JSONL；模型上下文没有金标、类别或组信息。共享文件系统没有强制访问隔离。任务、作者与语言风格仍有重合，不能把该测试集当成真实外部泛化验证。

固定的主指标是 `decision_contract_correct`：缺失/冲突字段、动作、提问字段和参数全部一致，且输出合同自洽。原始JSON围栏单列统计。`diagnostics.py`是在开发集发现空字段遗漏后增加的探索性分析：忽略全部 missing/conflicts 状态元数据，单独读取已输出的动作、提问字段标签和参数；它不只是补齐空字段，也不验证提问文字。不补金额、不重新请求模型、不覆盖原始输出或主指标；实际提问文字另经独立复核。这两类分数不可混为一个预注册结果。

## 不调用模型的检查

在仓库根目录执行：

```bash
python3 -B experiments/decision-baseline-v1/verification/verify.py --tracked-only
python3 experiments/decision-baseline-v1/data/validate_dataset.py
python3 experiments/decision-baseline-v1/prepare.py
python3 -m unittest discover -s experiments/decision-baseline-v1 -p 'test_*.py'
python3 -B -m unittest discover -s experiments/decision-baseline-v1/verification -p 'test_*.py'
python3 -B experiments/decision-baseline-v1/verification/verify.py
```

检查首先要求 v1/v2/v3 的冻结清单和比较表都已被 Git 跟踪且仍存在，避免生成器把误删的存档重建成未跟踪文件后漏过检查。`prepare.py`发现已有freeze.json时只核对哈希，不改写冻结内容。新增的 `verification/verify.py` 从原始结果和金标重算每项 assessment 和 diagnostic，并逐条核对匿名审查包与映射目标的输入、金标、原始输出、解析输出和传输状态；随后在临时副本中运行冻结的 `summarize.py`，要求比较表与存档逐字节一致。验证器只读存档，不改已封存的评分源码、指标和历史结果。这些检查不调用DeepSeek、不加载Qwen、不训练。

## 复现基线

每次使用不存在的新结果目录；运行器拒绝覆盖旧结果。以下路径变量只指向本机已有资产，凭据不写入命令内容或仓库。

```bash
python3 experiments/decision-baseline-v1/run.py --backend rules \
  --inputs experiments/decision-baseline-v1/data/test.inputs.jsonl \
  --run-dir /absolute/new-run/rules

python3 experiments/decision-baseline-v1/run.py --backend deepseek \
  --inputs experiments/decision-baseline-v1/data/test.inputs.jsonl \
  --run-dir /absolute/new-run/deepseek --api-model deepseek-v4-pro \
  --key-file "$DEEPSEEK_KEY_FILE"

"$MLX_PYTHON" experiments/decision-baseline-v1/run.py --backend qwen \
  --inputs experiments/decision-baseline-v1/data/test.inputs.jsonl \
  --run-dir /absolute/new-run/qwen --model-path "$QWEN_MODEL_PATH" \
  --integrity-dir "$QWEN_INTEGRITY_DIR"
```

DeepSeek凭据文件权限必须不开放给组及其他用户（本次为0600）。API固定官方域名，单次运行最多108题，每题一次调用，不静默重试，按核查时Pro峰时价格保守预留不超过2美元；真实账单与token估算不同。再次运行会产生新的API用量。Qwen要求Apple Metal、现有MLX环境以及先前完整权重哈希校验记录，复核模型文件stat指纹后运行；不联网下载模型。运行器限制内存、采样内存压力与swap，出现持续警告或超限会终止自己启动的子进程。

```bash
python3 experiments/decision-baseline-v1/evaluate.py \
  --labels experiments/decision-baseline-v1/data/test.labels.jsonl \
  --inputs experiments/decision-baseline-v1/data/test.inputs.jsonl \
  --run-dir /absolute/new-run/qwen

python3 experiments/decision-baseline-v1/diagnostics.py \
  --labels experiments/decision-baseline-v1/data/test.labels.jsonl \
  --run-dir /absolute/new-run/qwen
```

评分器拒绝把限量运行当完整测试；未返回题目计入失败，不能悄悄从分母剔除。HTTP失败、额外恢复请求与模型内容错误应分别报告。DeepSeek模型名是供应商别名，已记录返回标识和fingerprint（若提供），不能保证未来仍是相同内部权重。

只有固定历史下的下一步决策和确定性算术回放被测试。没有测量真实用户多轮完成率、OCR、检索、法律判断、并发服务或完整的Qwen＋DeepSeek生产流程。观察test错误后可以提出后续实验，但不可改当前规则/提示词再覆盖这次结果；后续调优需要保持独立验收数据。
