# PR40 第三轮重复位置覆盖浏览器记录

最终整合 dist 上的真实本地 Worker HTTP、独立磁盘 D1 和 headed Chromium 检查通过。sourceCoverage 在两个主体使用相同金额与月份时仍指出第二处遗漏；没有补写候选或确认金额。

- 合成源文为同一 b1 块：王甲2024年7月完整应付工资8000元。李乙2024年7月完整应付工资8000元。
- 原回答仅王甲 money/date 两候选，raw 保持两项；API 的 money/date 覆盖均为 [true,false]。原存储 frozen coverage 仍 no_signal，实时 sourceCoverage 为 possible_missing，派生诊断未回写。
- 实际点击证据管家、展开遗漏线索与原回答，看到“2 条候选 · 可能有遗漏”、8000元与2024年7月。两项原文阅读复选框未勾选，应付/已付输入为空、确认仍 null，计算按钮禁用。
- 01-duplicate-occurrence-coverage-and-raw.png 同时展示遗漏提示、两候选和原回答；02-no-automatic-confirmation.png 展示空确认和禁用计算。两张均已目视核对。
- browser-console.txt 为0错误0警告；browser-requests.txt 是实际 GET /facts 的200记录，未拦截UI接口。

机器记录 report.json 包含最终源码/构建指纹、精确源文位置和清理结果；facts-response.json 是实际 HTTP 返回。run-isolated-worker.mjs 从当前目录读取 dist，seed-occurrence-fixture.mjs 填入完整合成分析契约并先断言 API；verify-browser.txt 是本轮实际浏览器断言。复现时需给专用浏览器会话设置 launcher 的严格合成用户头，实际进入证据管家并展开两处详情。

此次以正确的合成 analysis/fact 记录验证持久化读取和 UI 渲染，没有运行真实 OCR、外部模型或新的提取 POST；新提取近似/精确归一化由独立 API 测试覆盖。候选日期额外显示保守归属核对提示，原候选仍保留。未改产品源码、冻结实验、CI或生产。浏览器会话已关闭，launcher finally 已停止Worker并删除独立数据库、私有配置和临时元数据。
