v33 数据Agent只读 LIGHT：PASS。

核对 manifest `00a764d4f810af7e0a13fe1ae186807fd7503673a6cc19f7d0d15c6f28c6d6cf`。119份当前代码、116份v32旧代码归档、原freeze124绑定和首跑60结果全部相符；原32份代码封存和补全36份封存均保留。重新枚举v1–v33结果及v1–v32代码归档，2482项上次保存的不可变路径未变，本次2738条读取路径前后稳定。

本次是数据与部分运行时代码作者的只读核算；我参与了run.mjs修复，未实现v33版本生成/评分。它不是对自己run源码的非实现者复核，不是标签独审，也没有重新执行语义匹配、模型、评分/历史CLI、HTTP或完整测试。主侧write已实际exit0、158.240691秒，仅引用其回执；本次没有独立执行writer/checker。

216份保存的案例×后端×层级匹配分区均覆盖完整、互斥，成对expected/actual索引唯一，保存event_id一致；18行指标按TP/FP/FN重计均相符。三份report与v32逐字节相同，comparison仅schema、previous_correction_manifest_sha256和change_reason三项元数据变化，models完全不变。

| 系统 | raw/接受/拒收 | raw基础/关系/严格 F1 | 接受基础/关系/严格 F1 |
|---|---:|---:|---:|
| 规则 | 2/2/0 | 0.088889/0.000000/0.000000 | 0.088889/0.000000/0.000000 |
| Qwen | 63/51/12 | 0.301887/0.188679/0.150943 | 0.340426/0.212766/0.170213 |
| DeepSeek | 51/51/0 | 0.723404/0.574468/0.531915 | 0.723404/0.574468/0.531915 |

36份系统输出是24份模型响应加12份规则输出，复用同一次留出首答；共116候选、104接受、12拒收。标签/输入及原始输出哈希未变，没有在本次LIGHT调用模型。46个接受金额是19 exact、25 approximate、2 unsupported，19个非空、27个空；46个全部保留关系未核实警告，exact_without_issue为0。接受、精确数值、实际可计算事实是不同状态。

材料仍为3 dev/12 holdout，43条留出gold、41个事件anchor；15个案例family不同。7个官方来源网页有2页跨开发/留出集，不能称网页隔离。标签仍是非专家临时标注，模型业务语义错误和人工验收边界没有因本次发布修复而消失。

保护范围刻意排除持续追加的postfreeze-evidence诊断目录；本次不声明该目录的全量保护。旧结果/归档、原始verification失败记录和3份顶层checkpoint文档属于本次稳定核对范围。

具体证据：`attempt-1/audit.receipt.json`、`saved-partitions.json`、`protected.before.json`/`protected.after.json`、`historical-manifest-chain.json`、`original-freeze-resolution.json`和`v32-v33.comparison-diff.json`。两次审计脚本准备自检误匹配单列保留；实际只读LIGHT仅首轮执行一次并通过。

请求配置为GPT-6.1 Sol / ultra，实际后端未独立核验。
