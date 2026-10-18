v30 工具已准备，尚未发布。

固定 ROOT e4fadab 的 v29 清单 d66b3c2c 绑定 106 份代码，已在父级合入 R40 前逐字捕获；归档 106 个 snapshot + manifest，SHA a439eae6。新增历史 v29 桥、v29 恢复器、当前 v30 控制器后，当前依赖并集为 109。

实际执行仅 Node v24.22.0 的 7 项合成原生子进程测试、106 份恢复及回调抛错清理、12 项语法/ESLint、静态摘要/版本/并集校验。2014 项历史 ROOT 资产前后同 SHA。900000 ms 共享绝对截止与每级 2000 ms 清理预留、旧政策及旧桥字节未改。两项重门禁及真实历史 CLI、评分器、write/check、模型均未执行。不能据此称 v30 指标或业务验收通过。

初稿的两个保护版本列表漏最后版本，静态审计 fail-closed，初始字节与失败输出保留；现已修正并逐项核验，不计作产品失败。

复制仅用 copy-index.json 白名单：六个工具/测试、correction-code-v29 归档、所列证据。整个 .scratch 支持树不应复制。package/CI 仅建议补丁，基于父级已合 R40 的 HEAD 061b907bd20c06712fc3f483377a616bba6eefa7，保留原测试及并发 2，新增 native29/current30，并保留 verify28 后增加 verify29/current30。原 v29 产物、原始 60 结果和标签均不改。
