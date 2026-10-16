# 数据字典 v1

所有文本为 UTF-8。未知值用 JSON `null` / SQL `NULL`，空列表表示原文未披露或没有被标注为该类型，不能解释为事件不存在。

| 对象 | 主要字段 | 含义 |
| --- | --- | --- |
| `sources` | `id,title,url,publisher` | 官方页面的稳定本地 ID 与实际来源 |
| | `published_on,retrieved_at` | 页面披露日期（可空）和带时区的真实采集时间 |
| | `raw_path,raw_sha256,encoding,text_path` | 数据集目录内相对路径、原始字节摘要、解码与清洗正文 |
| | `acquisition_method,usage_note` | 实际获取方式和来源复用边界；本版全部 direct_http |
| `paragraphs` | `id,source_id,ordinal,text` | 从原始 HTML 去外壳和统一空白后得到的段落；标点和法律用语不改写 |
| `cases` | `id,case_group_id,title,source_id` | 案例 ID、同案分组、原标题与来源 |
| | `topics` | wage_arrears=欠薪；employment_relationship=劳动关系确认；可同时属于两者 |
| | `region,decision_date` | 裁判地区和裁判日期；地域全部空；4个案例披露裁判日期，其余空，不推断 |
| | `source_refs` | 该案例正文范围内段落 ID 列表 |
| | `facts,claims,issues,reasoning` | 原文摘录数组；每项含 text/kind/refs；分类属于标注 |
| | `issue_disclosure` | reported_in_source 或 not_explicit_in_source，与 issues 是否为空对应 |
| | `outcome` | 官方叙述中的处理结果；text/refs |
| | `evidence` | 案例原文提及材料；不是上传原件 |
| | `cited_rules,tags,annotation_status` | 原文明示规则引用、加工标签与核读边界 |
| `evidence_descriptions` | `material_type,description,treatment,has_original,refs` | 材料类型、原文摘录、原文描述的处理状态、原件标志和出处；本版 has_original=0 |
| `laws` | `id,title,instrument_type,version_label` | 法规身份、文种和明确保存版本 |
| | `issued_on,effective_on,expires_on` | 公布/成文、所收录版本生效、失效日期；未知为空，不做全量现行性保证 |
| | `original_effective_on`（可选） | 原法末条披露的原法施行日，不混同修正版生效日；保留在 JSON/record_json |
| | `applicability,status_note,source_refs` | 适用地域、版本与效力限制说明、来源段落 |
| `provisions` | `id,law_id,label,text,topics,refs` | 选定完整条文、所属版本及逐字来源引用；label 保留原文条号写法 |
| `case_rule_citations` | `name,article,law_id,link_basis,refs,version_match,link_note` | name/article 为案例明示原文；目标法规仅名称级关联，版本尚未确认 |
| `citations` | `record_id,field_path,paragraph_id` | 各字段到源段落的可查询反向索引 |
| `search_documents` | `kind,title,topics_json,search_text` | 可重建关键词索引，只覆盖案例和所选条文 |
| `metadata` | `dataset_id,schema_version,data_fingerprint,status` | 候选数据身份、结构版本、内容摘要与核读状态 |
| `coverage.json`（独立说明） | `case_group_id,topics,scenario,source_id,source_url` | 与案例一一对应的主题、场景和准确来源；不添加原案未披露事实 |
| | `stage,merits_supervision_eligible,limitations` | 程序阶段、是否存在可阅读的实体处理叙述及使用限制；执行/破产/调解等不能冒充实体裁判答案 |
| | `selection_policy,exclusions,uncovered` | 选取办法、明确排除内容和当前未覆盖问题；不表示总体代表性 |

`statements.kind` 的取值包括 reported_fact（原文叙述事实）、party_assertion（当事人主张）、adjudicated_fact（明确事实认定）、issue（原文明确争点）、reasoning（案例分析或裁判理由）。取值可用不代表本次数据必然具有每种类型；没有清晰依据时不强行填充。

材料 `treatment` 为 mentioned / accepted / rejected / not_disclosed，表示原文提到、明确采信、明确否定或未披露处理；不是系统对证据真实性或证明力的判断。

SQLite 把 `topics`、各类陈述和材料数组拆为关联表；仍在 `cases/laws/sources.record_json` 保存完整 JSON。数据库 `provisions` 为规范化表，版本通过连接 laws 取得；导出的 `provisions.jsonl` 则已带入版本、状态和适用范围，防止单独导入时丢失。

本版 record_id 为本地稳定标识，不是法院案号。段落 ID 绑定冻结来源；原站变动后应创建新版本，不能悄悄覆盖旧段落。法律原文的“一、”与典型案例引用“第一条”等写法保持原貌，暂不自动推断跨写法条文外键。
