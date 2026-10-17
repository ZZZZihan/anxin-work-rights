# 网络中断后的完整补充运行：适配器独立复核

复核时间：2026-10-17T03:34:40Z。结论：在当前登记、源码和目录布局下，补充运行适配器沿用同一冻结报告算法，没有选择主运行的成功答案拼入补充成绩，也不会覆盖主运行结果或主比较文件。本结论只涉及登记、目录隔离和离线复现入口，不包含正式主/补模型成绩的比较；正式输出完成后应另行复核。

## 范围与资料边界

只读审查 `replication/reproduce.py`、`registration.json`、`README.md`，并对照原冻结 reporting/freeze/run/assess/dependencies/guard 接口。读取原 freeze 的源码/输入哈希和主 DeepSeek 结果文件的原始字节哈希，没有解析新留出输入、标签、主/补模型原始回答或正式分数。没有真实模型/API/训练/Git 操作，没有修改冻结源码或补充适配器。额外 probe 与本记录均写在封存目录之外；probe 的数据、标签、运行目录全部来自公开 dev.make_record 和系统临时目录。

复核者未参与本次适配器实现。请求的子 Agent 配置为 `gpt-6.1-sol`、`ultra`；请求配置与底层运行配置的独立核验是不同事实。

## 静态路径与绑定检查

- 适配器只调用冻结的 `reporting.prepare`、`reporting.summarize`。没有复制或重写评分函数，没有读取主 DeepSeek 的 JSON 行来挑选成功结果。主结果只通过 `common.sha` 做整体哈希核对。
- `reporting.ROOT` 只改为补充目录；其 `data`、`freeze.json` 和 `results/qwen` 必须是指定的相对链接。freeze 模块自身的 ROOT 仍指向原始封存目录，verify/verify_run 继续用原源码、原 prompt 和原输入校验。输入哈希、完整 case_ids、实际 input snapshot、消息和工具 receipt 继续接受原有严格检查。
- 当前实际布局中，主 DeepSeek 与补充 DeepSeek 均为不同的真实目录；只有 Qwen 结果被链接复用。补充 review/comparison 均写在补充目录。
- registration 绑定的 parent freeze、adapter 和 primary results SHA256 均与当前实际文件一致。登记的 inputs_sha256 也与原 freeze 的 test.inputs.jsonl 哈希一致。
- reporting/freeze/assess/run/dependencies/guard 六个根级源码的实际字节哈希均仍匹配正式 freeze；没有以此补充运行改变算法或 prompt。
- 全新进程 `replication/reproduce.py --help` 通过。

## 可重复的独立离线反例

测试文件为同目录的 `REPLICATION_PROBE.py`。运行方式：

```text
python3 REPLICATION_PROBE.py /absolute/path/to/decision-baseline-v3
```

实际执行结果：PASS。probe 使用 6 条临时合成题、4 条非终态、两个后端，真正执行冻结的 finalize/assess/reporting 链路以及适配器 main，并完成 prepare-review、生成语义判定、summarize、--check 全流程。

关键反例特意构造为：主 DeepSeek 文件只有两条正确且成功执行的合法计算；补充 DeepSeek 在全部合法计算题上只追问、不计算。补充报告仍得到 **0 条合法计算成功**，Qwen 的两条合法成功保留，证明没有把主运行成功行混到补充报告。补充报告计划分母仍是完整 6 条/4 条非终态。

生成和复现后，主 DeepSeek 结果文件及主 comparison 哨兵文件逐字保持不变。额外篡改反例也通过：

- 主结果字节改变 → 适配器拒绝。
- 登记 adapter_sha256 不匹配 → 适配器拒绝。
- Qwen 链接虽指向相同真实目录、但从约定相对链接改成绝对链接 → 适配器拒绝。
- 未篡改时，补充 comparison 可以由同一入口逐字复现。

## 主报告与补充证据的解释边界

此轮是在主运行运输中断后决定的完整追加运行。登记声明最多一轮、全 72 条/64 次计划 API 调用、上界预算 2 美元、无自动重试、不是选择性失败样本重试；这不能追溯成原主运行的预注册组成部分。Qwen 复用原样结果，因此两份比较并非两组完全独立采样。主报告必须保留原运输失败与缺失分母，补充报告单独呈现，不能把后者替代前者或把两次 API 尝试拼为单一首次回答成绩。

以下为非阻塞的证据管理限制，正式交付应披露：

- 适配器没有单独核对 registration.inputs_sha256 字段；当前该字段实际正确，而且原 verify_run 仍严格绑定原冻结输入。若以后登记字段漂移，不能只以适配器通过就宣称每个声明字段都已验证。
- 补充 comparison 使用原冻结报告格式，本体没有直接加入 supplementary 标志或 registration/adapter 哈希。目录、README、登记和本记录共同区分两轮；若 comparison 脱离目录传播，须同时附带这些身份信息。
- 登记文件及适配器位于原 freeze 覆盖范围之外，属于事后追加证据。这里记录其哈希，但不把哈希或 registered_at 自述当成外部可信时间戳。本次没有解析请求日志来独立验证登记时间与首次补充请求的先后。
- 当前布局已实查分离；适配器不是通用的防恶意文件系统替换机制。正式汇总时仍应从已完成、停止写入的目录生成证据。

## 本次核对的 SHA256

| 文件 | SHA256 |
| --- | --- |
| 原 freeze.json | a85f7d67a110b731ba818f418390079a8f6fd105cc34a1983bf8e64be5bb0cc6 |
| replication/reproduce.py | f6650d81283ef4c2858c3b4a1da6880d113ef7196d3de8ebd4b9cc3eb9e7aac7 |
| replication/registration.json | 6c3d4824c847a34f346c66428bc552e3aee7d0e2904480446bae224449341a9c |
| 原 results/deepseek/results.jsonl | 261dac87f397ac435750d4132fbad69317d971216fb2a27a91d71553661e9111 |
| 外部 REPLICATION_PROBE.py | 97c103bdc52e667026268561fcfec138a464c8380c6e41a8348e164caf1edc4e |

若适配器、登记或上述主结果字节变化，应重新复核；不能沿用本记录来证明改变后的追加方案。
