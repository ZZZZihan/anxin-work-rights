# ROUND19 金额作者自检

固定基线为 CODE `02cf204be8d13b39c330a3b4ff32f0421bf38ba6`。所有作者测试用该提交的库与评分依赖，并只覆盖本轮 money/arithmetic 两个产品文件；没有借入 CODE 同期 source-review WIP。

本轮针对两个明确问题：金额后的横线加完整年月/日历/时长不再自动作为减法；无金额的完整百分比进入 not_monetary。真正的减式 `-200元`、`-2000`、`-2000.05`、`-50%`、显式减/减去、数学负号 `−` 仍不可精确。日期检测只作用于 NFKC/Cf 检测副本，原文与 Unicode code-point 位置不改。

比例分类采用完整值锚定；支持纯百分比与有限比率标签，不把未知叙述一刀切。`四万元的50%`、`人民币50%`、金额未知加比例等仍保留为 monetary/null，供人工复核。百分比分类不计算金额。

## 实际证据

- `author.minimal-02cf-before-red.txt`：固定旧版最小 2 项，0 PASS / 2 FAIL。
- `author.final99-02cf-before-red.txt` → `author.final99-after-green.txt`：完全相同的 99 项，42 PASS / 57 FAIL → 99 PASS。覆盖 whole/cropped quote、源文短引用、fresh ingest、强制旧 exact、旧 null 不升级、raw/quote/位置保持、未知与真正金额保留。
- `author.first-after.txt`：中间 94/96，保留了误将 `-2000.50` 看成两段日期和 `百分比` 误分币的实际失败，后已修。
- `existing-native.with-assess-final.txt`：八份既有原生回归 853/853 PASS。
- `existing-vitest.with-assess-final.txt`：既有作者 485 项及旧独审 55 项，共 540/540 PASS。
- `scoped-lint.final.txt`：三文件限定 lint exit 0（无输出）。

首次既有回归夹具未带入固定基线 assess.mjs，造成一原生文件/一 Vitest suite 无法加载；分别保留在 `existing-native.final.txt` 与 `existing-vitest.final.txt`，不是最终绿证据。只补齐该提交现成依赖后，才得到上述 853/540 结果。

## 边界

这是实现者合成自检，独立 agent 审查、主侧整合、完整项目检查、HTTP 与 CI 各自单列。没有新模型调用、训练或部署。未更改 scorer、source、原标签、冻结源码/结果，未提交或推送。检测词表和时间语法有限，不声称穷尽所有自然语言；两段无单位日期仍保守 null，不验证真实月份天数/闰年。

所有文件、补丁与日志 SHA-256 见 `author.final-receipt.json`；当前产品和测试快照独立保存在本目录，旧失败原文未改写。
