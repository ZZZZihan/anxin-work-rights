R35 来源布局兼容闭合（作者收据）

最终 source：`898bcaff875349ba15edae9019c3676fc90431381ae201e13619f8da09297b95`。两个金额布局入口都使用同一有界检测视图：每一步必须直接相邻、同页且满足有限表达式片段或已验证同排文本框；页变化停止拼接。同页未知疑似续文保留 null/uncertain 和人工边界说明，不能断言已经组成范围或算式。关系提示继续保留，派生金额恢复不等于业务可用或确认。

本次完整读取主侧 80 个失败叶，并在隔离依赖上实际复跑原 11 个文件：1,725 项，1,645 通过 / 80 失败。47 项来自把同页连续片段写成每块一页的元数据；30 项是真正同页外币/问号续文漏防护；另有王近/王约两个可用性回归和一个缺省 bbox 异常。后三类通过源代码闭合；六个夹具文件用显式 samePage 参数迁移对应连续片段，未改断言和语义期望。

最终同一 11 文件 1,725 / 1,725 通过；原新增锁定 63 项仍 63 / 63；范围 ESLint 退出 0。0e9b 源码、主侧完整失败日志、本机 80 失败、55 失败和 6 失败中间记录均保留。其中 6 失败中包含作者在迁移草稿误引入的一处 samePage 变量错误，最终恢复该独立事件原页码并通过，不能归为产品旧缺陷。

`assessment-independent` 的变化已追到具体候选：105.7万元的第一笔/第二笔源块省略 bbox。新布局代码误读 undefined 坐标导致 TypeError，被 assessor 的错误保护捕获后接受数组清空；不是无金额表达被正确拒收。修复 Array.isArray 后，原六层 FP 期望保持不变。

关键文件：

- `compatibility-final-files.json`：8 个交付文件的绝对路径与完整 SHA。
- `fixture-migration-final.patch`：六文件精准页码迁移；`old-fixtures-before-migration/` 为原始字节。
- `source-from-compat-final.patch` 与 `source-0e9b-to-compat-final.patch`：基线与中间版差异。
- `all11-0e9b-before-compat.txt`、`all11-source-compat-migrated-second.txt`：同范围原红与最终绿。
- `layout-author-compat-final.txt`、`scoped-eslint-compat-final.txt`：63 项与范围 lint。

本 Agent 只执行轻量合成模块/集成测试；旧脚本中的合成 assessor 单元测试不等于复跑历史实验。没有运行 HTTP、build、fullcheck、历史 CLI、真实模型或训练，没有改标签和冻结结果，没有提交/推送。独立 Agent 审查及父侧整合验证另行记录。请求配置为 GPT-6.1 Sol / ultra，实际后端不可独验。
