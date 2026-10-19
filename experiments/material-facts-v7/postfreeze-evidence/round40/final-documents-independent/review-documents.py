from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json

ROOT = Path('/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-guards')
OWN = Path('/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-review')
OUT = Path(__file__).resolve().parent
E = Path('experiments/material-facts-v7')
DOCS = ['README.md', 'ISSUE42_ACCEPTANCE.md', 'ERROR_REVIEW.md', 'POSTRUN_ROUND40_APPLICATION.md']
LAYERS = ['raw_basic', 'accepted_basic', 'raw_relational', 'accepted_relational', 'raw_strict', 'accepted_strict']

def sha(data):
    return hashlib.sha256(data).hexdigest()

def save(name, data):
    with (OUT / name).open('xb') as f:
        f.write(data)

def save_json(name, data):
    save(name, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode())

inputs = {}
def read(path, snapshot):
    data = path.read_bytes()
    inputs[str(path)] = {'sha256': sha(data), 'bytes': len(data), 'snapshot': snapshot}
    save(snapshot, data)
    return data

docs = {name: read(ROOT / E / name, name + '.snapshot').decode() for name in DOCS}
v30_manifest = json.loads(read(ROOT / E / 'corrections-v30/manifest.json', 'v30-manifest.json.snapshot'))
comparison = json.loads(read(ROOT / E / 'corrections-v30/comparison.json', 'v30-comparison.json.snapshot'))
v29_manifest = json.loads(read(ROOT / E / 'corrections-v29/manifest.json', 'v29-manifest.json.snapshot'))
models = {}
all_money = []
for model in ['rules', 'qwen', 'deepseek']:
    name = f'report-{model}.json'
    current = read(ROOT / E / 'corrections-v30' / name, f'v30-{name}.snapshot')
    previous = read(ROOT / E / 'corrections-v29' / name, f'v29-{name}.snapshot')
    report = json.loads(current)
    assert current == previous, model
    assert report['expected_facts'] == 43
    for case in report['cases']:
        all_money.extend(x for x in case['production_defense'] if x['kind'] == 'money')
    models[model] = {
        'report_byte_equal_v29': True,
        'cases': len(report['cases']),
        'raw': report['raw_candidates'], 'accepted': report['accepted_candidates'],
        'rejected': report['rejected_candidates'],
        'f1_percent_six_layers': {k: round(report['metrics'][k]['f1'] * 100, 2) for k in LAYERS},
    }

ci_path = OWN / 'postfreeze-evidence/round40/ci-6d081321-review/ci-6d081321-review.independent.json'
read(ci_path, 'application-ci-independent.receipt.json.snapshot')
status = dict(Counter(x['normalization'] for x in all_money))
assert len(all_money) == 46 and status == {'approximate': 25, 'exact': 19, 'unsupported': 2}
assert all('source_relation_unresolved' in x['issues'] for x in all_money)
assert not any(x['exact_money_without_review_issue'] for x in all_money)
assert all(x['calculation_authorized'] is False for x in all_money)
assert len(v30_manifest['code_sha256']) == 109 and len(v29_manifest['code_sha256']) == 106
assert sha((ROOT / E / 'corrections-v30/manifest.json').read_bytes()) == 'e1b8b03588dc4f8de70e8f85156c370f4776219e9d14268b5df259027d8b56ba'
assert comparison['inference'] is False and comparison['new_holdout_run'] is False
assert comparison['expected_facts'] == 43
assert sum(x['raw'] for x in models.values()) == 116
assert sum(x['accepted'] for x in models.values()) == 104
assert sum(x['rejected'] for x in models.values()) == 12

