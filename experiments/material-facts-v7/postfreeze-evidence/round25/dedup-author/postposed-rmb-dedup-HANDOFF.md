后置人民币包装去重：作者定向交付

固定基线为 CODE f16c59bc08c823538df00d6fa1fd2dbc139cd5a2，runtime SHA fdc82090ed1bc739cc753658492d6711b56eeef5c583aee925669f7058bb8262；运行后只读确认 CODE 的 lib 仍与该提交相符。只在 OWN 修改 runtime 嵌套去重 after 正则一行，加入 人民币/人民幣/RMB/CNY，保留原 整/正 和简繁三种工资后缀。唯一 occurrence、规范化状态、属性及审查 issue key 门禁不变。ROOT/CODE、冻结材料和模型输出未改。

最终同一作者测试：固定旧 34 项 16通过18失败（exit1），补丁 34通过（exit0）；所有正向夹具先证明实际来源复核金额为精确4000.00，才比较计数。旧去重12与简繁去重24共36项通过。语法两文件退出0；作用域lint退出0，仅有独立树 React 检测提示。实际 Node26.11.0，作者没有声称跑过 Node24、全check、HTTP或CI。

raw 保留两条原始候选与顺序、value/quote/源码和Unicode码点；实际入库仅合并同唯一位置的相同属性有限包装。不同事件、跨块、歧义位置、不同assertion、冲突币种和任意长叙述仍保留2项；无确认或计算。双输出顺序均覆盖。

中间32通过2失败已保留于 postposed-rmb-dedup-after-green.log，文件名不代表结论：作者给源4000元整人民币裁出4000元却期望exact，来源守护本已保守降级；最终正向最小value改为完整4000元整后，重新跑有效固定旧红与补丁绿。早期两份before日志和两个测试快照均保留，不能把夹具错误计作产品红。

可复制的两文件：

- lib/material-fact-runtime-ingest.ts：cbf7c724c30568ed1c5640410d6027baaed47503a4a09b7e39ed4e2ff0bd2bbc
- scripts/material-fact-postposed-rmb-dedup.test.mjs：4261b7d25792e7c4a292d0bd0a7d49a9edb11795ecd1e498e5da966a6f815d04

补丁：postposed-rmb-dedup.patch，SHA 4cdffa3afd73d353b5e09bd1c82a20a3bb3ffe3c75980aab6531aef046d3c0dd。机器回执：postposed-rmb-dedup-author-receipt.json，SHA 2e5291853625b56114b6e2143acdac10610fe5e34091075592097150d0d8fcd1。最终有效红：postposed-rmb-dedup-final-valid-fixed-f16-before-red.log；最终绿：postposed-rmb-dedup-final-valid-after-green.log；旧36项：postposed-rmb-dedup-existing-regressions-green.log。所有日志SHA列在机器回执。

本交付为合成实际运行时/存储验证，非模型或人工业务验收。主Agent整合后另做适用验证；作者未提交或推送。请求GPT-6.1 Sol/ultra，实际后端不能独立核验。
