# ROUND29 追加：原 HTTP 未完成范围分类契约修正

主侧同 HTTP274 实跑 **273 通过、1 失败**；唯一失败 `round19_arithmetic--2000` 是 source e2d6 将原 `uncertain/null` 误归 `unsupported/null`。原报告、raw 和既有夹具预期全部保留。

同一 178 项作者脚本在 e2d6 实际 **177/1**，金额始终不可用。现将分类修正严格限定为原金额锚点后紧贴 `×/x/*` 乘号遮盖符，且完整布局已确证算式。`-2000` 保持不确定，`-200元` 保持范围；不更改裸乘号未知、不计算金额、不升级旧 null、不改原始字段与位置。

最终 source 与作者脚本 SHA 见 JSON。定向实际 **178/178、原五组 522/522、MONEY c600 作者交叉 233/233**，限定 ESLint exit 0。未运行 HTTP、build、全检查、历史链或模型。

本追加收据更新 source/作者交付版本；原 index.json/owned-final-review.* 仍保留为 e2d6 中间版本证据，当前复制请用 range-status-closure-index.json。