# This is direct reading/counting of existing report JSON, not execution of a scorer.
checks = {
    'same_metrics_and_denominators_across_four_documents': True,
    'application_ci_distinct_from_experimental_pr_ci': True,
    'synthetic_http_distinct_from_real_model_and_business_acceptance': True,
    'accepted_distinct_from_usable_confirmed_or_calculable': True,
    'calculation_authorized_explicitly_described_as_fixed_policy': True,
    'posthoc_reassessment_not_claimed_new_blind_experiment': True,
    'case_project_split_not_claimed_web_page_or_statistical_independence': True,
    'provisional_non_expert_labels_and_unfinished_business_acceptance_explicit': True,
    'invalid_fixture_failures_and_original_failed_runs_retained_in_description': True,
    'local_full_before_additional_19_tests_distinguished_from_final_exact_ci': True,
    'historical_v18_21_23_2_counts_labeled_historical_not_current': True,
}
findings = [{
    'severity': 'nonblocking_temporal_wording',
    'file': str(ROOT / E / 'POSTRUN_ROUND40_APPLICATION.md'),
    'line': 29,
    'quoted_text': 'v30将另存对同一冻结首次回答的后验复评',
    'description': 'The v30 artifact is already published. Future tense can be read as pending publication.',
    'suggestion': 'v30已另存对同一冻结首次回答的后验复评',
    'affects_metrics_or_acceptance_decision': False,
}]
after = {p: sha(Path(p).read_bytes()) for p in inputs}
assert all(after[p] == m['sha256'] for p, m in inputs.items())
receipt = {
    'schema': 'issue42-round40-final-documents-independent/1',
    'recorded_at_utc': datetime.now(timezone.utc).isoformat(),
    'status': 'PASS_NO_MATERIAL_DOCUMENT_BLOCKER',
    'scope': 'Read-only four-document consistency review with direct reads of existing v30/v29 JSON and prior exact application CI receipt.',
    'requested_model': 'gpt-6.1-sol', 'requested_reasoning_effort': 'ultra',
    'actual_backend_independently_verified': False,
    'inputs': inputs, 'inputs_unchanged_after_review': True,
    'read_only_report_facts': {
        'manifest_sha256': 'e1b8b03588dc4f8de70e8f85156c370f4776219e9d14268b5df259027d8b56ba',
        'current_code_bindings': 109, 'previous_code_bindings': 106,
        'reference_facts_per_backend': 43, 'models': models,
        'aggregate_raw_accepted_rejected': [116, 104, 12],
        'accepted_money': 46, 'money_normalization': status,
        'all_money_source_relation_warning': True, 'exact_money_without_review_issue': 0,
        'report_calculation_authorized_false': 46,
        'calculation_authorized_is_fixed_policy_not_ui_authorization_proof': True,
    },
    'document_checks': checks,
    'material_blockers': [], 'nonblocking_findings': findings,
    'execution_boundary': {
        'scorer_or_compute_executed': False, 'tests_rerun': False,
        'historical_cli_or_gate_executed': False, 'full_build_http_or_model_executed': False,
        'shared_files_modified': False, 'github_writes': False,
        'parent_v30_write': 'Parent-reported PASS 381.250s; no independent reexecution here.',
        'parent_v30_check_and_final_pr46_ci': 'Pending/in progress at task dispatch; this review does not certify their completion.',
        'human_business_acceptance': 'Not completed; not inferred from any technical result.',
    },
}
save_json('final-documents-review.independent.json', receipt)
md = '''# ROUND40 最终入口文档独立轻审

四份文档未见影响判断的实质矛盾。当前应用提交、精确应用 CI、合成隔离 HTTP、v30 后验复评、非实现者技术复核与尚未完成的人工业务验收，均作了区分。PR46 精确 CI 尚待核对的中间口径没有问题。

直接读取现有 v30/v29 JSON：109 当前代码、106 份 v29 代码；三路报告逐字节相同。六层 F1 与文档表一致，参考分母每路 43；116 raw、104 accepted、12 rejected。46 条 accepted 金额为 19 exact、25 approximate/null、2 unsupported/null，全部有 source_relation_unresolved，无无核对问题的精确金额。46 个 calculation_authorized:false 是报告固定政策字段，不能当作实际 UI 授权测试。

样本限制、7 网页/15 案件项目、3 开发/12 留出、2 网页跨开发/留出，以及 provisional_non_expert、原始失败和无效夹具保留、后验不称新盲测等表述一致。历史 v18 的 21/23/2 明确标历史，不与当前 19/25/2 混用。

仅一处非阻塞时态建议：POSTRUN_ROUND40_APPLICATION.md 第 29 行“v30将另存”可改为“v30已另存”，因为产物已发布。它不影响数字、评分或验收边界。

本次只读文档与已有 JSON，未执行评分器、历史 CLI、测试、构建、HTTP、完整检查或模型；未修改共享文件或 GitHub。输入摘要在复核前后不变。主侧 write/check 与最终 PR46 CI 不由本次文档复核代替；人工业务验收仍未完成。请求 GPT-6.1 Sol/ultra，实际服务后端未独立核验。
'''
save('ROUND40_FINAL_DOCUMENTS_INDEPENDENT.md', md.encode())
files = []
for p in sorted(OUT.iterdir()):
    if p.is_file():
        b = p.read_bytes()
        files.append({'path': str(p.relative_to(OWN)), 'bytes': len(b), 'sha256': sha(b)})
save_json('copy-index.final-documents-independent.json', {
    'schema': 'issue42-evidence-copy-index/1', 'source_root': str(OWN),
    'files': files, 'file_count': len(files), 'excludes_self': True,
})
print(json.dumps({'status': receipt['status'], 'files': len(files), 'receipt_sha256': sha((OUT/'final-documents-review.independent.json').read_bytes()), 'index_sha256': sha((OUT/'copy-index.final-documents-independent.json').read_bytes()), 'nonblocking_findings': findings}, ensure_ascii=False))
