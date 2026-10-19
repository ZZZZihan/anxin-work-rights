# ROUND13 HTTP 脚本准备说明

交付文件为 `scripts/material-facts-v7-http-regression.mjs`。以 CODE `25bc6e0074cb435e59cf3d89e1092e1891a04239` 中 SHA-256 `44837d7be12dec94e1777a4cbaff0d8d50d21087a7b4a1d52ff1a122da8d073b` 的脚本为基线，仅在 ROUND13 标记间插入新场景。删除新增块后，整个文件逐字节等于基线；没有修改旧断言、服务注入、进程回收或历史保存行为。任务树较旧脚本已另存 `http-own-pre-round13.mjs.snapshot`，基线另存 `http-code-25bc-baseline.mjs.snapshot`。

最终登记 74 个唯一场景，包含原 64 个及新增 10 个：

- `5元五角`、`5元零五分` 分别派生 `5.50`、`5.05`，保留 raw、value、quote、Unicode 码点位置和未确认状态。
- 上述完整金额仅裁剪成 `5元` 的两个候选均保留供复核、金额为 null。
- 孤立 `5分鐘`、`5分米`、`5角度` 三个候选分别拒收，原始输出和既有历史留存。
- 相同属性的两次 `5元五角` 付款分别保留候选及不同位置，不自动求和。
- 两种混合金额的历史 unsupported 派生结果在读取时不自动升级；只在本次临时 D1 合成旧记录，原始输出、源码位置、revision、history 不改，并核查读取不写回。
- `三万分红` 保留为一条金额未知候选，避免把金融用词误拒成无金额描述。

所有新增场景都加入原有 durableSnapshots，由现有重启场景继续检查存储、raw 和历史不被改写。

已实际完成语法检查及 scoped ESLint，退出码均为 0。局部任务树缺 React 安装产生的自动检测警告如实记录在准备回执。纯注册枚举从源代码提取场景注册片段，提供空操作回调，未执行任何场景操作；首次枚举遗漏原场景使用的纯 envelope helper 而报 ReferenceError，随后补齐同等 JSON helper 重跑成功，初次错误另存 `http-registration-initial-probe-failure.txt`。这不是 HTTP 行为失败或 HTTP 红绿证据。

本次作者没有启动服务、构建、运行 HTTP、调用模型或修改 v11 三个生产文件。`http-74-author-preparation.json` 的 PASS 仅指准备检查，不能记为 74 场景通过。主 Agent 将使用同一最终脚本分别对 ROOT 的精确 25bc 应用构建及最终 CODE 构建运行，报告应另用新文件保存；原 64/64 报告仍只是旧版本历史证据。合成注入 HTTP 也不构成真实模型或真人业务验收。
