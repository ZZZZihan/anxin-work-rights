#!/usr/bin/env python3
"""Read-only provenance checks of the final curated case JSON (stdlib only)."""
import hashlib
import json
from collections import Counter
from pathlib import Path

def require(condition, message='validation failed'):
    if not condition:
        raise ValueError(message)
HERE = Path(__file__).resolve().parent
DATASET = HERE.parent.parent
sources = json.loads((HERE / 'sources.json').read_text(encoding='utf-8'))
cases = json.loads((HERE / 'cases.json').read_text(encoding='utf-8'))
source_map = {s['id']: s for s in sources}
laws = json.loads((HERE.parent / 'laws' / 'laws.json').read_text(encoding='utf-8'))
law_map = {law['id']: law for law in laws}
require(len(source_map) == len(sources), 'validation failed')
require(len({c['id'] for c in cases}) == len(cases), 'validation failed')
require(len({c['case_group_id'] for c in cases}) == len(cases), 'validation failed')
paragraph_map = {}
for source in sources:
    raw = (DATASET / source['raw_path']).read_bytes()
    require(hashlib.sha256(raw).hexdigest() == source['raw_sha256'], 'validation failed')
    require((DATASET / source['text_path']).read_text(encoding='utf-8') == '\n\n'.join((p['text'] for p in source['paragraphs'])) + '\n', 'validation failed')
    for p in source['paragraphs']:
        require(p['id'] not in paragraph_map, 'validation failed')
        paragraph_map[p['id']] = p['text']
        require(p['id'].startswith(source['id'] + ':'), 'validation failed')
required = {'id', 'source_id', 'title', 'topics', 'case_group_id', 'region', 'decision_date', 'source_refs', 'facts', 'claims', 'issues', 'evidence', 'outcome', 'reasoning', 'cited_rules', 'tags', 'annotation_status', 'issue_disclosure'}
extract_count = 0
for case in cases:
    require(required <= case.keys(), case['id'])
    require(case['source_id'] in source_map, 'validation failed')
    require(case['annotation_status'] == 'agent_curated_not_legal_expert_reviewed', 'validation failed')
    require(set(case['topics']) <= {'wage_arrears', 'employment_relationship'}, 'validation failed')
    require(case['region'] is None and case['decision_date'] is None, 'validation failed')
    require(case['issue_disclosure'] in {'reported_in_source', 'not_explicit_in_source'})
    require(bool(case['issues']) == (case['issue_disclosure'] == 'reported_in_source'))
    for item in case['issues']:
        require('争议焦点' in item['text'], 'title or holding must not be substituted for a disclosed issue')
    for item in case['facts']:
        if item['kind'] == 'adjudicated_fact':
            require(item['text'] != case['outcome']['text'], 'outcome must not be duplicated as a factual finding')
    case_refs = set(case['source_refs'])
    require(case_refs, 'validation failed')
    for ref in case_refs:
        require(ref in paragraph_map and ref.startswith(case['source_id'] + ':'), 'validation failed')

    def check_extract(text, refs):
        global extract_count
        require(refs and set(refs) <= case_refs, (case['id'], refs))
        joined = ''.join((paragraph_map[r] for r in refs))
        require(text in joined, (case['id'], 'not exact source extract', text))
        extract_count += 1
    for field in ['facts', 'claims', 'issues', 'reasoning']:
        for item in case[field]:
            require(item['kind'] in {'reported_fact', 'party_assertion', 'adjudicated_fact', 'issue', 'reasoning'}, 'validation failed')
            check_extract(item['text'], item['refs'])
    for material in case['evidence']:
        require(material['has_original'] is False, 'validation failed')
        require(material['treatment'] in {'mentioned', 'accepted', 'rejected', 'not_disclosed'}, 'validation failed')
        check_extract(material['description'], material['refs'])
    check_extract(case['outcome']['text'], case['outcome']['refs'])
    for rule in case['cited_rules']:
        require(set(rule['refs']) <= case_refs, 'validation failed')
        rule_text = ''.join((paragraph_map[r] for r in rule['refs']))
        require(rule['name'] in rule_text, 'validation failed')
        require(rule['article'] is None or rule['article'] in rule_text, 'validation failed')
        require(rule['link_basis'] == 'source_explicit', 'validation failed')
        require(rule['version_match'] == 'not_determined', 'validation failed')
        require(rule['link_note'], 'validation failed')
        if rule['law_id'] is not None:
            require(rule['law_id'] in law_map, 'validation failed')
            require(law_map[rule['law_id']]['title'] == rule['name'], 'validation failed')
            require(sum((law['title'] == rule['name'] for law in laws)) == 1, 'validation failed')
topics = Counter((t for case in cases for t in case['topics']))
require(12 <= len(cases) <= 16 and all((topics[t] >= 5 for t in ['wage_arrears', 'employment_relationship'])), 'validation failed')
print(json.dumps(dict(status='PASS', sources=len(sources), cases=len(cases), topics=topics, exact_field_extracts_checked=extract_count, evidence_materials=sum((len(c['evidence']) for c in cases)), cited_rules=sum((len(c['cited_rules']) for c in cases)), decision_dates_disclosed=0, case_regions_disclosed=0, issues_reported=sum(bool(c['issues']) for c in cases), issues_not_disclosed=sum(not c['issues'] for c in cases), linked_rules=sum(r['law_id'] is not None for c in cases for r in c['cited_rules'])), ensure_ascii=False, indent=2))
