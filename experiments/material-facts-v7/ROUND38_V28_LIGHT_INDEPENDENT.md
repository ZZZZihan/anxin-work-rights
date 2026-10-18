v28 冻结产物 LIGHT 只读技术核验

结果：PASS，发现且完整保留 v27→v28 的报告差异。父侧 write 已实际退出 0，316.591293 秒；本收据形成时 check 仍在运行，不声明其已通过。manifest：`e223d58a86c6ae56aa5df36fb529ab5b6a66ad742f8f2c4a4c30def8aa4a2cbe`。

我未加载评分器、没有重投模型、运行历史链、构建或 HTTP。只读 Python 核算实际退出 0，0.069739 秒：12 案／43 gold／41 anchors、216 保存的评分分区／18 项汇总指标、103 当前代码／100 v27 归档／60 原始结果文件均核验通过；2057 个前后保护路径字节不变，其中父侧 1829 个 pre-write 路径全部匹配。

三路 18 项指标与 216 分区均同 v27，raw 116／accepted 104／rejected 12 不变。规则报告字节相同；Qwen 与 DeepSeek 报告字节不同。两者各在 `mf7-spc-kaiping-board`（报告 cases[5]、raw index 0）将“高达1.2亿元”由 exact／120000000.00 改为 approximate／null。DeepSeek 另加 `source_amount_context_mismatch`，review_issues 总数 54→55；原 46 个金额关联未决警告仍保留。46 个 accepted money 现为 **19 exact／25 approximate／2 unsupported**，非 null 金额由 21 降到 19。

原 raw/value/quote/blockId 和材料字节保持；派生的 normalization.span 随精确金额不可用置为 null，不能把它称为原始材料码点被删除。全部字段差异和两候选原始引文的 codepoint 落点详列于 JSON。

“高达”有时可强调精确值，此保守归类存在误拒可用性代价，不代表已经人工判断真实债务金额错误。F1 不变也不等于生产防御无变化。`calculation_authorized=false` 是报告的保守常量，不证明真实生产确认／计算流程已经验收。

角色披露：我实现过金额／范围／算式模块和版本准备工具，未实现评分匹配或标签。本次是对已保存分区的算术、数据绑定与诊断差异做 LIGHT 技术审计，不是重新语义评分、专家复标或用户业务验收；没有合并、部署、训练或新模型调用。请求配置为 GPT-6.1 Sol／ultra，实际后端未独立核验。
