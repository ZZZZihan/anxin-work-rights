# R43 runner 失效记录保全与生命周期修复

三项原始问题都在精确 b199f521 本地真实 runner CLI 的合成 worker/文件系统中复现：非法 JSON 先进入 events；活动 holdout 的前缀 outcome 被发布 manifest 后继续变化；第二 checkpoint 写失败把旧 outcome 截为 23 字节。最初 3 项 0 通过/3 失败记录保留。

最终同一锁定 17 项：b199 为 1 通过/16 失败，最终 dab72 在 Node24.22 和 Node26.11 各 17 通过。追加的 DeepSeek planned-prefix 两控制在中间 f4d9 为 0 通过/2 失败。两旧生命周期/监控 fixture 补齐 backend 与等价 requesting 事件后 Node24 共 13 通过，原有全部断言不变。限定 lint 与 4 文件 syntax 均通过。

实现将 JSON 解析及基本行结构、backend、已计划 id、重复结果、DeepSeek 请求/结果顺序检查移至 events append 之前；失败原行及当时缓冲余文单独保存。holdout 从分配到终态 checkpoint 持同一个实验锁；真正读取/发布的 verify/assess/summary 同锁由 ROOT 配套实现。outcome 用同目录唯一 wx stage 完整写后 rename，I/O 失败保留旧有效 JSON 和 stage。

证据为真实进程/实际文件副作用和原 verifier 函数体；输入、prompt/preflight、scorer 是明确合成夹具，worker 是本地 Node 字节生产器，未调用模型、网络或历史链。DeepSeek 两请求控制只核基本行协议，不声称验证 HTTP/model/token 语义。checkpoint I/O 失败保住旧 receipt 不等于可自动封存所有后续结果，可能仍需人工对账；不声称断电耐久。

本 Agent 参与 run 实现，这是作者回归收据；独立行为复核由另一 Agent 执行。原冻结/标签/输出/失败记录均不改，本收据不是重新执行原 124/60 全保护验证。最终复制仅按 copy-index，禁止整目录复制含可执行 fixture 的私有证据树。
