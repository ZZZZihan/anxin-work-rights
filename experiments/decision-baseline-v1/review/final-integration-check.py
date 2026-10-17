"""Read-only independent verification; all output is confined to this review directory."""
from collections import Counter
from contextlib import redirect_stdout
from decimal import Decimal
import hashlib
import importlib
import io
import json
from pathlib import Path
import statistics
import sys

ROOT = Path('/Users/xuzihan/Documents/Projects/国创/anxin-decision-baselines/experiments/decision-baseline-v1')
DEST = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import common
import evaluate
import diagnostics
import summarize

def read(p):
    return json.loads(Path(p).read_text())

def snapshot():
    return {str(p.relative_to(ROOT)): common.sha(p) for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts}

before = snapshot()
freeze = read(ROOT / 'freeze.json')
assert all(common.sha(ROOT / p) == digest for p, digest in freeze['sha256'].items())
labels = common.read_jsonl(ROOT / 'data/test.labels.jsonl')
inputs = common.read_jsonl(ROOT / 'data/test.inputs.jsonl')
label_by_id = {x['id']: x for x in labels}
input_by_id = {x['id']: x for x in inputs}
assert len(labels) == len(label_by_id) == len(inputs) == len(input_by_id) == 72
expected_actions = Counter(x['expected']['next_action']['type'] for x in labels)
assert expected_actions == {'call_tool': 32, 'ask_user': 36, 'report_tool_failure': 4}

run_rows = {}
assessments = {}
diag_rows = {}
for backend in ('rules', 'qwen', 'deepseek'):
    p = ROOT / 'results' / (backend + '-test')
    rows = common.read_jsonl(p / 'results.jsonl')
    by_id = {x['id']: x for x in rows}
    assert len(rows) == len(by_id) == 72 and set(by_id) == set(label_by_id)
    assessment = read(p / 'assessment.json')
    scored = [evaluate.score(x, by_id[x['id']], input_by_id[x['id']]) for x in labels]
    assert scored == assessment['cases']
    assert evaluate.summarize(scored, rows) == assessment['summary']
    assert assessment['labels_sha256'] == common.sha(ROOT / 'data/test.labels.jsonl')
    diagnostic = read(p / 'diagnostic.json')
    recomputed_diagnostic = [diagnostics.diagnose(x, by_id[x['id']]) for x in labels]
    assert recomputed_diagnostic == diagnostic['cases']
    assert diagnostic['summary']['total'] == 72
    assert sum(x['next_action_diagnostic_correct'] for x in recomputed_diagnostic) == diagnostic['summary']['correct_action_and_declared_question_fields']
    assert diagnostic['labels_sha256'] == common.sha(ROOT / 'data/test.labels.jsonl')
    run_rows[backend] = by_id
    assessments[backend] = assessment
    diag_rows[backend] = {x['id']: x for x in recomputed_diagnostic}
recovery = common.read_jsonl(ROOT / 'results/deepseek-recovery/results.jsonl')
assert len(recovery) == 1
run_rows['deepseek-recovery'] = {x['id']: x for x in recovery}

reviews = {}
packet_counts = []
mapping_counts = Counter()
for batch in (1, 2):
    folder = ROOT / 'review'
    packets = common.read_jsonl(folder / f'blind-batch{batch}.jsonl')
    mapping = read(folder / f'blind-batch{batch}-mapping.json')
    semantic = read(folder / f'semantic-batch{batch}.json')['cases']
    p_by_id = {x['review_id']: x for x in packets}
    s_by_id = {x['review_id']: x for x in semantic}
    assert len(packets) == len(p_by_id) == len(mapping) == len(semantic) == len(s_by_id)
    assert set(p_by_id) == set(mapping) == set(s_by_id)
    packet_counts.append(len(packets))
    for filename in (f'blind-batch{batch}.jsonl', f'semantic-batch{batch}.json'):
        assert common.sha(folder / filename) == common.sha(DEST / filename)
    for review_id, target in mapping.items():
        backend, case_id = target['backend'], target['id']
        packet = p_by_id[review_id]
        original = run_rows[backend][case_id]
        assert packet['input'] == input_by_id[case_id]
        assert packet['expected'] == label_by_id[case_id]['expected']
        assert packet['raw_output'] == original['raw_output']
        assert packet['output'] == common.parse_output(original['raw_output'])[0]
        assert packet['transport_error'] == bool(original.get('error_type'))
        key = (backend, case_id)
        assert key not in reviews
        reviews[key] = s_by_id[review_id]
        mapping_counts[backend] += 1
assert packet_counts == [105, 40]
assert mapping_counts == {'rules': 44, 'qwen': 39, 'deepseek': 61, 'deepseek-recovery': 1}

