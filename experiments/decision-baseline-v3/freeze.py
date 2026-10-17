"""Freeze before opening fresh data; verification is entirely offline."""
import argparse
import json
from pathlib import Path
from dependencies import ROOT, V1, V2, common


def sources():
    paths=list(ROOT.glob('*.py'))+[ROOT/n for n in ('prompt.txt','CONTRACT.md','METRICS.md','DEVELOPMENT.md')]
    paths += [p for d in (V1,V2) for p in d.glob('*.py')]
    paths += [d/'freeze.json' for d in (V1,V2)]
    return {p.relative_to(ROOT.parent).as_posix():common.sha(p) for p in sorted(paths)}


def verify():
    frozen=json.loads((ROOT/'freeze.json').read_text())
    if sources()!=frozen['source_sha256']:raise ValueError('Frozen source inventory/hash mismatch')
    actual={p.name:common.sha(p) for p in sorted((ROOT/'data').iterdir()) if p.is_file()}
    if actual!=frozen['data_sha256']:raise ValueError('Frozen data inventory/hash mismatch')
    return frozen


def verify_run(run_dir):
    frozen=verify()
    p=json.loads((run_dir/'protocol.json').read_text())
    expected_sources={q.name:common.sha(q) for q in sorted(ROOT.glob('*.py'))}
    expected_deps={q.relative_to(ROOT.parent).as_posix():common.sha(q) for d in (V1,V2) for q in sorted(d.glob('*.py'))}
    if p.get('source_sha256')!=expected_sources or p.get('dependency_sha256')!=expected_deps:raise ValueError('Run source provenance mismatch')
    if p.get('prompt_sha256')!=common.sha(ROOT/'prompt.txt'):raise ValueError('Run prompt provenance mismatch')
    if p.get('inputs_sha256')!=frozen['data_sha256']['test.inputs.jsonl']:raise ValueError('Run frozen inputs mismatch')
    if p.get('training') is not False or p.get('adapter') is not None or p.get('gold_sent_to_inference') is not False:raise ValueError('Run isolation mismatch')
    from run import build_messages
    records=common.read_jsonl(ROOT/'data/test.inputs.jsonl')
    if p.get('case_ids')!=[x['id'] for x in records]:raise ValueError('Run case order mismatch')
    if json.loads((run_dir/'inputs-visible.json').read_text())!=records:raise ValueError('Run input snapshot mismatch')
    indexed={r['id']:r for r in records}
    for r in common.read_jsonl(run_dir/'results.jsonl'):
        if r.get('backend')!=p['backend']:raise ValueError('Run backend mismatch')
        if r.get('model_invoked'):
            if r.get('request_messages')!=build_messages(indexed[r['id']],'v3',(ROOT/'prompt.txt').read_text()):raise ValueError('Run request messages mismatch')
            if p['backend']=='qwen':
                expected=''.join('<|im_start|>'+m['role']+'\n'+m['content']+'<|im_end|>\n' for m in r['request_messages'])+'<|im_start|>assistant\n<think>\n\n</think>\n\n'
                if r.get('rendered_prompt')!=expected:raise ValueError('Qwen rendered prompt mismatch')
    return p


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--seal-data',type=Path);args=ap.parse_args()
    if args.seal_data:
        if (ROOT/'freeze.json').exists():raise ValueError('Never overwrite a freeze')
        value={'frozen_at':common.now(),'source_sha256':sources(),'data_sha256':{p.name:common.sha(p) for p in sorted(args.seal_data.iterdir()) if p.is_file()},'implementation_author_has_read_fresh_cases':False,'training':False,'source_changes_after_first_test_forbidden':True}
        common.save(ROOT/'freeze.json',value)
        print('Sources and sealed data hashes recorded; fresh cases not opened by implementation author')
    else:
        f=verify();print(json.dumps({'sources':len(f['source_sha256']),'data':len(f['data_sha256'])}))
