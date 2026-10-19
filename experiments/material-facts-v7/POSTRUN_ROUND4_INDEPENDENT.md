**v7 第四轮独立技术复核：本轮四项实验完整性问题已修复，未发现新增阻塞。** 本次未参与修复实现，也未参与评分器实现；只读复核主树最终代码、保存的三路首跑输出及版本化修正产物。未重新推理、启动模型 Worker、运行新 HTTP 验收、重型构建、提交或推送。请求配置为 GPT-6.1 Sol / ultra，实际运行配置无法由本审查独立核验。

独立回归在当前主树实际执行 **54 项，54 PASS / 0 FAIL**：新增完整性检查 38 项，以及保留原断言、补齐完整终止态与无模型解释器探针的旧门禁 16 项。两份独立脚本通过仓库 ESLint。初始独立基线为 29 项、13 PASS / 16 FAIL：5 个错误后端配置消耗唯一正式目录、10 个缺失或不完整完成态误判就绪，以及一个同时覆盖四份遗漏执行脚本的还原反例；当时原子发布 helper 已实现，其 7 个独立检查为绿。后续扩展仅增加边界，未调低原失败断言。

四项修复的具体边界为：

- `run.mjs` 原本已有 backend 枚举检查；实际缺口是 Qwen/DeepSeek 专属参数和路径。现在缺参、坏路径、缺解释器及非法连接端口在创建正式目录前拒绝；rules 无需模型参数。测试中的可执行文件只允许无模型 `-c` 探针，真正 worker 启动会使测试失败。
- `validateDevelopment` 现在同时要求成功完成态、按协议 ID 完整且唯一的 stop 终止行，以及模型进程成功与无截断 stdout。只有协议、消息和代码 hash 不能贡献就绪。合法空候选 `[]` 不会被拒；保留的失败历史也不会阻断另一份完整成功的当前代码尝试。
- 新 `frozen-code-v2` 独立保存 **36 份**原始冻结文件，包含过去遗漏的 v7 `run/freeze/verify/summarize`。独立测试给四份 live 脚本加入无害哨兵，再逐份确认还原后 hash 等于原 freeze；缺失或损坏快照在 callback 前拒绝，callback 异常后临时树清理。旧 32 份归档未覆盖。
- 发布先校验并序列化，再在同级唯一临时目录写完整集合，最后原子 rename。写入异常和实际 SIGKILL 都保留未发布现场，不占最终目录，之后可以重试。已有空目录、已有历史、symlink、写入期间出现的目标，以及两个并发完整发布者均通过不覆盖检查。故障回执只存错误 code 和已写文件名，不存异常 message。

我另行只读调用 v3 计算链，核对正式 `corrections-v3` 的 **精确 5 文件集合、manifest、全部序列化字节和代码 hash**，并检查其先还原验证 v2、v1 与原首跑。**rules、Qwen、DeepSeek 三份 v3 report 各自与 v2 对应 report 字节完全相等**；这不表示 v1、v2、v3 的全部历史文件相同。本轮没有重写旧独立六层复算，既有复算证据继续保留；每路固定 12 份材料、43 个事实、2 份自然空材料，六层 TP/FP/FN 均未改变。完整数值和逐文件 hash 见 [本轮机器回执](round4-review.independent.json)。

历史绑定及当前版本绑定如下；独立计算前后，前五项保持相同：

| 绑定 | SHA-256 |
| --- | --- |
| 原 freeze | `0caa5b58d498a9c3ea57fc3f807118cd1faa0169a80e41b9935eacf3853ccab2` |
| 原 60 文件结果 manifest | `3733e4c6939184fbe79b56e4a4bdc2db35f4e6f99a20fc91c48bd24913ce53ee` |
| correction v1 manifest | `eb5d86b831a8a6df99b52a02cd062fe977a2a03ed5ef5ef168406c1a10a010de` |
| correction v2 manifest | `1bb6add63ec732bca31dfe65c50844411e7fba45d0addc45b0f69a11a3175f80` |
| 原 32 文件代码 manifest | `26ff66ddf4ab1e73420507fc1a9e5d76f40191bddd90968d3f375878a421d815` |
| 新 36 文件代码 manifest | `a0f5103e20bfc971fcb585e6fc5ceb26b4aaeab20cd1cde6a16458457cf02aaf` |
| correction v3 manifest | `72e07756ce1901dd1060d4b03c53fb443eebd9048bf7f6bece6c6cbf3ec0c841` |

可追查的独立证据为 [真实红基线](postfreeze-evidence/round4/integrity-before-red.txt)、[最终 54 项绿日志](postfreeze-evidence/round4/integrity-main-delivery-green.txt)、[只读 v3 预计算核对](postfreeze-evidence/round4/v3-independent-dry-comparison.json) 和 [正式 v3 五文件独立核对](postfreeze-evidence/round4/v3-published-independent-check.json)。当前源码逐文件 hash、两份独立测试 hash 及这些证据 hash 全列在机器回执，避免将旧回执当作当前实现的凭据。

后端预检仅验证必要路径、轻量 JSON 和解释器能响应，实际模型加载、内存、依赖或传输失败仍需由 worker 留存并对账。原子发布验证覆盖进程异常、并发与 SIGKILL，不宣称断电或磁盘持久化认证；被强制结束的 stage 有意保留作为证据。完成态校验不评价回答质量。既有 source guard 的可用性误杀、非专家暂定标签和 accepted 不等于计算授权的限制继续成立。本轮结果不构成真实案件或法律准确率、训练、合并或部署验收；主侧报告的完整 npm 检查与本次独立轻量复核分别记录。