backend_checks = {}
for backend in ('rules', 'qwen', 'deepseek'):
    cases = assessments[backend]['cases']
    selected = {(backend, x['id']) for x in cases if not x['decision_contract_correct'] or bool((x['parsed_output'] or {}).get('next_action', {}).get('questions', []))}
    actual = {key for key in reviews if key[0] == backend}
    assert selected == actual
    semantic = {}
    for x in cases:
        reviewed = reviews.get((backend, x['id']))
        if reviewed:
            value = reviewed['business_action_correct'] and reviewed['question_text_adequate'] is not False
            if x['expected']['next_action']['type'] == 'ask_user' and not run_rows[backend][x['id']].get('error_type'):
                assert type(reviewed['question_text_adequate']) is bool
        else:
            assert x['decision_contract_correct']
            assert not x['parsed_output']['next_action']['questions']
            assert x['expected']['next_action']['type'] != 'ask_user'
            value = True
        semantic[x['id']] = value
    groups = {}
    for x in labels:
        groups.setdefault(x['group_id'], []).append(semantic[x['id']])
    assert len(groups) == 36 and all(len(x) == 2 for x in groups.values())
    calls = Counter()
    for label in labels:
        if label['expected']['next_action']['type'] != 'call_tool':
            continue
        obj = common.parse_output(run_rows[backend][label['id']]['raw_output'])[0]
        action = obj.get('next_action', {}) if isinstance(obj, dict) else {}
        if action.get('type') != 'call_tool':
            calls['not_called'] += 1
        elif action.get('tool') == label['expected']['next_action']['tool'] and action.get('arguments') == label['expected']['next_action']['arguments']:
            calls['correct_actual_call_and_arguments'] += 1
        else:
            calls['wrong_actual_tool_or_arguments'] += 1
    summary = assessments[backend]['summary']
    backend_checks[backend] = {
        'primary_correct': summary['counts']['decision_contract_correct'],
        'business_semantic_correct': sum(semantic.values()),
        'strict_json': summary['counts']['strict_json'],
        'contract_valid': summary['counts']['contract_valid'],
        'strict_json_and_primary': sum(x['strict_json'] and x['decision_contract_correct'] for x in cases),
        'diagnostic_correct': sum(x['next_action_diagnostic_correct'] for x in diag_rows[backend].values()),
        'semantic_only_pass_ids': [i for i in semantic if semantic[i] and not diag_rows[backend][i]['next_action_diagnostic_correct']],
        'diagnostic_only_pass_ids': [i for i in semantic if not semantic[i] and diag_rows[backend][i]['next_action_diagnostic_correct']],
        'both_in_group_semantically_correct': sum(all(x) for x in groups.values()),
        'reviewed': mapping_counts[backend],
        'deterministic_non_question': 72 - mapping_counts[backend],
        'expected_call_breakdown': dict(calls),
        'premature': summary['counts']['premature_tool_call'],
        'premature_denominator': summary['premature_tool_call_denominator'],
        'latency_seconds': summary['latency_seconds'],
    }
assert [backend_checks[x]['business_semantic_correct'] for x in ('rules', 'qwen', 'deepseek')] == [55, 62, 71]
assert backend_checks['qwen']['semantic_only_pass_ids'] == ['c_3b94df86700a']
assert set(backend_checks['qwen']['diagnostic_only_pass_ids']) == {'c_b5b313d396dc', 'c_ceab75515e1f'}

usage = Counter()
attempts = Counter()
successes = Counter()
for name in ('deepseek-dev-preflight', 'deepseek-dev', 'deepseek-test', 'deepseek-recovery'):
    for row in common.read_jsonl(ROOT / 'results' / name / 'results.jsonl'):
        attempts[name] += 1
        if row.get('usage'):
            assert not row.get('error_type') and row['finish_reason'] == 'stop'
            successes[name] += 1
            u = row['usage']
            assert u['prompt_cache_hit_tokens'] + u['prompt_cache_miss_tokens'] == u['prompt_tokens']
            assert u['prompt_tokens'] + u['completion_tokens'] == u['total_tokens']
            usage.update({k: v for k, v in u.items() if isinstance(v, int)})
assert sum(attempts.values()) == 86 and sum(successes.values()) == 85
assert usage['total_tokens'] == 55464
peak = (Decimal(usage['prompt_cache_miss_tokens']) * Decimal('1.32') + Decimal(usage['prompt_cache_hit_tokens']) * Decimal('.044') + Decimal(usage['completion_tokens']) * Decimal('3.96')) / Decimal(1000000)
api_checks = {'attempts_by_run': dict(attempts), 'successes_by_run': dict(successes), 'attempts_total': sum(attempts.values()), 'successes_total': sum(successes.values()), 'usage': dict(usage), 'peak_usd_decimal': str(peak), 'off_peak_usd_decimal': str(peak / 2), 'billing_verified': False, 'timeout_billing_unknown': True}

