ca3 金额别名与界限比较键作者回执

只修改 `lib/material-money-v4.ts` 与新定向测试。基线为精确 ca3e6bcc154484e0169b85af8a7fc4ed3f8b6a97；全部依赖通过 git archive 捕获到 OWN 私有夹具，没有修改 CODE/ROOT。

`兩/億` 在原 token 识别后仅折叠解析副本，原 value/quote/raw/CP 不变。共享界限 grammar 用于比较键，仍逐字保留 qualifier 及其前后位置；上下界、不同限定词及 exact 不合并。新增别名的范围检测也只折叠检测副本；完整/裁剪及历史强制旧 exact 的传统范围端点均不可精确。

固定 138 项：精确旧版 71 PASS / 67 FAIL → 修复 138 PASS。另保留初 130 项旧红及初修 128 PASS / 2 FAIL 的传统范围右端回归；问题已修，失败证据未覆盖。

实际 ca3 的 validateLabel 具有 literal fallback，4 条相应标签旧版也不抛错；不能把“金标校验停止”写成已复现。真实改善是同事件、同一界限词的中文数字与 Arabic 数字表示可在六层抽取评分匹配；四条实测均 TP1/FP0/FN0，金额仍 null、计算授权为 false。没有改 assess/gold/原分数。

既有 money Vitest 三套 550/550 通过。七套相关原生测试实际 955 PASS / 2 FAIL；唯一两条失败来自 round20 author 第96行把 `兩萬圓`、`一億圓` 固定列为 unsupported，已与本轮新增支持冲突。这两个旧断言没有擅自改动，父 Agent 整合时需从旧 negative 列表移除或改为明确 positive；原失败日志保留，不能称旧957项全绿。语法2文件通过，限定 lint 退出0。

未运行 HTTP、build、完整 npm check、CI、历史深链或新模型。未提交、推送、部署、训练或改冻结对象。精确 SHA 和日志清单见同目录 money-alias-bounds-author-receipt.json。
