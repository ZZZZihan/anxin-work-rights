#!/usr/bin/env python3
"""Build an offline, arm-blinded review packet from sealed complete runs.

Never invokes a model, changes frozen files, repairs outputs, or changes scores.
Only the private mapping contains arm identities. Question text is copied exactly.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import random
import re
import secrets
import sys
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'anxin-semantic-review-v1'
MAPPING_SCHEMA = 'anxin-semantic-review-mapping-v1'
BACKENDS = ('qwen', 'deepseek')
VARIANTS = ('v1', 'v2')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def json_bytes(value, *, pretty=False):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       indent=2 if pretty else None, separators=None if pretty else (',', ':')) + '\n').encode('utf-8')


def object_pairs(items):
    obj = {}
    for key, value in items:
        require(key not in obj, f'Duplicate JSON key: {key}')
        obj[key] = value
    return obj


def loads(text):
    def constant(token):
        raise ValueError(f'Nonfinite JSON number: {token}')
    return json.loads(text, object_pairs_hook=object_pairs, parse_constant=constant)


def read_json(path):
    return loads(Path(path).read_text(encoding='utf-8'))


def read_jsonl(path):
    records = []
    for i, line in enumerate(Path(path).read_text(encoding='utf-8').splitlines(), 1):
        require(bool(line.strip()), f'{path}:{i}: blank JSONL row')
        obj = loads(line)
        require(isinstance(obj, dict), f'{path}:{i}: row must be object')
        records.append(obj)
    return records


def by_id(records, *, field='id', source='records'):
    ids = [r.get(field) for r in records]
    require(all(isinstance(i, str) and i for i in ids), f'{source}: invalid {field}')
    require(len(set(ids)) == len(ids), f'{source}: duplicate {field}')
    return dict(zip(ids, records))


def write_exclusive(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(content)


def verify_freeze(root):
    freeze_path = root / 'freeze.json'
    frozen = read_json(freeze_path)
    for rel, expected in frozen['source_sha256'].items():
        require(sha(root.parent / rel) == expected, f'Frozen source changed: {rel}')
    for name, expected in frozen['data_sha256'].items():
        require(sha(root / 'data' / name) == expected, f'Frozen data changed: {name}')
    return frozen, sha(freeze_path)


def load_context(root=ROOT, inputs_path=None, labels_path=None):
    root = Path(root).resolve()
    inputs_path = Path(inputs_path or root / 'data/test.inputs.jsonl').resolve()
    labels_path = Path(labels_path or root / 'data/test.labels.jsonl').resolve()
    frozen, freeze_sha = verify_freeze(root)
    require(sha(inputs_path) == frozen['data_sha256']['test.inputs.jsonl'], 'Inputs do not match sealed test.inputs.jsonl')
    require(sha(labels_path) == frozen['data_sha256']['test.labels.jsonl'], 'Labels do not match sealed test.labels.jsonl')
    inputs, labels = read_jsonl(inputs_path), read_jsonl(labels_path)
    records, gold = by_id(inputs, source='inputs'), by_id(labels, source='labels')
    require(set(records) == set(gold) and len(records) == 72, 'Expected the same 72 input/label IDs')
    groups = {}
    terminal = set()
    for ident, record in records.items():
        require(set(record) == {'id', 'messages', 'tool_state'}, f'{ident}: unexpected input keys')
        group = gold[ident]['group_id']
        groups.setdefault(group, []).append(ident)
        state = record['tool_state']
        if state and state.get('status') == 'TIMEOUT' and state['attempts'] >= state['max_attempts']:
            terminal.add(ident)
    require(len(groups) == 36 and all(len(v) == 2 for v in groups.values()), 'Expected 36 two-record groups')
    require(len(terminal) == 8, 'Expected eight terminal and 64 nonterminal cases')
    return {'root': root, 'inputs_path': inputs_path, 'labels_path': labels_path,
            'inputs_sha256': sha(inputs_path), 'labels_sha256': sha(labels_path),
            'freeze_sha256': freeze_sha, 'freeze': frozen, 'inputs': inputs, 'labels': labels,
            'records': records, 'gold': gold, 'groups': groups, 'terminal_ids': terminal}


def frozen_assessor():
    # Imports only unchanged scoring/control code. Model runtime imports are lazy.
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    return importlib.import_module('assess')


def load_run(run_dir, context):
    run_dir = Path(run_dir).resolve()
    protocol_path, assessment_path = run_dir / 'protocol.json', run_dir / 'assessment.json'
    results_path = run_dir / 'results.jsonl'
    protocol, assessment = read_json(protocol_path), read_json(assessment_path)
    backend, variant = protocol['backend'], protocol['variant']
    require(backend in BACKENDS and variant in VARIANTS, 'Unknown backend/variant')
    frozen_sources = context['freeze']['source_sha256']
    expected_source = {Path(rel).name: digest for rel, digest in frozen_sources.items()
                       if Path(rel).parent == Path(context['root'].name) and rel.endswith('.py')}
    expected_v1 = {Path(rel).name: digest for rel, digest in frozen_sources.items()
                   if Path(rel).parent == Path('decision-baseline-v1') and rel.endswith('.py')}
    prompt_key = str(Path('decision-baseline-v1' if variant == 'v1' else context['root'].name) / 'prompt.txt')
    require(protocol.get('source_sha256') == expected_source, f'{run_dir}: protocol sources differ from freeze')
    require(protocol.get('v1_dependency_sha256') == expected_v1, f'{run_dir}: protocol v1 dependencies differ from freeze')
    require(protocol.get('prompt_sha256') == frozen_sources[prompt_key], f'{run_dir}: protocol prompt differs from freeze')
    require(protocol['case_ids'] == [r['id'] for r in context['inputs']], f'{run_dir}: planned ID order mismatch')
    require(protocol['inputs_sha256'] == context['inputs_sha256'], f'{run_dir}: protocol input hash mismatch')
    require(assessment['backend'] == backend and assessment['variant'] == variant, f'{run_dir}: arm metadata mismatch')
    require(assessment['inputs_sha256'] == context['inputs_sha256'] and assessment['labels_sha256'] == context['labels_sha256'], f'{run_dir}: assessment data hash mismatch')
    results = read_jsonl(results_path) if results_path.exists() else []
    results_by_id = by_id(results, source=str(results_path))
    require(set(results_by_id) <= set(context['records']), f'{run_dir}: unknown result ID')
    result_hash = sha(results_path) if results else None
    require(assessment['results_sha256'] == result_hash, f'{run_dir}: results changed since frozen assessment')
    cases = by_id(assessment['cases'], source=str(assessment_path))
    require(set(cases) == set(context['records']) and len(cases) == 72, f'{run_dir}: assessment must retain all 72 planned cases')
    scorer = frozen_assessor()
    for ident, case in cases.items():
        require(case == scorer.score_case(context['gold'][ident], results_by_id.get(ident, {}), context['records'][ident], variant),
                f'{run_dir}/{ident}: assessment differs from unchanged frozen scorer')
        require(case['terminal_case'] == (ident in context['terminal_ids']), f'{run_dir}/{ident}: terminal cohort mismatch')
        row = results_by_id.get(ident)
        if row:
            require(row.get('backend', backend) == backend and row.get('variant', variant) == variant, f'{run_dir}/{ident}: result arm mismatch')
    # Check aggregate fields too; never silently adopt manually edited summaries.
    for cohort, selected in (
        ('all', list(cases.values())),
        ('nonterminal', [c for c in cases.values() if not c['terminal_case']]),
        ('terminal', [c for c in cases.values() if c['terminal_case']]),
    ):
        require(assessment[cohort] == scorer.aggregate(selected, results), f'{run_dir}: frozen {cohort} aggregate mismatch')
    tracked = ['protocol.json', 'assessment.json', 'results.jsonl', 'outcome.json', 'load.json',
               'memory-before.json', 'memory-after.json', 'telemetry.jsonl']
    hashes = {name: sha(run_dir / name) for name in tracked if (run_dir / name).is_file()}
    return {'key': f'{backend}/{variant}', 'backend': backend, 'variant': variant,
            'run_dir': run_dir, 'protocol': protocol, 'assessment': assessment,
            'cases': cases, 'results': results, 'results_by_id': results_by_id,
            'artifact_sha256': hashes}


def normalized_output(row):
    """Copy actual proposals into one shell, without canonical repair or text edits.

    Shape normalization is deliberately arm-independent. This retains a meaningful
    proposal even if it used the other arm's schema; the frozen scorer still fails
    that protocol. Unknown extra metadata is not a semantic-review responsibility.
    """
    if not row:
        return None, None
    raw = row.get('raw_output', '')
    if row.get('model_invoked') is False:
        obj = row.get('canonical_output')
    else:
        source = raw.strip() if isinstance(raw, str) else ''
        if source.startswith('```json\n') and source.endswith('```'):
            source = source[8:-3]
        elif source.startswith('```\n') and source.endswith('```'):
            source = source[4:-3]
        try:
            obj = loads(source)
            json_bytes(obj)  # Includes exponent overflow/nonfinite values.
        except (ValueError, TypeError, RecursionError, OverflowError):
            return None, raw if isinstance(raw, str) and raw.strip() else None
    action = None
    if isinstance(obj, dict) and sum(k in obj for k in ('next_action', 'action', 'type')) > 1:
        return None, raw if isinstance(raw, str) and raw.strip() else None
    if isinstance(obj, dict):
        if isinstance(obj.get('next_action'), dict):
            action = obj['next_action']
        elif 'action' in obj:
            action = {'type': obj.get('action'), 'questions': obj.get('questions', []),
                      'tool': obj.get('tool'), 'arguments': obj.get('arguments')}
        elif 'type' in obj:
            action = obj
    if action is None:
        return None, raw if isinstance(raw, str) and raw.strip() else None
    qs = action.get('questions', [])
    if isinstance(qs, list):
        qs = [{'field': q.get('field'), 'text': q.get('text')} if isinstance(q, dict) else q for q in qs]
    output = {'next_action': {'type': action.get('type'), 'questions': qs,
                              'tool': action.get('tool'), 'arguments': action.get('arguments')}}
    try:
        json_bytes(output)
    except (ValueError, TypeError, RecursionError, OverflowError):
        return None, raw if isinstance(raw, str) and raw.strip() else None
    return output, None


def needs_review(label, case, output):
    action = output.get('next_action') if isinstance(output, dict) else None
    actual_questions = action.get('questions') if isinstance(action, dict) else None
    return label['expected']['next_action']['type'] == 'ask_user' or bool(actual_questions) or not case['canonical_correct']


def make_packet(ident, run, context, review_id):
    row = run['results_by_id'].get(ident, {})
    output, unparsed = normalized_output(row)
    return {'review_id': review_id,
            'input': {'messages': context['records'][ident]['messages'], 'tool_state': context['records'][ident]['tool_state']},
            'expected': context['gold'][ident]['expected'],
            'output': output, 'unparsed_output': unparsed,
            'transport_error': bool(not row or row.get('finish_reason') == 'request_error')}


def packet_digest(packet):
    return hashlib.sha256(json_bytes(packet)).hexdigest()


def validate_review(row, packet):
    require(set(row) == {'review_id', 'business_action_correct', 'question_text_adequate', 'rationale'}, 'Unexpected semantic-review row keys')
    require(type(row['business_action_correct']) is bool, 'business_action_correct must be boolean')
    quality = row['question_text_adequate']
    require(quality is None or type(quality) is bool, 'question_text_adequate must be boolean or null')
    require(isinstance(row['rationale'], str) and bool(row['rationale'].strip()), 'Semantic rationale must be nonempty')
    if packet['transport_error']:
        require(row['business_action_correct'] is False and quality is None, 'Transport failure must have action=false, question=null')
        return
    action = packet['output'].get('next_action') if isinstance(packet['output'], dict) else None
    actual_questions = action.get('questions') if isinstance(action, dict) else None
    if packet['expected']['next_action']['type'] == 'ask_user' or actual_questions:
        require(type(quality) is bool, 'Gold or actual questions require an explicit text judgment')


def verify_run_snapshot(run):
    for name, digest in run['artifact_sha256'].items():
        require(sha(run['run_dir'] / name) == digest, f'Run changed during reporting: {run["run_dir"]}/{name}')


def prepare(run_dirs, batch, output_dir, *, root=ROOT, inputs=None, labels=None, seed=None):
    require(re.fullmatch(r'batch[1-9][0-9]*', batch) is not None, 'Batch must be batch1, batch2, ...')
    output_dir = Path(output_dir).resolve()
    packet_path = output_dir / f'blind-{batch}.jsonl'
    mapping_path = output_dir / f'blind-{batch}-mapping.json'
    require(not packet_path.exists() and not mapping_path.exists(), 'Batch/output already exists; choose a unique batch instead of overwriting')
    context = load_context(root, inputs, labels)
    runs = [load_run(path, context) for path in run_dirs]
    require(bool(runs) and len({r['key'] for r in runs}) == len(runs), 'Run list is empty or duplicates an arm')
    existing = set()
    for path in sorted(output_dir.glob('blind-batch*-mapping.json')):
        old = read_json(path)
        require(old.get('schema_version') == MAPPING_SCHEMA, f'Unknown mapping schema: {path}')
        for target in old['cases'].values():
            key = (target['backend'], target['variant'], target['id'])
            require(key not in existing, 'Existing batches already contain duplicate case/arm mappings')
            existing.add(key)
    seed = seed or secrets.token_hex(32)
    require(isinstance(seed, str) and bool(seed), 'Seed must be a nonempty string')
    packets, mapping_cases, manifests = [], {}, {}
    for run in sorted(runs, key=lambda r: r['key']):
        selected = []
        for label in context['labels']:
            ident = label['id']
            output, _ = normalized_output(run['results_by_id'].get(ident, {}))
            if not needs_review(label, run['cases'][ident], output):
                continue
            key = (run['backend'], run['variant'], ident)
            require(key not in existing, f'{run["key"]}/{ident}: already in an earlier batch')
            token = hashlib.sha256((seed + '\0' + batch + '\0' + '\0'.join(key)).encode()).hexdigest()
            review_id = str(uuid.UUID(token[:32]))
            require(review_id not in mapping_cases, 'Review-ID collision')
            packet = make_packet(ident, run, context, review_id)
            packets.append(packet)
            mapping_cases[review_id] = {'backend': run['backend'], 'variant': run['variant'], 'id': ident,
                                        'packet_sha256': packet_digest(packet)}
            selected.append(ident)
        manifests[run['key']] = {'run_dir': str(run['run_dir']), 'backend': run['backend'], 'variant': run['variant'],
                                 'artifact_sha256': run['artifact_sha256'], 'selected_case_ids': selected}
    random.Random(seed + '\0' + batch).shuffle(packets)
    packet_bytes = b''.join(json_bytes(packet) for packet in packets)
    mapping = {'schema_version': MAPPING_SCHEMA, 'batch': batch,
               'blinded_file': packet_path.name, 'packet_sha256': hashlib.sha256(packet_bytes).hexdigest(),
               'inputs_sha256': context['inputs_sha256'], 'labels_sha256': context['labels_sha256'],
               'freeze_sha256': context['freeze_sha256'], 'private_seed': seed,
               'private_mapping_do_not_send_to_reviewer': True,
               'runs': manifests, 'cases': mapping_cases,
               'reporting_source_sha256': sha(Path(__file__))}
    for run in runs:
        verify_run_snapshot(run)
    write_exclusive(packet_path, packet_bytes)
    write_exclusive(mapping_path, json_bytes(mapping, pretty=True))
    return {'batch': batch, 'packet_path': str(packet_path), 'mapping_path_private': str(mapping_path),
            'review_schema': SCHEMA, 'packet_rows': len(packets), 'packet_sha256': mapping['packet_sha256'],
            'mapping_sha256': sha(mapping_path), 'selected_per_arm': {k: len(v['selected_case_ids']) for k, v in manifests.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--inputs', type=Path)
    parser.add_argument('--labels', type=Path)
    parser.add_argument('--run-dir', type=Path, action='append', required=True)
    parser.add_argument('--batch', required=True, help='batch1, batch2, ...; never reused')
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--seed', help='Optional private seed for byte-reproducible packet regeneration in another empty directory')
    args = parser.parse_args()
    print(json.dumps(prepare(args.run_dir, args.batch, args.output_dir, root=args.root,
                             inputs=args.inputs, labels=args.labels, seed=args.seed), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
