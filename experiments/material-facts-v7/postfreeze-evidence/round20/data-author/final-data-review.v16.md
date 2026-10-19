v16 数据事实补充回执（作者只读核查）

v16 manifest SHA-256：`5e229a33ed6e71f26b4fb01c92e9f28da66122bffde84d23e8e82c1fb6dbca69`，前驱绑定为 v15 `bc7ba849ed3394cfc6e1a74aa01f93ccbced443602165f43f4900e9d4cb5d292`。本次轻量核对 4/4 产物哈希，并读取 67 项代码绑定数量；没有重跑深层 CLI、重算分数、调用模型或修改主树。

rules、Qwen、DeepSeek 三份 v16 report 与各自 v15 report **逐字节相同**，因此 final-data-review.md 中六项 TP/FP/FN 与 F1 数值仍适用。v16 comparison 是新版本记录，不能称它与 v15 comparison 相同。freeze、首跑 60 文件清单、输入/标签及三后端原始输出绑定在两个版本中一致。

本回执独立新增，不回写原 final-data-review.json/md，不代替主侧 --check、独立门禁或业务验收。逐报告哈希见 final-data-review.v16.json。
