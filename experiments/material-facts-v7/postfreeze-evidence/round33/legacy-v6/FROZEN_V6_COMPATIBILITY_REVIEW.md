# 旧 v6 冻结实验兼容入口复核

当前产品 v3 的 R33 修复保留，旧 v6 的 freeze、验证器、评分器、结果及汇总文件全部保留原字节。新增入口只在自有临时目录恢复已提交旧 v3，再执行原 verify 与 summarize --check。它验证历史可复现性，不代表当前产品通过旧评分标准。

固定 CODE 9fb69c543f15862d7aaaafacdc3a392de5e48f36 的 36 个 v6 冻结项中，仅 lib/material-facts-v3.ts 从 b1e5… 变为 77283…。v5 的 35 项和 v4 replication 的 108 项均相同；v4 的两项差异是原 amendment 已记录的 run/verify 变更。

Node 24.22.0 下原入口实际 exit 1，错误为旧 v3 摘要不符；新入口及兼容测试最终 10/10 PASS、exit 0，耗时 3.477 秒。测试实际执行原 verify 与原 summary --check，包含归档篡改/缺失、意外路径、同义 JSON 重写、其他 35 项漂移、回调异常清理及两个 symlink 写穿保护。限定 ESLint exit 0；319 个当前产品及旧实验文件前后摘要相同。

CI 建议把 v6 的 verify.mjs 和 summarize.mjs --check 两行合为 `node experiments/material-facts-v6/verify-frozen.mjs`，当前测试命令注册新增兼容 suite。v4/v5 的 CI 原入口保留。现有测试没有另行直接调用 v6 verifyPreflight/verifyExperiment；v6-eval 使用合成 assess，v7 原链通过其已有历史代码恢复入口取得旧 v3。没有修改被冻结测试、freeze 参考、旧 verifier 或 v25 的绑定列表。

作者为本 agent，需主侧作为非实现者最终审查、集成与 CI。未运行全检查、HTTP、模型或 v7/v25 长链，未提交推送。请求 GPT-6.1 Sol / ultra；实际 backend 无法独立核验。初始 8 项日志与 symlink 收紧后的最终 10 项日志均保留。详细摘要、边界和文件散列见同目录 JSON。
