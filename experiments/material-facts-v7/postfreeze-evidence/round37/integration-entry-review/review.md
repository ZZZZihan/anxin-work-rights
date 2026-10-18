# R37 最终整合入口只读复核

本次未发现实质阻塞。ROOT 实际登记 211 个互不重复的 mjs 模块，文件均存在；两条 Python 前置及 `--test-concurrency=2` 保留。CODE 当前应用测试集合在 ROOT 中完整保留；六个现存 R37 脚本、repeat-signal、native25/26 与 gate26/27 均各登记一次。

CI 的历史 v26 进入 `verify-correction-v26.mjs`，该入口恢复归档后运行历史 v26；当前 v27 进入 `corrective-assessment-v27.mjs --check`。没有直接把当前产品送入旧 v26 controller 的 CI 命令。

v27 manifest `37d4f9ae5f64d1dfe97d21a30a0a1d3f7ab4d7df0efa338e2a5f326b0a7cb49e` 的 100 项当前代码逐 SHA256 匹配，路径集合恰为旧 97 项加三个新工具。v26 的 97 项归档与旧 manifest、归档 manifest 全部匹配。repeat-signal 最终测试 `01827620…` 与 process-tree 测试 `a645b800…` 均不在这 100 项评分依赖内。R37 证据目录没有以 `.ts` 或 `.tsx` 结尾的文件；`.ts.snapshot` 不是裸编译源文件。

首次读取 HEAD 为 f2dfe2f，父 Agent 已通知在进行正常 merge；最终哈希核对处 HEAD 为 c2da90015f56fe6db80d36724285c6caedf08b80，选定读取文件与 100 项当前代码在收据前后未漂移。逐文件摘要见 JSON。

这是静态入口和文件散列复核，不是历史 CLI、完整测试、CI、模型或人工业务验收；未重新核查原124/原60保护集合。ROOT/CODE 未修改。
