#!/usr/bin/env python3
"""Read-only provenance checks of the final curated case JSON (stdlib only)."""
import hashlib
import json
from collections import Counter
from datetime import date
from pathlib import Path

def require(condition, message='validation failed'):
    if not condition:
        raise ValueError(message)
HERE = Path(__file__).resolve().parent
DATASET = HERE.parent.parent
sources = json.loads((HERE / 'sources.json').read_text(encoding='utf-8'))
cases = json.loads((HERE / 'cases.json').read_text(encoding='utf-8'))
coverage = json.loads((HERE / 'coverage.json').read_text(encoding='utf-8'))
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
    require(case['region'] is None, 'case region must remain undisclosed rather than inferred from court location')
    if case['decision_date'] is not None:
        parsed_date = date.fromisoformat(case['decision_date'])
        original_date = f'{parsed_date.year}年{parsed_date.month}月{parsed_date.day}日'
        require(original_date in case['outcome']['text'], 'decision date must be explicit in the reported disposition')
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
require(30 <= len(cases) <= 40 and all((topics[t] >= 5 for t in ['wage_arrears', 'employment_relationship'])), 'case expansion coverage is outside the requested range')
require(coverage['schema_version'] == 1 and coverage['annotation_status'] == 'agent_curated_not_legal_expert_reviewed', 'coverage metadata mismatch')
coverage_map = {entry['case_group_id']: entry for entry in coverage['cases']}
require(len(coverage_map) == len(coverage['cases']) == len(cases), 'coverage groups must be unique and complete')
merits_stages = {'arbitration', 'merits_judgment', 'merits_and_execution'}
other_stages = {'execution', 'execution_and_bankruptcy', 'bankruptcy', 'mediation', 'payment_order_and_mediation', 'mediation_and_arbitration_referral', 'coordinated_settlement', 'mediation_and_judicial_confirmation', 'administrative_coordination'}
for case in cases:
    entry = coverage_map.get(case['case_group_id'])
    require(entry is not None and entry['topics'] == case['topics'], 'coverage topic/group mismatch')
    require(entry['source_id'] == case['source_id'] and entry['source_url'] == source_map[case['source_id']]['url'], 'coverage source mismatch')
    require(entry['stage'] in merits_stages | other_stages
            and isinstance(entry['scenario'], str) and bool(entry['scenario'].strip()), 'coverage procedure/scenario missing')
    require(isinstance(entry['limitations'], list) and bool(entry['limitations'])
            and all(isinstance(item, str) and item.strip() for item in entry['limitations']),
            'coverage limitations must be a nonempty list of nonempty strings')
    require(type(entry['merits_supervision_eligible']) is bool, 'coverage merits eligibility must be boolean')
    require(entry['merits_supervision_eligible'] == (entry['stage'] in merits_stages), 'non-merits stages must not supply merits supervision')
require(coverage['uncovered'] and coverage['exclusions'], 'coverage gaps and exclusions must be explicit')
print(json.dumps(dict(status='PASS', sources=len(sources), cases=len(cases), topics=topics, exact_field_extracts_checked=extract_count, evidence_materials=sum((len(c['evidence']) for c in cases)), cited_rules=sum((len(c['cited_rules']) for c in cases)), decision_dates_disclosed=sum(c['decision_date'] is not None for c in cases), case_regions_disclosed=sum(c['region'] is not None for c in cases), issues_reported=sum(bool(c['issues']) for c in cases), issues_not_disclosed=sum(not c['issues'] for c in cases), linked_rules=sum(r['law_id'] is not None for c in cases for r in c['cited_rules']), coverage_groups=len(coverage_map), stages=Counter(entry['stage'] for entry in coverage['cases'])), ensure_ascii=False, indent=2))
