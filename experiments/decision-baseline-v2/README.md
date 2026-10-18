# 安薪乐业：决策协议与工具控制 v2

本目录是可复用的离线决策组件及配对评测，暂未接入网站 `/api/chat`。模型只提出追问或调用工资差额工具；程序拥有校验、状态、调用次数和执行结果。没有训练、适配器、模型参数更新、合并或部署。

- 设计与边界：[DESIGN.md](DESIGN.md)、[CONTROL.md](CONTROL.md)。
- 冻结指标：[METRICS.md](METRICS.md)；冻结清单：[freeze.json](freeze.json)。
- 72 条新合成留出样本、36 个对照组：[data/AUTHORING.md](data/AUTHORING.md)。数据作者只读旧业务合同，不读旧测试和失败输出；独立 Agent 全量审标签。它不代表真实用户、法律专家或外部团队的独立验证。
- 结果与剩余问题见 [REPORT.md](REPORT.md)。旧 v1 文件及历史结果完整保留。

## 控制顺序

1. 从可信程序存储读取 `tool_state`，在任何模型请求前调用 `preflight`。
2. 已到两次尝试上限，由程序返回终止动作；不再请求模型。
3. 允许请求时，给模型业务对话和冻结提示词。`parse_proposal` 仅接受两种严格结构；只允许移除完整 Markdown 围栏且记录，不猜字段、不修金额、不请求另一模型修复。
4. `ToolController(state).dispatch(parsed)` 重新检查原文和解析结果，再追问或真正执行本地 Decimal 算术。失败记账；成功同参复用；并发重复不二次执行。
5. 读取 `controller.snapshot` 和 `controller.trace` 留存证据。问句业务质量仍需要评估，合法 JSON 并不保证问得对。

当前状态保证限定同一控制器对象内。服务接入还需要可信会话存储、原子状态更新、跨进程幂等键、外部工具的超时取消机制和用户交互集成。固定历史的一步评测没有覆盖真实用户后续回答。

## 不调用模型的复核

在仓库根目录运行：

```sh
python3 -B experiments/decision-baseline-v2/freeze.py
python3 -B experiments/decision-baseline-v2/data/validate_dataset.py
python3 -B -m unittest discover -s experiments/decision-baseline-v2 -p 'test_*.py'
python3 -B experiments/decision-baseline-v2/reporting/summarize.py --check
```

评测代码仅用 Python 标准库。上述流程不需要密钥、MLX、模型权重或网络。

## 重新推理

`run_comparison.py` 的每次运行需要新的输出目录，不覆盖现有结果。`--backend` 为 `qwen` 或 `deepseek`，`--variant` 为 `v1` 或 `v2`。每条记录只允许 `id/messages/tool_state`，标签文件不传入运行器。Qwen 使用安装 MLX 的独立 Python 环境，还需 `--model-path` 和 `--integrity-dir` 指向本机已验证模型与下载完整性凭据；DeepSeek 使用 `--key-file` 指向仅当前用户可读的本机文件，密钥不进入仓库或日志。

```sh
python3 -B experiments/decision-baseline-v2/run_comparison.py \
  --backend deepseek --variant v2 \
  --inputs experiments/decision-baseline-v2/data/test.inputs.jsonl \
  --key-file /absolute/private/credential-file \
  --run-dir /absolute/new/run-directory
```

上面是需另行发起的真实 API 推理，会产生费用；CI 不执行。单臂最多 108 条、预估预算上界 2 美元、每题最多 512 输出 token、单次请求 120 秒、无自动重试，累计三个请求错误停止。Qwen 另有内存压力、交换空间和执行时限守卫。两套提示词相同解码条件但长度不同，不能把时延差异单独归因于模型速度。

评分只读模型输出、标签和输入：

```sh
python3 -B experiments/decision-baseline-v2/assess.py \
  --inputs experiments/decision-baseline-v2/data/test.inputs.jsonl \
  --labels experiments/decision-baseline-v2/data/test.labels.jsonl \
  --run-dir /absolute/existing/run-directory
```

新测试揭露的问题只能记录；本轮结果不能通过改提示词后重跑来替换。继续改进时须另建留出集。
