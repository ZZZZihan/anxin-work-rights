# 混合单字角分的旧测试契约迁移

固定基线：25bc6e0074cb435e59cf3d89e1092e1891a04239。作者未修改下列旧测试，旧日志原样保留。三处旧 whole-value 拒绝与新授权范围冲突，由 ROOT 统一迁移：

1. lib/material-money-v4.test.ts:140：`40000元五角` 从 unsupported/null 移至 exact `40000.50` 正例。
2. scripts/material-fact-named-arithmetic-subunits.test.mjs:78：`5元五角` 从 invalid 列表移至精确正例 `5.50`。
3. scripts/material-facts-v7-round11-money-independent.test.mjs:148：完整 `5元五角` 从 unsupported 列表移至新提取精确正例 `5.50`。

必须保留：round11同文件:143的 `5元` 裁剪 `5元五角` 仍 null；作者旧测试的裁剪/算式/历史不升级边界不变；lib作者测试:234中 value裸40000截掉五角仍 unsupported。小数元、万亿元、全角数字、多位角分、角分倒序和普通分字词未在这次放开。

实际未迁移回归结果：400 native =398通过/2失败；550 money Vitest =549通过/1失败。三项失败恰为上述契约，未发现其他回归。新增作者191项覆盖新精确语法、邻近反例与历史不升级，全部通过。不要把未迁移的旧回归表述为全绿。