generated = DEST / 'regenerated-comparison.json'
summarize.save = lambda path, obj: common.save(generated, obj)
stdout = io.StringIO()
with redirect_stdout(stdout):
    summarize.summarize(ROOT)
assert generated.read_bytes() == (ROOT / 'comparison.json').read_bytes()

# Remove rows from all review artifacts to reach the missing-review fallback,
# rather than merely testing the earlier ID mismatch assertion.
original_read, original_read_jsonl = summarize.read, summarize.read_jsonl
def run_probe(label, removed_review=None, truncated_run=None, semantic_only=False, null_review=None):
    def altered_read(path):
        value = original_read(path)
        if removed_review and Path(path).name.startswith('semantic-batch'):
            value['cases'] = [x for x in value['cases'] if x['review_id'] != removed_review]
        if null_review and Path(path).name.startswith('semantic-batch'):
            for row in value['cases']:
                if row['review_id'] == null_review:
                    row['question_text_adequate'] = None
        if removed_review and not semantic_only and Path(path).name.endswith('-mapping.json'):
            value.pop(removed_review, None)
        return value
    def altered_jsonl(path):
        rows = original_read_jsonl(path)
        if removed_review and not semantic_only and Path(path).name.startswith('blind-batch'):
            rows = [x for x in rows if x['review_id'] != removed_review]
        if truncated_run and Path(path) == ROOT / 'results' / truncated_run / 'results.jsonl':
            rows = rows[:-1]
        return rows
    summarize.read, summarize.read_jsonl = altered_read, altered_jsonl
    try:
        with redirect_stdout(io.StringIO()):
            summarize.summarize(ROOT)
    except AssertionError:
        return {'probe': label, 'rejected': True}
    finally:
        summarize.read, summarize.read_jsonl = original_read, original_read_jsonl
    raise AssertionError('Corrupt-input probe was accepted: ' + label)
probes = [run_probe('semantic row absent but mapping retained', 'review_214', semantic_only=True),
          run_probe('all traces of a primary-failure review removed', 'review_207'),
          run_probe('all traces of a correct ask review removed', 'review_202'),
          run_probe('first-attempt test rows truncated to 71', truncated_run='deepseek-test'),
          run_probe('retained real ask review has null question-text judgment', null_review='review_202')]

outcome = read(ROOT / 'results/qwen-test/outcome.json')
telemetry = common.read_jsonl(ROOT / 'results/qwen-test/telemetry.jsonl')
before_memory = read(ROOT / 'results/qwen-test/memory-before.json')
after_memory = read(ROOT / 'results/qwen-test/memory-after.json')
resource_checks = {
    'qwen_test_seconds': outcome['seconds'],
    'qwen_peak_mlx_gib': max(x['mlx_peak_bytes'] for x in run_rows['qwen'].values()) / 1024**3,
    'pressure_levels': sorted({x['pressure_level'] for x in telemetry}),
    'swap_start_gib': before_memory['swap_used_bytes'] / 1024**3,
    'swap_peak_gib': max(x['swap_used_bytes'] for x in telemetry) / 1024**3,
    'swap_end_gib': after_memory['swap_used_bytes'] / 1024**3,
    'timeout_seconds': run_rows['deepseek']['c_3b94df86700a']['latency_seconds'],
    'recovery_seconds': recovery[0]['latency_seconds'],
}
assert resource_checks['pressure_levels'] == [1]
assert resource_checks['swap_peak_gib'] <= resource_checks['swap_start_gib']
assert outcome['completed'] is True and outcome['stop_reason'] is None
assert snapshot() == before
checks = {'status': 'passed', 'python': sys.version, 'frozen_hashes_verified': len(freeze['sha256']), 'source_snapshot_files_unchanged': len(before), 'expected_actions': dict(expected_actions), 'blind_packet_counts': packet_counts, 'mapping_counts': dict(mapping_counts), 'mapping_packets_match_all_raw_results': True, 'primary_and_diagnostics_recomputed_cases': 216, 'backend_checks': backend_checks, 'api_checks': api_checks, 'resource_checks': resource_checks, 'regenerated_comparison_sha256': common.sha(generated), 'regenerated_comparison_byte_identical': True, 'missing_review_and_denominator_probes': probes, 'summarize_stdout': stdout.getvalue(), 'models_loaded': False, 'api_called': False}
common.save(DEST / 'final-integration-checks.json', checks)
print(json.dumps({k: v for k, v in checks.items() if k not in ('summarize_stdout', 'backend_checks')}, ensure_ascii=False, indent=2))
