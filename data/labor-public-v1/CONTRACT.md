# 公共劳动争议样例数据契约 v1

本样例仅覆盖 `wage_arrears`（欠薪）和 `employment_relationship`（劳动关系确认）。公开案例是信息来源，不是用户案卷；原文未披露的字段留空，不根据机构所在地推断案件地区，不把当事人主张写成裁判认定。

## 采集目录

案例负责 `curation/cases/`，法规负责 `curation/laws/`。每个目录包含 `sources.json`（数组）以及 `cases.json` 或 `laws.json`（数组）。原始 HTTP 响应保存在该目录的 `raw/`，清洗后的来源全文保存在 `clean/`。所有路径相对于本数据集目录。

来源字段：`id, title, url, publisher, published_on, retrieved_at, raw_path, raw_sha256, text_path, encoding, acquisition_method, usage_note, paragraphs`。`paragraphs` 为 `[{id: "source-id:p0001", text: "完整原文段落"}]`。来源 ID 全局唯一。`published_on` 不明为 null；`retrieved_at` 为真实采集时间。原始来源优先直接获取；有失败如实记录，不将搜索摘要当完整来源。

`text_path` 内容严格为 `paragraphs` 的 text 用两个换行连接并在末尾附一个换行。清洗只移除页面导航、脚本和多余空白，不改写正文，采集脚本或来源提取方法随该目录保存。`raw_sha256` 是保存的原始字节 SHA256。

## 案例记录

必需字段：`id, source_id, title, topics, case_group_id, region, decision_date, source_refs, facts, claims, issues, issue_disclosure, evidence, outcome, reasoning, cited_rules, tags, annotation_status`。

- `region` 和 `decision_date` 为原文明示的字符串或 null。时间范围可保留在 facts 中，不推断完整裁判日期。
- `source_refs` 为该案例正文对应的段落 ID 数组。
- `facts / claims / issues / reasoning` 为数组，元素 `{text, kind, refs}`；`kind` 可取 `reported_fact`（案例叙述）、`party_assertion`（当事人主张）、`adjudicated_fact`（明确裁判认定）、`issue` 或 `reasoning`。
- 本版这些 text 采用原文精确摘录。issues 非空对应 `issue_disclosure=reported_in_source`；没有原文明示争点时用空数组和 `not_explicit_in_source`，不以标题或裁判要旨冒充争点。完整裁判结果不重复标作事实认定。
- `evidence` 元素 `{material_type, description, treatment, has_original, refs}`；`treatment` 取 `mentioned / accepted / rejected / not_disclosed`。未取得公开原件时 `has_original=false`；没有证据描述时用空数组，不凭经验补写。
- `outcome` 为 `{text, refs}`。
- `cited_rules` 元素 `{name, article, refs, law_id, link_basis, version_match, link_note}`；`link_basis=source_explicit` 仅指原文明确提到规则名称。正式名称与所收录法规唯一相等时填 law_id，否则为 null；全部 `version_match=not_determined`，link_note 明示名称关联不等于适用版本认定。
- `annotation_status=agent_curated_not_legal_expert_reviewed`，技术复核不冒称专业人工审核。

`curation/cases/coverage.json` 是逐组覆盖说明，不替代案例精确原文。顶层包含 `schema_version, scope, annotation_status, selection_policy, exclusions, cases, uncovered`；每条 `cases` 记录包含 `case_group_id, topics, scenario, source_id, source_url, stage, merits_supervision_eligible, limitations`。`case_group_id` 与 cases.json 一一对应，来源及主题保持相同；场景、阶段与限制属于明确标明的 Agent 加工标注。`stage` 区分实体审理/仲裁、执行、破产、调解、司法确认及协商等程序。`merits_supervision_eligible=false` 的样本不得充作劳动关系或清偿责任的实体认定答案；`true` 也仅表示存在公开实体处理叙述，不代表专业审核或适用版本已经核定。未知实体结果不得由程序结果补写。

## 法规记录

必需字段：`id, source_id, title, instrument_type, version_label, issued_on, effective_on, expires_on, applicability, status_note, source_refs, articles, annotation_status`。

- 日期来源未披露为 null。`applicability` 为地区数组（如 `["全国"]`）；`status_note` 说明版本核对依据及现行性限制，不自动把网页可访问等同现行有效。
- effective_on 只表示所收录版本施行日，未核实为空；有需要时新增 original_effective_on 保存原法末条的施行日并在 status_note 说明区别。
- `articles` 为 `{id, label, text, refs, topics}` 数组；保存欠薪/关系确认相关的原文条款，label 如“第三十条”。`text` 必须由对应 refs 段落顺序连接（换行分隔），不得把释义冒充法条原文。
- `source_refs` 包含标题、日期、正文等支撑记录的段落 ID；引用应来自同一 source_id。

不设置效果指标的虚构成绩，不包含真实用户私有材料。数据库不是法律适用结论；案例中的条文引用与加工时补充的关联分别记录。原始来源保持其原有使用边界，免费访问不自动等于开放许可或可任意再分发。
