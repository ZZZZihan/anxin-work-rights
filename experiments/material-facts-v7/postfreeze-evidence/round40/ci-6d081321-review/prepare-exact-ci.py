"""Read-only exact commit, run and source identity capture."""
from pathlib import Path
import datetime
import hashlib
import json
import subprocess

P = Path(__file__).resolve().parent
OWN = P.parents[2]
CODE = Path('/Users/xuzihan/Documents/Projects/国创/anxin-facts-v7-code-review')
HEAD = '6d081321b24b9fadd0088d6cc5b6c60e985eda26'
RUN = 39161803412
REPO = 'ZZZZihan/anxin-work-rights'
sha = lambda b: hashlib.sha256(b).hexdigest()

def save(name, obj):
    b = obj if isinstance(obj, bytes) else (json.dumps(obj, ensure_ascii=False, indent=2)+'\n').encode()
    with (P/name).open('xb') as f: f.write(b)

def api(path, name):
    r = subprocess.run(['gh','api',path],capture_output=True,timeout=45)
    if r.returncode:
        save(name+'.failure.stderr',r.stderr)
        raise RuntimeError(name)
    save(name,r.stdout)
    return json.loads(r.stdout)

def git(*args):
    r = subprocess.run(['git',*args],cwd=CODE,capture_output=True,timeout=30)
    assert r.returncode == 0,r.stderr
    return r.stdout

run=api(f'repos/{REPO}/actions/runs/{RUN}','terminal-run.json')
assert run['head_sha']==HEAD and run['status']=='completed' and run['conclusion']=='success'
api(f'repos/{REPO}/actions/runs/{RUN}/jobs?per_page=100','terminal-jobs.json')
pull=api(f'repos/{REPO}/pulls/45','pull45-at-start.json')
head=api(f'repos/{REPO}/git/commits/{HEAD}','head-commit-api-at-start.json')
merge_sha=pull['merge_commit_sha']
merge=api(f'repos/{REPO}/git/commits/{merge_sha}','merge-commit-api-at-start.json')
identity={'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'run':RUN,'head':HEAD,
 'pull_head_at_read':pull['head']['sha'],'pull_merge_sha_at_read':merge_sha,
 'remote_head_tree':head['tree']['sha'],'local_head_tree':git('rev-parse',HEAD+'^{tree}').decode().strip(),
 'merge_tree':merge['tree']['sha'],'merge_parents':[r['sha'] for r in merge['parents']]}
assert identity['pull_head_at_read']==HEAD and HEAD in identity['merge_parents']
assert identity['remote_head_tree']==identity['local_head_tree']==identity['merge_tree']
save('static-identity-at-start.json',identity)
save('head-git-ls-tree.raw',git('ls-tree','-r',HEAD))
save('workflow-exact-head.yml.snapshot',git('show',HEAD+':.github/workflows/ci.yml'))
save('package-exact-head.json.snapshot',git('show',HEAD+':package.json'))
prior=OWN/'postfreeze-evidence/round39/ci-5374d667-review'
rows=[]
for row in json.loads((prior/'local-original-results-vs-exact-head.json').read_bytes())['files']:
    path=row['path'];current=(CODE/path).read_bytes();blob=git('show',HEAD+':'+path)
    assert sha(current)==sha(blob)==row['sha256'],path
    rows.append({'path':path,'sha256':sha(current),'git_blob_sha256':sha(blob),'bytes':len(blob)})
save('local-original-results-vs-exact-head.json',{'head':HEAD,'count':len(rows),'files':rows})
history=json.loads((prior/'local-historical-manifests-hashes.json').read_bytes())
for row in history: assert sha((CODE/row['path']).read_bytes())==row['sha256'],row['path']
save('local-historical-manifests-hashes.json',history)
paths=git('ls-tree','-r','--name-only',HEAD).decode().splitlines()
chosen=[p for p in paths if p.startswith('lib/') and Path(p).suffix in {'.ts','.tsx'}]
chosen+=['package.json','.github/workflows/ci.yml','scripts/material-facts-v7-http-regression.mjs',
 'scripts/owned-http-process-group.mjs','scripts/material-facts-http-repeat-signal.test.mjs']
chosen+=[p for p in paths if p.startswith('scripts/material-facts-v7-round40-')]
current=[]
for path in dict.fromkeys(chosen):
    value=(CODE/path).read_bytes();blob=git('show',HEAD+':'+path)
    assert value==blob,path
    current.append({'path':path,'sha256':sha(blob),'bytes':len(blob)})
save('exact-head-vs-worktree.json',current)
for name in ['http481-final.json','http481-fixed-baseline.json','http481-final.receipt.json','http481-fixed-baseline.receipt.json','full-check.receipt.json']:
    save('parent-'+name,(CODE/'.scratch/issue42/round40'/name).read_bytes())
print(json.dumps({'head':HEAD,'conclusion':run['conclusion'],'tree':head['tree']['sha'],
 'current_exact_files':len(current),'original_immutable_files':len(rows),'historical_manifest_files':len(history)}))
