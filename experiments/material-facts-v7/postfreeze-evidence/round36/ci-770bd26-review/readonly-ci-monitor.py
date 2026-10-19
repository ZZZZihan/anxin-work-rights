from pathlib import Path
import subprocess,json,time,hashlib,datetime,zipfile
P=Path(__file__).parent
RUN=39153403159
REPO='ZZZZihan/anxin-work-rights'
def fetch(endpoint,path):
 cp=subprocess.run(['gh','api',f'repos/{REPO}/'+endpoint],capture_output=True,timeout=60)
 path.write_bytes(cp.stdout)
 if cp.returncode:
  path.with_suffix(path.suffix+'.stderr').write_bytes(cp.stderr)
  raise RuntimeError(f'gh exit {cp.returncode}: {endpoint}')
 return cp.stdout
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
previous=None
for number in range(2,82):
 try:
  r=json.loads(fetch(f'actions/runs/{RUN}',P/f'poll-{number:03}-run.json'))
  j=json.loads(fetch(f'actions/runs/{RUN}/jobs?per_page=100',P/f'poll-{number:03}-jobs.json'))
  state=(r['status'],r['conclusion'],tuple((x['id'],x['status'],x['conclusion'],tuple((s['number'],s['status'],s['conclusion']) for s in x['steps'])) for x in j['jobs']))
  if state!=previous:
   print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'poll':number,'run':r['status'],'conclusion':r['conclusion'],'jobs':[{'id':x['id'],'status':x['status'],'conclusion':x['conclusion'],'running':[s['name'] for s in x['steps'] if s['status']=='in_progress'],'failed':[s['name'] for s in x['steps'] if s['conclusion']=='failure']} for x in j['jobs']]},ensure_ascii=False),flush=True)
   previous=state
  if r['status']=='completed':
   (P/'terminal-run.json').write_text(json.dumps(r,indent=2)+'\n')
   (P/'terminal-jobs.json').write_text(json.dumps(j,indent=2)+'\n')
   fetch(f'actions/runs/{RUN}/logs',P/'run-original-logs.zip')
   for job in j['jobs']:fetch(f"actions/jobs/{job['id']}/logs",P/f"job-{job['id']}-original.log")
   a=json.loads(fetch(f'actions/runs/{RUN}/artifacts?per_page=100',P/'artifacts-api.json'))
   rows=[]
   for item in a['artifacts']:
    target=P/f"artifact-{item['id']}-{item['name']}.zip"
    fetch(f"actions/artifacts/{item['id']}/zip",target)
    actual=sha(target); advertised=item.get('digest')
    rows.append({'id':item['id'],'name':item['name'],'zip_sha256':actual,'api_digest':advertised,'digest_matches':advertised==f'sha256:{actual}','bytes':target.stat().st_size})
    with zipfile.ZipFile(target) as z:
     for info in z.infolist():
      rel=Path(info.filename)
      if info.is_dir() or rel.is_absolute() or '..' in rel.parts:continue
      if rel.suffix not in ('.json','.log'):continue
      dest=P/'selected-artifacts'/item['name']/rel
      dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(info))
   (P/'artifact-download-digests.json').write_text(json.dumps(rows,indent=2)+'\n')
   print(json.dumps({'terminal_capture_complete':True,'conclusion':r['conclusion'],'artifacts':rows},ensure_ascii=False),flush=True)
   break
 except Exception as error:
  with (P/'monitor-errors.jsonl').open('a') as out:out.write(json.dumps({'poll':number,'error':str(error),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()})+'\n')
  print(json.dumps({'poll':number,'capture_error':str(error)}),flush=True)
 time.sleep(45)
else:
 raise SystemExit('Bounded monitor ended before complete terminal capture; continue read-only if needed.')
