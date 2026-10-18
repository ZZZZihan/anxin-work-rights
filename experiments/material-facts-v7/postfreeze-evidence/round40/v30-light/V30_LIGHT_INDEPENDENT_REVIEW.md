**v30 独立 LIGHT 只读验收：PASS**

已按 ROOT 实际保存的 JSON、清单和字节核对，未调用模型、生产模块、评分器或历史 CLI，也未运行构建、HTTP 或完整检查。请求配置为 GPT-6.1 Sol / ultra，实际后端不可独立确认。该 Agent 曾参与数据及部分运行时修复；此收据是独立的保存结果算术/分区与字节核对，不是对本人产品实现的独立源码审查。

当前 v30 manifest 为 `e1b8b03588dc4f8de70e8f85156c370f4776219e9d14268b5df259027d8b56ba`。109 项当前代码全部与绑定相符，v29 的 106 项原字节归档完整，60 项原首跑结果及原始 124 项冻结绑定均相符。原124项按完整首跑归档的36项快照及88项未改原路径解析；旧32项归档也完整保留，没有用当前改后源码冒充原冻结代码。

保护范围重新枚举，没有只沿用旧84/34项清单：v1–v30共30个保存结果目录（每版实际文件集合与manifest逐项一致），v1–v29共29个代码归档，原17个data文件和18个review-evidence文件，20个名称含checkpoint的证据文件及其对应目录共902个文件。旧checkpoint索引中125个唯一文件的历史SHA也重新比对，复制时加`.snapshot`后缀的文件须匹配同一旧字节SHA。主侧2122项prewrite保护表全部相符；总计3248个读取路径前后SHA一致。没有旧独立SHA绑定的checkpoint附属文件，仅声称本次读取期间稳定，不能据此追溯证明历史每时刻未变。

材料仍为15个独立案例家族，3 dev/13参考事实及12 holdout/43参考事实；holdout共41个事件锚点，锚点按原文Unicode码点区间核对。共有7个官方公开网页，其中2页同时提供dev和holdout的不同案例，因此是案例/关联工程隔离，不能称网页隔离。标签仍为`provisional_non_expert`，未被本次验收修改，也不等于真人业务认可。

保存的36份系统输出仍是12份规则输出和24份模型响应，三路各12条、均stop。没有新模型首答或再次推理。候选为规则2/2/0、Qwen63/51/12、DeepSeek51/51/0（raw/accepted/rejected），合计116/104/12。按保存的匹配对重新检查216个分区：每个actual与gold索引完整且不重叠，命中对声明的event与该gold及actual对齐结果一致，再以TP/FP/FN算术核算18项precision/recall/F1。这不重新判断源文语义，不运行新的匹配算法。

下表每格为 TP/FP/FN；F1，分母均是同一12案43参考事实。

| 层 | 规则 | Qwen | DeepSeek |
| --- | --- | --- | --- |
| raw basic | 2/0/41；8.8889% | 16/47/27；30.1887% | 34/17/9；72.3404% |
| accepted basic | 2/0/41；8.8889% | 16/35/27；34.0426% | 34/17/9；72.3404% |
| raw relational | 0/2/43；0.0000% | 10/53/33；18.8679% | 27/24/16；57.4468% |
| accepted relational | 0/2/43；0.0000% | 10/41/33；21.2766% | 27/24/16；57.4468% |
| raw strict | 0/2/43；0.0000% | 8/55/35；15.0943% | 25/26/18；53.1915% |
| accepted strict | 0/2/43；0.0000% | 8/43/35；17.0213% | 25/26/18；53.1915% |

v30三份report与v29分别**逐字相同**，报告字段差异均为0；comparison仅`schema`、`previous_correction_manifest_sha256`、`change_reason`三项元数据变化，models字段没有变化。复评没有改善本次保存的模型回答，也没有自动修改原输出。

104条accepted中有46条金额：19 exact、25 approximate、2 unsupported；19条派生amount非空，27条为空。46条全部仍有`source_relation_unresolved`，没有一条“精确且无复核问题”的金额；保存诊断的`calculation_authorized`均为false。这些是防护和描述性比较数据，不能将accepted、派生精确金额或技术测试通过称为可直接计算、法律正确或真实业务验收通过。

主侧`v30 --check`回执记载退出0、384.294004秒；本Agent只读取其回执并核对两份日志SHA，没有独立执行该历史链。主侧write381.2497秒是父Agent报告，本LIGHT也未执行write。原失败、传输失败、自然空输出、gold及旧结果保持，未训练、未部署。

审计工具有两次准备错误，已原样保留：第一次checkpoint路径映射过窄，第二次把案例source_id误当出版网页ID。修正均只在OWN审计代码；第三次实际退出0。详见`audit-attempts.addendum.json`，不能将前两次说成被审产品或冻结资产失败。

关键收据与明细位于同目录：`attempt-3/audit.receipt.json`、`attempt-3/protected.before.json`和`protected.after.json`、`fresh-inventories.json`、`historical-manifest-chain.json`、`original-freeze-resolution.json`、`checkpoint-protection.json`以及两份v29-v30差异JSON。可复制文件以`copy-index.json`白名单为准；无需复制ROOT任何原始全文或大型构建目录。
