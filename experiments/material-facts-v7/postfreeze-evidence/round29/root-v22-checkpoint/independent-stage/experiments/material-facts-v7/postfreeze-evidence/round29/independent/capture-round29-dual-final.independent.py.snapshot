from pathlib import Path
import argparse,datetime,hashlib,json,os,re,subprocess,time
parser=argparse.ArgumentParser();parser.add_argument('--source-root',required=True);parser.add_argument('--stage',required=True)
a=parser.parse_args();own=Path(__file__).resolve().parents[2];source=Path(a.source_root).resolve();ev=Path(__file__).resolve().parent
assert re.fullmatch(r'[A-Za-z0-9-]+',a.stage)
scripts=[own/'scripts/material-facts-v7-round29-independent.test.mjs',own/'scripts/material-facts-v7-round29-schedule-layout-independent.test.mjs',own/'scripts/material-facts-v7-round29-arithmetic-status-independent.test.mjs']
paths=['lib/material-money-v4.ts','lib/material-fact-arithmetic-review.ts','lib/material-fact-range-review.ts','lib/material-fact-source-review.ts','lib/material-fact-event-review.ts','lib/material-fact-currency-review.ts','lib/material-fact-runtime-ingest.ts','experiments/material-facts-v7/assess.mjs']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before={p:sha(source/p) for p in paths};script_hashes={str(p):sha(p) for p in scripts};runs=[]
for name,node in [('node24','/Users/xuzihan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'),('node26','/opt/homebrew/bin/node')]:
    out=ev/f'{a.stage}-{name}.stdout.txt';err=ev/f'{a.stage}-{name}.stderr.txt';started=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic();env=os.environ.copy();env['V7_REVIEW_ROOT']=str(source)
    with out.open('xb') as o,err.open('xb') as e:
        proc=subprocess.run([node,'--test','--test-reporter=tap',*[str(p) for p in scripts]],cwd=source,env=env,stdout=o,stderr=e,timeout=60)
    record={'source_root':str(source),'scripts':script_hashes,'node':node,'node_version':subprocess.check_output([node,'--version'],text=True).strip(),'started_at':started,'elapsed_seconds':time.monotonic()-t,'exit_code':proc.returncode,'counts':{k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',out.read_text(),re.M)},'stdout_sha256':sha(out),'stderr_sha256':sha(err)}
    with (ev/f'{a.stage}-{name}.execution.json').open('x') as f:json.dump(record,f,ensure_ascii=False,indent=2);f.write('\n')
    runs.append(record);print(json.dumps(record,ensure_ascii=False))
after={p:sha(source/p) for p in paths};assert before==after;assert script_hashes=={str(p):sha(p) for p in scripts}
with (ev/f'{a.stage}-protected.json').open('x') as f:json.dump({'source_root':str(source),'before':before,'after':after,'scripts':script_hashes,'unchanged':True,'runs':runs},f,ensure_ascii=False,indent=2);f.write('\n')
if any(r['exit_code']!=0 for r in runs):raise SystemExit(1)
