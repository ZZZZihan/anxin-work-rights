"""Retain true-CLI failure artifacts; no models, network, or frozen writes."""
from pathlib import Path
import hashlib
import json
import os
import resource
import subprocess


HERE = Path(__file__).resolve().parent
OWN = HERE.parents[4]
NODE = Path('/Users/xuzihan/.npm/_npx/387698761821791d/node_modules/node/bin/node')
FIXTURES = OWN / '.scratch/issue42/round42-assessment-publication'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def execute(root, target, output, name, limited=False):
    args = [str(NODE), '--import', (target / 'signals.mjs').as_uri(),
            str(root / 'experiments/material-facts-v7/assess.mjs'),
            *[str(target / (n + '.jsonl')) for n in ['inputs', 'labels', 'results']], str(output)]
    def limit():
        resource.setrlimit(resource.RLIMIT_FSIZE, (128, 128))
    result = subprocess.run(args, capture_output=True, timeout=10,
                            preexec_fn=limit if limited else None, env=dict(os.environ))
    (target / (name + '.stdout.log')).write_bytes(result.stdout)
    (target / (name + '.stderr.log')).write_bytes(result.stderr)
    return {'command': args, 'exit_code': result.returncode,
            'stdout_sha256': hashlib.sha256(result.stdout).hexdigest(),
            'stderr_sha256': hashlib.sha256(result.stderr).hexdigest()}


observations = {}
for variant in ['fixed-baseline', 'patched-cli']:
    root = FIXTURES / variant
    target = HERE / 'retained-native-artifacts' / variant
    target.mkdir(parents=True, exist_ok=False)
    for n in ['inputs', 'labels', 'results']:
        (target / (n + '.jsonl')).write_text('\n')
    (target / 'signals.mjs').write_text("process.on('SIGXFSZ', () => {});\n")

    existing = target / 'existing-report.json'
    seed = b'{"immutable_report_before":true}\n'
    existing.write_bytes(seed)
    (target / 'existing-before.snapshot').write_bytes(seed)
    row = {'existing': execute(root, target, existing, 'existing')}
    row['existing']['original_unchanged'] = existing.read_bytes() == seed

    original = target / 'symlink-target.json'
    original.write_bytes(seed)
    symlink = target / 'symlink-report.json'
    symlink.symlink_to(original.name)
    row['symlink'] = execute(root, target, symlink, 'symlink')
    row['symlink']['original_unchanged'] = original.read_bytes() == seed
    row['symlink']['is_symlink'] = symlink.is_symlink()

    partial = target / 'partial-report.json'
    row['partial'] = execute(root, target, partial, 'partial', limited=True)
    row['partial']['final_exists_after_failure'] = partial.exists()
    row['partial']['stage_files_after_failure'] = [p.name for p in target.glob('.partial-report.json.*.stage')]
    if partial.exists():
        (target / 'partial-failure.snapshot').write_bytes(partial.read_bytes())
        row['partial']['partial_final_bytes'] = partial.stat().st_size
    else:
        stage = next(target.glob('.partial-report.json.*.stage'))
        row['partial']['partial_stage_bytes'] = stage.stat().st_size
    row['retry'] = execute(root, target, partial, 'retry')
    row['retry']['complete_report'] = json.loads(partial.read_text())['planned_documents'] == 0
    row['retained_files'] = {str(p.relative_to(target)): digest(p) for p in target.iterdir() if p.is_file() and not p.is_symlink()}
    observations[variant] = row

assert observations['fixed-baseline']['existing']['exit_code'] == 0
assert not observations['fixed-baseline']['existing']['original_unchanged']
assert not observations['fixed-baseline']['symlink']['original_unchanged']
assert observations['fixed-baseline']['partial']['partial_final_bytes'] == 128
assert observations['patched-cli']['existing']['exit_code'] == 1
assert observations['patched-cli']['existing']['original_unchanged']
assert observations['patched-cli']['symlink']['original_unchanged']
assert not observations['patched-cli']['partial']['final_exists_after_failure']
assert observations['patched-cli']['partial']['partial_stage_bytes'] == 128
assert observations['patched-cli']['retry']['complete_report']
(HERE / 'retained-cli-observations.json').write_text(json.dumps(observations, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: {name: {k: v for k, v in value.items() if k not in ['command', 'retained_files']} for name, value in row.items() if name != 'retained_files'} for key, row in observations.items()}, ensure_ascii=False))
