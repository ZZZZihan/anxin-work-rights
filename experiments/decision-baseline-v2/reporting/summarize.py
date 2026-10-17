#!/usr/bin/env python3
"""Offline reproduction of four-arm paired metrics plus independent Agent review.

Frozen assess.py owns all canonical/action-field/execution scores. This module
only validates artifacts, joins blinded review, and reports declared conjunctions.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

sys.dont_write_bytecode = True
from prepare_review import (ROOT, SCHEMA, MAPPING_SCHEMA, BACKENDS, VARIANTS, by_id,
    json_bytes, load_context, load_run, make_packet, needs_review, normalized_output,
    packet_digest, read_json, read_jsonl, require, sha, validate_review,
    verify_run_snapshot, write_exclusive)

METRICS = ('canonical', 'system_action_question_semantic', 'model_raw_semantic',
           'executable_canonical_question_semantic')


def load_reviews(review_dir, runs, context):
    review_dir = Path(review_dir).resolve()
    pattern = r'blind-(batch[1-9][0-9]*)\.jsonl'
    import re
    paths = sorted(p for p in review_dir.glob('blind-batch*.jsonl') if re.fullmatch(pattern, p.name))
    require(bool(paths), 'No blind-batch*.jsonl files found')
    batches = {re.fullmatch(pattern, p.name).group(1) for p in paths}
    mapped = {p.name[len('blind-'):-len('-mapping.json')] for p in review_dir.glob('blind-batch*-mapping.json')}
    judged = {p.name[len('semantic-'):-len('.json')] for p in review_dir.glob('semantic-batch*.json')}
    require(batches == mapped == judged, 'Orphaned packet, mapping, or semantic-review batch')
    review, used_review_ids, sources, source_paths, batch_info = {}, set(), {}, {}, []
    declared_arms = set()
    for packet_path in paths:
        batch = re.fullmatch(pattern, packet_path.name).group(1)
        mapping_path = review_dir / f'blind-{batch}-mapping.json'
        semantic_path = review_dir / f'semantic-{batch}.json'
        mapping, semantic = read_json(mapping_path), read_json(semantic_path)
        require(mapping.get('schema_version') == MAPPING_SCHEMA and mapping.get('batch') == batch, 'Invalid mapping identity')
        require(mapping.get('blinded_file') == packet_path.name and mapping.get('packet_sha256') == sha(packet_path), 'Mapping/packet hash mismatch')
        for key in ('inputs_sha256', 'labels_sha256', 'freeze_sha256'):
            require(mapping[key] == context[key], f'{batch}: sealed {key} mismatch')
        require(mapping.get('reporting_source_sha256') == sha(Path(__file__).with_name('prepare_review.py')), f'{batch}: packet builder changed')
        require(set(semantic) == {'schema_version', 'batch', 'packet_sha256', 'reviewer', 'cases'}, f'{batch}: unexpected review document keys')
        require(semantic['schema_version'] == SCHEMA and semantic['batch'] == batch and semantic['packet_sha256'] == sha(packet_path), f'{batch}: semantic-review identity/hash mismatch')
        reviewer = semantic['reviewer']
        require(isinstance(reviewer, dict) and reviewer.get('kind') == 'independent_agent' and reviewer.get('human_expert') is False, 'Review must disclose independent Agent, not human expert')
        require(isinstance(reviewer.get('model_requested'), str) and bool(reviewer['model_requested']) and isinstance(reviewer.get('reasoning_effort_requested'), str) and bool(reviewer['reasoning_effort_requested']), 'Requested reviewer configuration is missing')
        packets = by_id(read_jsonl(packet_path), field='review_id', source=str(packet_path))
        rows = by_id(semantic['cases'], field='review_id', source=str(semantic_path))
        require(set(packets) == set(rows) == set(mapping['cases']), f'{batch}: missing or extra review IDs')
        require(not (used_review_ids & set(packets)), 'Review IDs duplicated across batches')
        used_review_ids.update(packets)
        targets_by_arm = defaultdict(set)
        for key, manifest in mapping['runs'].items():
            require(key in runs and key == f'{manifest["backend"]}/{manifest["variant"]}', f'{batch}: unknown arm manifest')
            run = runs[key]
            # Original absolute run_dir is audit metadata only; arm key + hashes
            # resolve the current checkout portably on macOS and Linux.
            require(manifest['artifact_sha256'] == run['artifact_sha256'], f'{batch}: run artifacts changed after review preparation')
            require(len(manifest['selected_case_ids']) == len(set(manifest['selected_case_ids'])), 'Duplicate selected IDs in manifest')
            declared_arms.add(key)
        for review_id, packet in packets.items():
            target = mapping['cases'][review_id]
            key = f'{target["backend"]}/{target["variant"]}'
            ident = target['id']
            require(key in mapping['runs'] and key in runs and ident in context['records'], f'{batch}: invalid review target')
            joined_key = (key, ident)
            require(joined_key not in review, f'{key}/{ident}: duplicated across review batches')
            require(packet_digest(packet) == target['packet_sha256'], f'{review_id}: packet row hash mismatch')
            require(packet == make_packet(ident, runs[key], context, review_id), f'{review_id}: packet text/output differs from immutable run')
            output, _ = normalized_output(runs[key]['results_by_id'].get(ident, {}))
            require(needs_review(context['gold'][ident], runs[key]['cases'][ident], output), f'{review_id}: unexpected review target')
            validate_review(rows[review_id], packet)
            review[joined_key] = rows[review_id]
            targets_by_arm[key].add(ident)
        for key, manifest in mapping['runs'].items():
            require(targets_by_arm[key] == set(manifest['selected_case_ids']), f'{batch}/{key}: mapping cases differ from run manifest')
        for path in (packet_path, mapping_path, semantic_path):
            logical_path = f'review/{path.name}'
            sources[logical_path] = sha(path)
            source_paths[logical_path] = path
        batch_info.append({'batch': batch, 'rows': len(packets), 'reviewer': reviewer,
                           'packet_sha256': sha(packet_path), 'semantic_sha256': sha(semantic_path)})
    expected = set()
    for key, run in runs.items():
        for ident, case in run['cases'].items():
            output, _ = normalized_output(run['results_by_id'].get(ident, {}))
            if needs_review(context['gold'][ident], case, output):
                expected.add((key, ident))
    require(set(review) == expected, f'Blind review incomplete or extra: missing={len(expected-set(review))}, extra={len(set(review)-expected)}')
    require(declared_arms == set(runs), 'Every arm must have an explicit review manifest, even if zero cases selected')
    return review, sources, source_paths, batch_info


def metric_count(values):
    values = list(values)
    applicable = [v for v in values if v is not None]
    require(all(type(v) is bool for v in applicable), 'Metric values must be boolean or not applicable')
    correct = sum(applicable)
    return {'correct': correct, 'planned_denominator': len(values),
            'applicable_denominator': len(applicable), 'not_applicable': len(values)-len(applicable),
            'rate_of_planned': correct/len(values) if values else None,
            'rate_of_applicable': correct/len(applicable) if applicable else None}


def group_metrics(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[row['group_id']].append(row)
    complete = [items for items in groups.values() if len(items) == 2]
    return {'groups_in_scope': len(groups), 'complete_two_case_groups': len(complete),
            'singleton_groups_excluded': sum(len(items) == 1 for items in groups.values()),
            'both_cases_correct': {name: metric_count(
                None if any(r[name] is None for r in items) else all(r[name] for r in items)
                for items in complete) for name in METRICS}}


def latency_summary(values, planned_calls):
    require(all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in values), 'Invalid model latency')
    values = sorted(values)
    return {'reported_model_calls': len(values), 'model_calls_missing_latency': planned_calls-len(values),
            'median': statistics.median(values) if values else None,
            'p95_nearest_rank': values[max(0, math.ceil(.95*len(values))-1)] if values else None,
            'max': max(values) if values else None, 'sum': sum(values),
            'excludes_model_loading_and_program_bypass': True}


def usage_and_cost(rows, backend, pricing):
    fields = ('prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens', 'total_tokens')
    usage, qwen_tokens = Counter(), Counter()
    with_usage, priced, peak = 0, 0, Decimal('0')
    rates = pricing['usd_per_million_peak']
    response_models, fingerprints = Counter(), Counter()
    for row in rows:
        for key in ('input_tokens', 'output_tokens'):
            if key in row:
                require(type(row[key]) is int and row[key] >= 0, 'Invalid local token count')
                qwen_tokens[key] += row[key]
        u = row.get('usage')
        if isinstance(u, dict):
            with_usage += 1
            for key in fields:
                if key in u:
                    require(type(u[key]) is int and u[key] >= 0, f'Invalid provider usage {key}')
                    usage[key] += u[key]
            if 'completion_tokens' in u and ('prompt_tokens' in u or 'prompt_cache_miss_tokens' in u):
                hit = u.get('prompt_cache_hit_tokens', 0)
                miss = u.get('prompt_cache_miss_tokens', max(0, u.get('prompt_tokens', 0)-hit))
                peak += (hit*Decimal(str(rates['cache_hit'])) + miss*Decimal(str(rates['cache_miss'])) + u['completion_tokens']*Decimal(str(rates['output'])))/Decimal('1000000')
                priced += 1
        if row.get('response_model') is not None:
            response_models[str(row['response_model'])] += 1
        if row.get('system_fingerprint') is not None:
            fingerprints[str(row['system_fingerprint'])] += 1
    cost = None
    if backend == 'deepseek':
        cost = {'currency': 'USD', 'peak_estimate': float(peak) if priced else None,
                'off_peak_estimate': float(peak*Decimal(str(pricing['off_peak_multiplier']))) if priced else None, 'requests_with_usable_usage': priced,
                'requests_not_priced': len(rows)-priced, 'actual_billed_cost': None,
                'failed_request_billing': 'unknown; not inferred',
                'usd_per_million_peak': rates, 'off_peak_multiplier': pricing['off_peak_multiplier'],
                'pricing_verification': 'verification/pricing.json',
                'verified_at': pricing.get('verified_at'), 'request_model': pricing.get('request_model'),
                'pricing_source': pricing['source']}
    return {'provider_reported_usage': dict(usage), 'requests_reporting_usage': with_usage,
            'model_calls_without_usage': len(rows)-with_usage, 'local_tokens': dict(qwen_tokens),
            'response_models': dict(response_models), 'system_fingerprints': dict(fingerprints),
            'cost_estimate': cost}


def resources(run, rows, pricing):
    by_id = run['results_by_id']
    actual = [by_id[r['id']] for r in rows if r['model_invoked'] and r['id'] in by_id]
    result = {'model_calls': len(actual),
              'latency_seconds': latency_summary([r['latency_seconds'] for r in actual if 'latency_seconds' in r], len(actual)),
              'finish_reasons': dict(Counter(str(r.get('finish_reason')) for r in actual)),
              'request_errors': sum(r.get('finish_reason') == 'request_error' for r in actual),
              'usage': usage_and_cost(actual, run['backend'], pricing)}
    if run['backend'] == 'qwen':
        peaks = [r['mlx_peak_bytes'] for r in actual if 'mlx_peak_bytes' in r]
        require(all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in peaks), 'Invalid MLX peak memory')
        result['mlx_peak_memory'] = {'reported_calls': len(peaks), 'missing_calls': len(actual)-len(peaks),
            'max_bytes': max(peaks) if peaks else None, 'max_gib': max(peaks)/(1024**3) if peaks else None,
            'meaning': 'MLX allocator peak per inference; not process RSS or system memory'}
    return result


def run_environment(run):
    path = run['run_dir']
    result = {'model': run['protocol'].get('model'), 'guard': run['protocol'].get('guard')}
    for filename, key in (('outcome.json', 'outcome'), ('load.json', 'model_loading'),
                          ('memory-before.json', 'memory_before'), ('memory-after.json', 'memory_after')):
        result[key] = read_json(path/filename) if (path/filename).exists() else None
    telemetry = read_jsonl(path/'telemetry.jsonl') if (path/'telemetry.jsonl').exists() else []
    snapshots = [v for v in (result['memory_before'], *telemetry, result['memory_after']) if isinstance(v, dict)]
    pressures = [v['pressure_level'] for v in snapshots if type(v.get('pressure_level')) in (int, float)]
    swaps = [v['swap_used_bytes'] for v in snapshots if type(v.get('swap_used_bytes')) in (int, float)]
    before = result['memory_before']
    baseline = before.get('swap_used_bytes') if isinstance(before, dict) else None
    result['system_memory_observation'] = {'telemetry_samples': len(telemetry),
        'max_pressure_level': max(pressures) if pressures else None,
        'max_swap_used_bytes': max(swaps) if swaps else None,
        'max_swap_growth_bytes_from_before': max(swaps)-baseline if swaps and type(baseline) in (int, float) else None,
        'meaning': 'Host-wide observations, not memory attributable exclusively to this model'}
    return result


def paired_values(old_values, new_values):
    require(set(old_values) == set(new_values), 'Paired case/group IDs differ')
    counts = Counter(new_wins=0, old_wins=0, ties=0, ties_both_correct=0, ties_both_incorrect=0, incomparable=0)
    for key in old_values:
        old, new = old_values[key], new_values[key]
        if old is None or new is None:
            counts['incomparable'] += 1
        elif old == new:
            counts['ties'] += 1
            counts['ties_both_correct' if old else 'ties_both_incorrect'] += 1
        else:
            counts['new_wins' if new else 'old_wins'] += 1
    return {'planned_pairs': len(old_values), 'comparable_pairs': len(old_values)-counts['incomparable'], **dict(counts)}


def paired_cohort(old_rows, new_rows):
    old, new = by_id(old_rows), by_id(new_rows)
    require(set(old) == set(new), 'Paired cohort IDs differ')
    groups = defaultdict(list)
    for ident, row in old.items():
        require(row['group_id'] == new[ident]['group_id'], 'Paired group identity differs')
        groups[row['group_id']].append(ident)
    complete = {g: ids for g, ids in groups.items() if len(ids) == 2}
    output = {'planned_cases': len(old), 'complete_two_case_groups': len(complete),
              'singleton_groups_excluded': sum(len(ids) == 1 for ids in groups.values()), 'metrics': {}}
    for name in METRICS:
        old_group = {g: None if any(old[i][name] is None for i in ids) else all(old[i][name] for i in ids) for g, ids in complete.items()}
        new_group = {g: None if any(new[i][name] is None for i in ids) else all(new[i][name] for i in ids) for g, ids in complete.items()}
        output['metrics'][name] = {'case': paired_values({i: r[name] for i, r in old.items()}, {i: r[name] for i, r in new.items()}),
                                   'group_both_cases_correct': paired_values(old_group, new_group)}
    return output


def summarize(*, root=ROOT, review_dir=None, output=None, run_dirs=None):
    context = load_context(root)
    root = context['root']
    pricing_path = root/'verification/pricing.json'
    pricing = read_json(pricing_path)
    pricing_sha = sha(pricing_path)
    require(pricing.get('actual_invoice_verified') is False, 'Pricing must disclose invoice not verified')
    require(set(pricing['usd_per_million_peak']) == {'cache_hit','cache_miss','output'}, 'Unexpected pricing rate keys')
    require(all(type(v) in (int,float) and math.isfinite(v) and v >= 0 for v in pricing['usd_per_million_peak'].values()), 'Invalid verified pricing')
    require(type(pricing['off_peak_multiplier']) in (int,float) and 0 <= pricing['off_peak_multiplier'] <= 1, 'Invalid off-peak multiplier')
    run_dirs = run_dirs or [root/'results'/f'test-{b}-{v}' for b in BACKENDS for v in VARIANTS]
    run_list = [load_run(path, context) for path in run_dirs]
    runs = {run['key']: run for run in run_list}
    require(len(runs) == len(run_list) == 4 and set(runs) == {f'{b}/{v}' for b in BACKENDS for v in VARIANTS}, 'Exactly four unique qwen/deepseek v1/v2 arms required')
    review, review_sources, review_source_paths, batches = load_reviews(review_dir or root/'review', runs, context)
    arms, rows_by_arm = {}, {}
    for key, run in runs.items():
        rows = []
        for label in context['labels']:
            ident = label['id']
            case, judged = run['cases'][ident], review.get((key, ident))
            quality = judged['question_text_adequate'] if judged else None
            gate = judged['business_action_correct'] and quality is not False if judged else True
            if not judged:
                output_shape, _ = normalized_output(run['results_by_id'].get(ident, {}))
                require(not needs_review(label, case, output_shape), 'Unreviewed question/error cannot receive semantic credit')
            rows.append({'id': ident, 'group_id': label['group_id'], 'category': label['category'],
                         'terminal_case': case['terminal_case'], 'model_invoked': case['model_invoked'],
                         'canonical': case['canonical_correct'],
                         'system_action_question_semantic': bool(case['system_action_fields_correct'] and gate),
                         'model_raw_semantic': (bool(case['raw_action_fields_correct'] is True and gate)
                                                if case['model_invoked'] else False if case['missing_result'] else None),
                         'executable_canonical_question_semantic': bool(case['canonical_correct'] and gate),
                         'validation': 'independent_blind_agent' if judged else 'frozen_deterministic_non_question',
                         'review_id': judged['review_id'] if judged else None,
                         'business_action_correct_review': judged['business_action_correct'] if judged else None,
                         'question_text_adequate_review': quality,
                         'raw_action_fields_correct_frozen': case['raw_action_fields_correct'],
                         'system_action_fields_correct_frozen': case['system_action_fields_correct'],
                         'request_error': case['request_error'], 'missing_result': case['missing_result']})
        rows_by_arm[key] = rows
        cohorts = {}
        for cohort, selected in (('all', rows), ('nonterminal', [r for r in rows if not r['terminal_case']]), ('terminal', [r for r in rows if r['terminal_case']])):
            require(len(selected) == {'all':72, 'nonterminal':64, 'terminal':8}[cohort], 'Unexpected cohort denominator')
            invoked = [run['cases'][r['id']] for r in selected if r['model_invoked']]
            cohorts[cohort] = {'planned_cases': len(selected), 'model_invoked': len(invoked),
                'program_bypass': run['assessment'][cohort]['program_bypass'],
                'missing_results': sum(r['missing_result'] for r in selected),
                'request_errors': sum(r['request_error'] for r in selected),
                'metrics': {name: metric_count(r[name] for r in selected) for name in METRICS},
                'raw_strict_json': {'correct':sum(c['raw_strict_json'] is True for c in invoked), 'denominator_actual_model_calls':len(invoked)},
                'protocol_accepted': {'correct':sum(c['protocol_accepted'] is True for c in invoked), 'denominator_actual_model_calls':len(invoked)},
                'groups': group_metrics(selected), 'resources': resources(run, selected, pricing),
                'frozen_assessment_aggregate': run['assessment'][cohort]}
            raw = cohorts[cohort]['metrics']['model_raw_semantic']
            raw['actual_model_call_denominator'] = len(invoked)
            raw['rate_of_actual_model_calls'] = raw['correct']/len(invoked) if invoked else None
        arms[key] = {'cohorts': cohorts, 'environment': run_environment(run),
                     'independently_reviewed_rows': sum(r['review_id'] is not None for r in rows),
                     'review_action_disagrees_with_frozen_diagnostic': sum(r['review_id'] is not None and r['business_action_correct_review'] != r['system_action_fields_correct_frozen'] for r in rows),
                     'artifact_sha256': run['artifact_sha256'], 'cases': rows}
    paired = {}
    for backend in BACKENDS:
        old, new = rows_by_arm[f'{backend}/v1'], rows_by_arm[f'{backend}/v2']
        paired[backend] = {cohort: paired_cohort(
            [r for r in old if cohort == 'all' or r['terminal_case'] == (cohort == 'terminal')],
            [r for r in new if cohort == 'all' or r['terminal_case'] == (cohort == 'terminal')])
            for cohort in ('all', 'nonterminal', 'terminal')}
    report = {'schema_version':'anxin-paired-report-v1',
        'scope':'72 Agent-authored synthetic snapshots in 36 paired groups; no training; no real-case or expert accuracy claim',
        'review_status':'independent blind Agent review, not human expert validation',
        'metric_definitions': {
            'canonical':'unchanged frozen assessment canonical_correct, including declared execution_ok',
            'system_action_question_semantic':'frozen system_action_fields_correct AND reviewed business action true AND question_text_adequate is not false; deterministic non-question rows need no review',
            'model_raw_semantic':'same conjunction using frozen raw_action_fields_correct when invoked; only an actual program bypass is null/NA and never a model success; missing results are false and retained in paired comparisons',
            'executable_canonical_question_semantic':'frozen canonical_correct AND reviewed business action true AND question_text_adequate is not false; v1 is legacy arithmetic replay, v2 is local dispatcher',
            'denominators':'planned 72/64/8 always retained; raw semantic additionally reports applicable rows (including missing failures) and actual model calls separately; format/protocol use actual model calls only',
            'paired':'same backend/input v2 vs v1; group score requires both original group cases present and correct; singleton cohorts excluded, raw NA reported incomparable'},
        'inputs_sha256':context['inputs_sha256'], 'labels_sha256':context['labels_sha256'], 'freeze_sha256':context['freeze_sha256'],
        'reporting_source_sha256':{name:sha(Path(__file__).with_name(name)) for name in ('prepare_review.py','summarize.py')},
        'pricing_source': {'path':'verification/pricing.json', 'sha256':pricing_sha, 'verified':pricing},
        'review_source_sha256':review_sources, 'review_batches':batches, 'arms':arms, 'paired':paired}
    for run in runs.values():
        verify_run_snapshot(run)
    for path, digest in review_sources.items():
        require(sha(review_source_paths[path]) == digest, 'Review source changed during summarization')
    require(sha(pricing_path) == pricing_sha, 'Pricing source changed during summarization')
    if output is not None:
        write_exclusive(output, json_bytes(report, pretty=True))
    return report


def self_test():
    """Exercise reporting with invented fixture runs; never read real results.

    All outputs live in a temporary directory. The unchanged scorer and local
    arithmetic controller create fixture assessments; no model is loaded/called.
    """
    from copy import deepcopy
    import shutil
    import tempfile
    from prepare_review import prepare, frozen_assessor
    scorer = frozen_assessor()
    from protocol import canonical_failure, parse_proposal
    from tool_control import ToolController
    checks = []

    def check(condition, name):
        require(condition, f'Self-test failed: {name}')
        checks.append(name)

    def rejects(fn, name):
        try:
            fn()
        except (ValueError, FileExistsError):
            checks.append(name)
        else:
            raise ValueError(f'Self-test accepted invalid fixture: {name}')

    question = '请核实本次计算的实际起止日期，含年份。\n原文须保留。'
    for raw in ('{"action":"call_tool","arguments":{"due":NaN}}',
                '{"action":"call_tool","arguments":{"due":1e9999}}',
                '{"action":"ask_user","questions":[],"questions":[1]}',
                '{"action":"ask_user","next_action":{"type":"call_tool"}}'):
        check(normalized_output({'raw_output': raw}) == (None, raw), 'ambiguous/nonfinite raw retained')
    normal = json.dumps({'action':'ask_user', 'questions':[{'field':'period','reason':'missing','text':question}]}, ensure_ascii=False)
    for raw in (normal, '```json\n'+normal+'\n```'):
        check(normalized_output({'raw_output':raw})[0]['next_action']['questions'][0]['text'] == question,
              'question text byte-for-byte preserved')

    with tempfile.TemporaryDirectory(prefix='anxin-reporting-offline-') as temp:
        outer = Path(temp)
        root = outer/'original'/'decision-baseline-v2'
        root.mkdir(parents=True)
        # Small sealed source markers make a self-contained reporting fixture.
        # Runtime scoring still imports the unchanged real frozen assessor.
        source_hashes = {}
        for rel in ('decision-baseline-v1/fixture.py','decision-baseline-v1/prompt.txt',
                    'decision-baseline-v2/fixture.py','decision-baseline-v2/prompt.txt'):
            path = root.parent/rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('offline reporting fixture: '+rel+'\n', encoding='utf-8')
            source_hashes[rel] = sha(path)
        records, labels = [], []
        for index in range(72):
            terminal = index < 16 and index % 2 == 0
            state = {'status':'TIMEOUT','attempts':2 if terminal else 1,'max_attempts':2} if index < 16 else None
            kind = 'report_tool_failure' if terminal else 'ask_user' if index % 2 else 'call_tool'
            expected = canonical_failure()
            if kind == 'ask_user':
                expected = {'missing':['period'],'conflicts':[], 'next_action':{
                    'type':kind,'questions':[{'field':'period','text':question}], 'tool':None,'arguments':None}}
            elif kind == 'call_tool':
                expected = {'missing':[],'conflicts':[], 'next_action':{'type':kind,'questions':[],
                    'tool':'calculate_wage_gap','arguments':{'period_start':'2026-01-01','period_end':'2026-01-31','due':1000,'paid':300}}}
            ident = f'fixture-{index:03d}'
            records.append({'id':ident,'messages':[{'role':'user','content':'仅供离线脚本自检的虚构输入。'}], 'tool_state':state})
            labels.append({'id':ident,'split':'test','group_id':f'fixture-group-{index//2:02d}',
                'category':'tool_failure' if terminal else 'missing_period' if kind == 'ask_user' else 'complete',
                'synthetic':True,'provenance':'agent_authored_synthetic','expected':expected,'rationale':'Reporting fixture only.'})
        data = root/'data'
        data.mkdir()
        for filename, values in (('test.inputs.jsonl',records),('test.labels.jsonl',labels)):
            (data/filename).write_bytes(b''.join(json_bytes(value) for value in values))
        frozen = {'source_sha256':source_hashes,'data_sha256':{p.name:sha(p) for p in data.iterdir()}}
        (root/'freeze.json').write_bytes(json_bytes(frozen))
        (root/'verification').mkdir()
        shutil.copyfile(ROOT/'verification/pricing.json', root/'verification/pricing.json')
        run_paths = []
        for backend in BACKENDS:
            for variant in VARIANTS:
                path = root/'results'/f'test-{backend}-{variant}'
                path.mkdir(parents=True)
                run_paths.append(path)
                rows = []
                for record, label in zip(records,labels):
                    ident = record['id']
                    if backend == 'qwen' and variant == 'v1' and ident == 'fixture-018':
                        continue  # Deliberately missing nonterminal result.
                    expected = deepcopy(label['expected'])
                    action = expected['next_action']
                    bypass = variant == 'v2' and action['type'] == 'report_tool_failure'
                    row = {'id':ident,'backend':backend,'variant':variant,'model_invoked':not bypass,
                           'finish_reason':'program_terminal' if bypass else 'stop',
                           'latency_seconds':0 if bypass else 0.25}
                    if variant == 'v1':
                        if backend == 'deepseek' and ident == 'fixture-001':
                            expected['missing'] = []  # Correct business action, invalid metadata.
                        row['raw_output'] = json.dumps(expected, ensure_ascii=False)
                        if backend == 'qwen' and ident == 'fixture-001':
                            row['raw_output'] = '我需要先核实实际的完整起止日期。'
                    elif bypass:
                        row.update(raw_output='', canonical_output=expected)
                    else:
                        if action['type'] == 'ask_user':
                            text = '请选择你喜欢的日期。' if backend == 'deepseek' and ident == 'fixture-001' else question
                            proposal = {'action':'ask_user','questions':[{'field':'period','reason':'missing','text':text}]}
                        else:
                            proposal = {'action':'call_tool','tool':action['tool'],'arguments':action['arguments']}
                        row['raw_output'] = json.dumps(proposal, ensure_ascii=False)
                        if backend == 'qwen' and ident == 'fixture-003':
                            row.update(raw_output='',finish_reason='request_error')
                        parsed = parse_proposal(row['raw_output'])
                        row['dispatch'] = ToolController(record['tool_state']).dispatch(parsed)
                    if not bypass:
                        if backend == 'qwen':
                            row.update(input_tokens=20,output_tokens=10,mlx_peak_bytes=1024**3)
                        elif row['finish_reason'] != 'request_error':
                            row.update(usage={'prompt_tokens':20,'completion_tokens':10,'prompt_cache_hit_tokens':5,
                                'prompt_cache_miss_tokens':15,'total_tokens':30},response_model='fixture-model',system_fingerprint='fixture-fingerprint')
                    rows.append(row)
                (path/'results.jsonl').write_bytes(b''.join(json_bytes(r) for r in rows))
                protocol = {'backend':backend,'variant':variant,'case_ids':[r['id'] for r in records],
                    'inputs_sha256':sha(data/'test.inputs.jsonl'),
                    'source_sha256':{'fixture.py':source_hashes['decision-baseline-v2/fixture.py']},
                    'v1_dependency_sha256':{'fixture.py':source_hashes['decision-baseline-v1/fixture.py']},
                    'prompt_sha256':source_hashes[f'decision-baseline-{variant}/prompt.txt'],
                    'model':'fixture-model','guard':{'fixture':True}}
                (path/'protocol.json').write_bytes(json_bytes(protocol))
                rows_by_id = by_id(rows)
                cases = [scorer.score_case(label,rows_by_id.get(label['id'],{}),record,variant) for record,label in zip(records,labels)]
                assessment = {'backend':backend,'variant':variant,'inputs_sha256':sha(data/'test.inputs.jsonl'),
                    'labels_sha256':sha(data/'test.labels.jsonl'),'results_sha256':sha(path/'results.jsonl'),'cases':cases}
                for cohort in ('all','nonterminal','terminal'):
                    selected = [c for c in cases if cohort == 'all' or c['terminal_case'] == (cohort == 'terminal')]
                    assessment[cohort] = scorer.aggregate(selected,rows)
                (path/'assessment.json').write_bytes(json_bytes(assessment))
                (path/'outcome.json').write_bytes(json_bytes({'completed':True,'fixture':True}))
                (path/'load.json').write_bytes(json_bytes({'seconds':9,'fixture':True}))
                (path/'memory-before.json').write_bytes(json_bytes({'pressure_level':1,'swap_used_bytes':0}))
                (path/'memory-after.json').write_bytes(json_bytes({'pressure_level':1,'swap_used_bytes':100}))
        review_dir = root/'review'
        # Two batches exercise the supported 3+1 protocol without using real runs.
        for batch, selected in (('batch1',run_paths[:3]),('batch2',run_paths[3:])):
            prepare(selected,batch,review_dir,root=root,seed='offline-fixture-seed')
            packet_path = review_dir/f'blind-{batch}.jsonl'
            decisions = []
            for packet in read_jsonl(packet_path):
                action = packet['output']['next_action'] if packet['output'] else None
                gold = packet['expected']['next_action']
                business = bool(action and action['type'] == gold['type'] and action['tool'] == gold['tool']
                                and action['arguments'] == gold['arguments']
                                and {q['field'] for q in action['questions']} == {q['field'] for q in gold['questions']})
                quality = None
                if not packet['transport_error'] and (gold['type'] == 'ask_user' or action and action['questions']):
                    quality = bool(action and action['questions'] and all(q['text'] == question for q in action['questions']))
                decisions.append({'review_id':packet['review_id'],'business_action_correct':False if packet['transport_error'] else business,
                    'question_text_adequate':quality,'rationale':'Synthetic deterministic fixture judgment; not an actual review.'})
            document = {'schema_version':SCHEMA,'batch':batch,'packet_sha256':sha(packet_path),
                'reviewer':{'kind':'independent_agent','human_expert':False,'model_requested':'gpt-6.1-sol','reasoning_effort_requested':'ultra'},'cases':decisions}
            (review_dir/f'semantic-{batch}.json').write_bytes(json_bytes(document))
        report = summarize(root=root)
        metrics = report['arms']['qwen/v2']['cohorts']['all']
        check(metrics['model_invoked'] == 64 and metrics['program_bypass'] == 8 and metrics['request_errors'] == 1,
              '64 actual calls plus 8 bypass and request error retained')
        check(metrics['metrics']['model_raw_semantic']['not_applicable'] == 8,
              'program bypass never credited as model success')
        missing = by_id(report['arms']['qwen/v1']['cases'])['fixture-018']
        check(missing['missing_result'] and missing['model_raw_semantic'] is False,
              'missing result false in planned and paired raw semantic')
        check(report['paired']['qwen']['nonterminal']['metrics']['model_raw_semantic']['case']['incomparable'] == 0,
              'nonterminal missing not excluded from paired raw comparison')
        deep_old = by_id(report['arms']['deepseek/v1']['cases'])['fixture-001']
        check(not deep_old['canonical'] and deep_old['model_raw_semantic'], 'metadata error separate from business semantics')
        deep_new = by_id(report['arms']['deepseek/v2']['cases'])['fixture-001']
        check(deep_new['canonical'] and not deep_new['executable_canonical_question_semantic'], 'bad question fails usable score')
        check(report['arms']['deepseek/v1']['cohorts']['all']['resources']['usage']['cost_estimate']['peak_estimate'] > 0,
              'verified usage and peak/offpeak cost calculation')
        check(len(report['review_batches']) == 2,'complete multibatch join')
        reproducible_dir = root/'reproduced-review'
        prepare(run_paths[:3],'batch1',reproducible_dir,root=root,seed='offline-fixture-seed')
        check((review_dir/'blind-batch1.jsonl').read_bytes() == (reproducible_dir/'blind-batch1.jsonl').read_bytes(),
              'private seed reproduces exact packet bytes')
        rejects(lambda:prepare(run_paths[:3],'batch1',review_dir,root=root), 'batch overwrite refused')
        rejects(lambda:prepare(run_paths[:1],'batch3',review_dir,root=root), 'crossbatch arm-case duplication refused')
        semantic_path = review_dir/'semantic-batch1.json'
        original = semantic_path.read_bytes()
        doc = read_json(semantic_path)
        doc['cases'].pop()
        semantic_path.write_bytes(json_bytes(doc))
        rejects(lambda:summarize(root=root), 'incomplete review refused')
        semantic_path.write_bytes(original)
        doc = read_json(semantic_path)
        doc['cases'].append(doc['cases'][0])
        semantic_path.write_bytes(json_bytes(doc))
        rejects(lambda:summarize(root=root), 'duplicate review refused')
        semantic_path.write_bytes(original)
        for filename, mutate, name in (
            ('protocol.json',lambda d:d['source_sha256'].update({'fixture.py':'0'*64}),'protocol source drift refused'),
            ('protocol.json',lambda d:d.update(prompt_sha256='0'*64),'prompt drift refused'),
            ('assessment.json',lambda d:d['cases'][0].update(canonical_correct=False),'edited frozen scores refused')):
            path = run_paths[0]/filename
            old = path.read_bytes()
            doc = read_json(path)
            mutate(doc)
            path.write_bytes(json_bytes(doc))
            rejects(lambda:summarize(root=root),name)
            path.write_bytes(old)
        copied_input = root/'different-input.jsonl'
        copied_input.write_bytes((data/'test.inputs.jsonl').read_bytes()+b'\n')
        rejects(lambda:load_context(root,copied_input), 'custom inputs must match freeze bytes')
        packet_path = review_dir/'blind-batch1.jsonl'
        old = packet_path.read_bytes()
        packet_path.write_bytes(old+b'\n')
        rejects(lambda:summarize(root=root),'packet hash tampering refused')
        packet_path.write_bytes(old)
        relocated = outer/'relocated'
        shutil.copytree(root.parent,relocated)
        moved_report = summarize(root=relocated/root.name)
        check(json_bytes(report,pretty=True) == json_bytes(moved_report,pretty=True),
              'relocated checkout reproduces byte-identical report despite absolute mapping paths')
        check(str(outer) not in json_bytes(report).decode(), 'report has no current machine paths')
        destination = root/'comparison.json'
        summarize(root=root,output=destination)
        check(destination.read_bytes() == json_bytes(report,pretty=True),'exclusive report bytes match in-memory reproduction')
        rejects(lambda:summarize(root=root,output=destination),'report overwrite refused')
    return {'self_test':'passed','checks':len(checks),'checks_passed':checks,
            'real_model_results_read':False,'network_or_model_calls':0,'temporary_fixtures_cleaned':True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--review-dir', type=Path)
    parser.add_argument('--run-dir', type=Path, action='append')
    parser.add_argument('--self-test', action='store_true', help='Temporary synthetic fixtures only; no real outputs or model calls')
    target = parser.add_mutually_exclusive_group()
    target.add_argument('--output', type=Path, help='New file; never overwrite prior report')
    target.add_argument('--check', type=Path, nargs='?', const=Path('comparison.json'),
                        help='Reproduce in memory and require byte-identical report; default: ROOT/comparison.json')
    args = parser.parse_args()
    if args.self_test:
        require(args.output is None and args.check is None, '--self-test cannot write or check a real comparison')
        print(json.dumps(self_test(),ensure_ascii=False,indent=2))
        return
    parser.error('Specify --output or --check') if args.output is None and args.check is None else None
    report = summarize(root=args.root, review_dir=args.review_dir, output=args.output, run_dirs=args.run_dir)
    if args.check is not None:
        check_path = args.check if args.check.is_absolute() else args.root/args.check
        require(check_path.read_bytes() == json_bytes(report, pretty=True), 'Stored comparison differs from offline reproduction')
        print(json.dumps({'check': 'passed', 'sha256': sha(check_path)}, ensure_ascii=False, indent=2))
        return
    counts = {key: {cohort: {name: value['correct'] for name, value in data['metrics'].items()}
                    for cohort, data in arm['cohorts'].items()} for key, arm in report['arms'].items()}
    print(json.dumps({'output': str(args.output.resolve()), 'sha256': sha(args.output),
                      'counts': counts}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
