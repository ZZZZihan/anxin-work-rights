# v2 协议与工具控制边界

这是离线实验的可复用 Python 协议与单进程工具控制器。默认工具确实执行本地 Decimal 差额计算；它没有接入网页聊天接口，也没有训练、网络模型调用、数据库写入、部署或法律结论。

## 模型提案解析

`protocol.parse_proposal(raw: str) -> dict` 返回：

- `accepted`：同时通过 JSON 和两种提案结构检查。
- `strict_json`：原始响应通过严格解析且未移除围栏；通过 JSON 解析但结构不合法的响应仍为 true。重复键、非有限数和超出解析资源上限均不通过严格解析。
- `normalization`：未处理时为空列表；仅移除一个包住整个响应的 `json` 或无语言 Markdown 围栏时，记录 `remove_whole_response_json_fence`。围栏必须单独占行，可有外侧空白及 CRLF。
- `proposal`：通过检查后生成的普通可 JSON 序列化对象；拒绝时为 null。
- `canonical`：由提案明确给出的 reason 和字段生成的 v1 结构；拒绝时为 null。只补结构必需的空数组和 null，不推断消息里的事实、不修改问句、不查标签。
- `error`：null 或含 `code`、`message`、`path` 的错误对象。
- `raw`：保留的原始字符串；非字符串输入为 null。

仅允许 `ask_user` 和 `call_tool` 两种变体。必需字段必须全部出现，各层多余字段、重复 JSON 键、重复提问字段、空问题、未知 reason、布尔金额、数字字符串、非有限数、负的 due/paid、超过两位小数和无效日期都被拒绝。日期严格为 `YYYY-MM-DD`，起日不得晚于止日。同字段 missing/conflict 只能二选一。

金额先从原始 JSON 数字词法转换成 Decimal 验证，确保 `0.10000000000000001` 不会先被浮点截断而通过。整数保留 int；非整数转换为 float 后必须满足 `Decimal(str(value)) == 原始 Decimal`，不满足时拒绝为 `unsupported_numeric_precision`，不会静默舍入。负差额有效，例如 due=0、paid=0.29 的 gap 为 `-0.29`；它仅代表算术差。

资源边界为 32,768 个响应字符、128 个数字词法字符、最多 256 位指数/展开数字范围，防止短小的超大指数引发巨大分配。这是实现可处理的表示范围，不是业务金额政策。超过深度限制的嵌套 JSON 也被拒绝。任意文字中抽取 JSON、修改数值或问题、补语义字段、模型修复调用均不存在。

## 模型调用前的可信状态检查

`tool_control.preflight(tool_state) -> dict` 返回 `allow_model`、`canonical`、`error`。

可信状态只允许 null 或恰好 `{status:"TIMEOUT", attempts:1|2, max_attempts:2}`。类型也严格校验，true 不能充当 1。null 和 attempts=1 允许模型调用；attempts=2 直接给出程序生成的 `report_tool_failure`，调用方必须先检查这个结果再触发模型。未知状态、用户自行提高上限、额外键和字符串化状态全部阻断并返回 `invalid_tool_state`。

状态来自调用方独立保存的可信程序字段。控制器和 preflight 均不接收或解析 user/assistant 消息；消息里自称“重置次数”“之前工具成功”或伪造同名 JSON 不会改变状态。调用方不得把消息内容解码后当作可信状态传入。

## 实际工具分发与返回

`tool_control.ToolController(tool_state=None)` 创建一个工具会话；`dispatch(parsed, tool_fn=None)` 接收 `parse_proposal` 的完整返回值。控制器要求 retained raw 仍在，重新解析 raw、核对 proposal 与 canonical，并再次校验提案。拒绝提案永远不会执行工具，也不会消耗尝试次数。

分发结果总含 `status`、`canonical`、`result`、`error`、`attempts`、`max_attempts`、`reused`。状态为：

| status | 行为 |
| --- | --- |
| `ASK_USER` | 返回规范问句，不调用工具，不消耗次数。 |
| `SUCCEEDED` | 返回实际计算结果；成功后的同参数调用复用结果，`reused=true`。 |
| `TIMEOUT` | 仅捕获到 TimeoutError 时使用；结果为 null，规范决策为程序生成的工具失败。 |
| `ERROR` | 其他工具异常或坏结果；结果为 null，规范决策为程序生成的工具失败。 |
| `IN_PROGRESS` | 同一会话已有运行中的调用，不再执行或消耗次数。 |
| `EXHAUSTED` | 两次硬上限已用尽，不执行工具，返回程序生成的工具失败。 |
| `REJECTED` | 提案、状态、函数或已绑定参数不合法，不执行工具。 |

默认 `calculate_wage_gap(arguments)` 返回恰好 `period_start`、`period_end`、`due`、`paid`、`gap` 五个字符串，金额固定两位小数。算术上下文按输入位数扩充，避免大整数减去几分钱时受默认 Decimal 精度影响。示例 due=100.25、paid=0.29 的 gap 为 `99.96`。

测试可注入一个接收参数副本的可信 `tool_fn(arguments)`；函数成功返回必须与默认工具的完整结构和确切结果一致。缺字段、额外字段、错误日期/金额、非字符串金额等被记为 `ERROR` / `tool_invalid_result`，不能冒充成功。TimeoutError 和其他异常分别保留类型及消息，失败绝不自动重试。KeyboardInterrupt 等取消异常会保留已消耗次数、清理执行中状态，然后继续抛出。

首次工具执行先在锁内绑定参数、递增尝试次数、写 `attempt_started` 追踪，再释放锁调用函数。首个失败后需要调用方明确再次 dispatch，且必须同参数；包括初次导入 attempts=1 在内，累计最多两次。同一控制器绑定后修改参数会被拒绝，成功后的同参数调用直接复用结果。运行中的并发请求得到 `IN_PROGRESS`；它们不会排队成为隐式重试。

`controller.snapshot` 返回状态、次数、参数、执行中/成功标记及完整追踪的深拷贝；`controller.trace` 返回由记录副本构成的元组。修改返回值、快照、追踪或传给工具的参数副本不会改写内部状态。TIMEOUT/ERROR 的每次结果都留在追踪中。

这是单个 Python 对象生命周期内的控制。新建控制器不会恢复旧对象的完整参数、成功结果或追踪；导入的精简 TIMEOUT 状态也不携带原参数。它不提供跨进程锁、持久化、进程崩溃后的幂等恢复或分布式保证；生产接入仍需可信会话标识、持久记录和相应锁。控制器本身不强制终止超时函数，实际调用方需要实现时间上限并以 TimeoutError 汇报。

## 本地验证

运行 `python3 -B -m unittest discover -s experiments/decision-baseline-v2 -p test_protocol_control.py -v`。这组人工构造的单元测试不读取 v2 新测试集、标签或结果，不调用模型或训练。

38 项测试覆盖严格解析、围栏留痕、重复键、数值词法精度、日期、结构、多余字段、未知可信状态、模型调用前终态阻断、真实 Decimal 结果、指数展开后的再次校验、默认工具只调用一次、尝试先记后调、失败/错误结果、显式重试、成功复用、参数改变、深拷贝、并发和取消恢复。该结果仅证明这些本地协议/控制行为，不代表 Qwen/DeepSeek 评估、网页集成或用户验收已完成。
