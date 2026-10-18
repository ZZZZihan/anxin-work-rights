# PR40 最终整合浏览器记录

指定三项全部通过：Cases 推进 pending 提醒；非空 v2 漏提诊断与 9000 元线索；v3 费率跨主体/期间归属警告与原回答保留。使用 root 最终 dist、headed Chromium、真实本地 Worker HTTP 与独立磁盘 D1，未拦截 UI API。

完整机器记录见 report.json，最终真实 facts 响应见 facts-response.json，包含源码和构建指纹。本目录归档此次本地验证证据；报告中的旧 gitHead 是构建时的父提交，实际被测未提交修改由源码与构建 SHA-256 绑定。

## 截图

- 01-cases-pending.png：PATCH 200/true，已保存进度 2/5 与完整后台提醒。
- 02-cases-save-failure.png：真实 SQLite 故障导致 PATCH 500，数据库和 UI 均不推进。
- 03-cases-save-recovery.png：移除故障后实际点击重试，200/false，普通成功提示。
- 04-panel-v2-possible-missing.png：保留一条 v2 候选，展开遗漏线索 9000 元与原 schema 2 回答。
- 05-panel-rate-attribution-warning.png：费率 8000 元保留，主体/期间归属警告及原 schema 3 回答。
- 06-incomplete-fixture-source-error.png：首次额外打开源文时的真实错误边界，保留失败。
- 07-source-view-recovered.png：补全独立合成 fixture 后，通过页面 Reload 再次打开源文，显示王甲七月与李乙八月。

## 首次源文失败及恢复

直接写入临时 D1 的合成 analysis result_json 少了完整 MaterialResult 必需的 knowledge 字段，源文面板中的 KnowledgeResults 读取 query 报错。正常识别处理会存入 validateMaterialResult 的完整结果。已保留错误截图及 browser-console-with-fixture-failure.txt；仅用本地 /api/knowledge 的实际返回补全合成记录，产品源码未改。随后通过真实页面 Reload 和再次点击源文按钮恢复，并重新核对两类 Panel 提醒、原回答和禁用计算状态。不能将首次失败隐去，也不将本次正确 fixture 通过扩张为任意损坏历史分析都可恢复。

## 复现入口

从已构建工作树 cwd 运行本目录 run-isolated-worker.mjs。它读取 cwd 的 dist/server/wrangler.json，迁移独立临时 D1，并输出 loopback 地址；就绪元数据在 /tmp/anxin-cases-ui-isolation.json。使用 Playwright 专用会话访问该地址，设置 launcher 中的严格合成用户头，进入 #cases 实际点击完成本步，核对 pending 提示。

在同一 cwd 运行本目录 seed-integrated-fixtures.mjs，写入严格合成的两份材料，先执行真实 facts HTTP 与持久化断言；刷新页面后点击证据管家，展开两卡的线索和原始回答。种子已补全 knowledge。两份脚本均不接受生产地址；launcher 控制本地临时实例。结束时仅给就绪记录中的 launcherPid 发送 SIGTERM，由 finally 删除该实例及数据库，并仅关闭本次浏览器会话。

## 范围

这里证明本地真实 HTTP、D1 与实际 UI 渲染/交互，不证明外部模型提取质量、真实文件 OCR、上传下载、生产登录、移动端或人工验收。最终清理状态以 report.json 为准。
