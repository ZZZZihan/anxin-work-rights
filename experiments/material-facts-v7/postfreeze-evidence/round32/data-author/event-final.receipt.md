# ROUND32 每月工资支付日程有限修复

固定 `35bdbde669f639a497f8685383e7a3fd7c948c3f` 的 event 模块，新增两种完整布局：`王甲工资每月15日发放`、`王甲每月15日支付工资` 及既有四种支付动词/有限繁体字形。仅适用于合法完整 recurring 日期、individual/payment_date；它支持预定支付日归属，不宣称实际到账。

改动只在 `hasSupportedWagePaymentLayout` 内。原连续/唯一主体、heading、群体、否定/另一人/第三方付款、范围或裁剪日期、错误角色均保持保守。没有更改 raw、quote、subject、CP 位置或任何金额标准化；旧 null 不会升级。

作者纯模块 51 项固定旧版实际 **36P15F → 修后51P**，旧 ROUND31 模块 **44P**。完整 quote 与最小 quote、emoji CP 和参数不变均有断言。首次 scoped lint 因 OWN 缺 eslint 本地依赖而 exit2，原失败保留；使用已有 CODE eslint 配置的相同两文件 scoped lint exit0，无依赖安装或产品额外改动。

未执行 runtime/scorer/历史CLI/build/fullcheck/HTTP/模型；未改 ROOT/CODE、提交、推送或部署。请求 GPT-6.1 Sol ultra，实际 backend 无法独立核验。产品/新测试 SHA、命令、真实日志和限制详见 JSON；复制索引见 copy-index.json。
