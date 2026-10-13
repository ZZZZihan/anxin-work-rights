-- 欠薪案例与出处（一个案例可以有两个主题）
SELECT c.id, c.title, s.url
FROM cases c JOIN case_topics t ON t.case_id=c.id
JOIN sources s ON s.id=c.source_id
WHERE t.topic='wage_arrears';

-- 证据材料描述，并明确没有原件
SELECT c.title, e.material_type, e.description, e.treatment, e.has_original
FROM evidence_descriptions e JOIN cases c ON c.id=e.case_id;

-- 名称级法规连接：必须同时显示版本不确定性
SELECT c.title, r.name, r.article, l.version_label, r.version_match, r.link_note
FROM case_rule_citations r JOIN cases c ON c.id=r.case_id
LEFT JOIN laws l ON l.id=r.law_id;

-- 工资举证案例的字段引用，回到官方正文段落
SELECT ci.field_path, p.id, p.text, s.url
FROM citations ci JOIN paragraphs p ON p.id=ci.paragraph_id
JOIN sources s ON s.id=p.source_id
WHERE ci.record_id='case-spc-2024-wage-employer-burden'
ORDER BY ci.field_path, p.ordinal;

-- 条文必须与所属法规版本、状态一起使用
SELECT l.title, l.version_label, l.effective_on, l.status_note, p.label, p.text
FROM provisions p JOIN laws l ON l.id=p.law_id
WHERE instr(p.text,'工资')>0;
