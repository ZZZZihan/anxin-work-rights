"""Additional full API replication after a transport-aborted primary run.

No scoring or inference changes. Original primary results remain authoritative
and visible; this separately identified report must never replace them.
"""
import argparse
import json
from pathlib import Path
import sys
HERE=Path(__file__).resolve().parent
BASE=HERE.parent
sys.path.insert(0,str(BASE))
import reporting
from dependencies import common
from freeze import verify

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--prepare-review',action='store_true');ap.add_argument('--check',action='store_true');args=ap.parse_args()
    verify()
    manifest=json.loads((HERE/'registration.json').read_text())
    if manifest['parent_freeze_sha256']!=common.sha(BASE/'freeze.json') or manifest['adapter_sha256']!=common.sha(Path(__file__)):
        raise ValueError('Replication registration mismatch')
    if manifest['primary_results_sha256']!=common.sha(BASE/'results/deepseek/results.jsonl'):
        raise ValueError('Primary failed run changed')
    for name,target in {'data':'../data','freeze.json':'../freeze.json','results/qwen':'../../results/qwen'}.items():
        p=HERE/name
        if not p.is_symlink() or str(p.readlink())!=target:raise ValueError('Replication alias mismatch')
    reporting.ROOT=HERE  # Same frozen context/metrics, separate run and review artifacts.
    if args.prepare_review:reporting.prepare();return
    result=reporting.summarize()
    path=HERE/'comparison.json'
    if args.check:
        if json.loads(path.read_text())!=result:raise ValueError('Replication reproduction mismatch')
    else:common.save(path,result)
    print(json.dumps({b:r['semantic_slices']['nonterminal'] for b,r in result['backends'].items()},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
