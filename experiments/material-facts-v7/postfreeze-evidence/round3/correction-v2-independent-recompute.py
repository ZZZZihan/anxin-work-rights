# Independent third-round audit. The original raw responses and labels are unchanged.
# Hash-bound runtime acceptance bridge; independently implemented event matching and counts.

from pathlib import Path
import json, subprocess, re, hashlib, decimal, sys, os
from collections import Counter
ROOT=Path.cwd(); BASE=Path('experiments/material-facts-v7')
CODE_ROOT=Path(os.environ.get('V7_FROZEN_CODE_ROOT',str(ROOT)))

binding=json.loads((ROOT/BASE/'corrections-v2/manifest.json').read_text())['code_sha256']
for path in ['lib/material-money-v4.ts','lib/material-fact-runtime-ingest.ts','lib/material-fact-source-review.ts']:
 assert hashlib.sha256((CODE_ROOT/path).read_bytes()).hexdigest()==binding[path], 'Audit bridge is not bound to recorded corrective code: '+path

def sha(p): return hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
def rows(p):
 return [json.loads(x) for x in (ROOT/p).read_text().splitlines() if x.strip()]
inputs=rows(BASE/'data/holdout.inputs.jsonl')
labels={x['id']:x for x in rows(BASE/'data/holdout.labels.provisional.jsonl')}
MODES=['raw_basic','raw_relational','raw_strict','accepted_basic','accepted_relational','accepted_strict']
FIELDS={'kind','value','quote','blockId','subject','scope','meaning','completeness','period','rateUnit','assertion'}
# Native bridge invokes only recorded runtime ingestion/source review, not assess/verify/match.
bridge=r"""
import fs from 'node:fs';
import {validateRuntimeCandidateOutput} from './lib/material-fact-runtime-ingest.ts';
import {reviewCandidateAgainstSource} from './lib/material-fact-source-review.ts';
import {canonicalMonetaryExpression,classifyMonetaryExpression} from './lib/material-money-v4.ts';
let payload=JSON.parse(fs.readFileSync(0,'utf8'));
let answer=[];
for(let item of payload){
 let a={id:item.id,protocol:false,accepted:[],rejected:[],keys:[],defense:[]};
 try{
  let batch=validateRuntimeCandidateOutput(item.raw_output,item.source);
  a.protocol=true; a.rejected=batch.rejected;
  if(item.finish_reason==='stop') for(let candidate of batch.candidates){
   let c=reviewCandidateAgainstSource(candidate,item.source);
   a.accepted.push(c.representation);
   a.defense.push({value:c.representation.value,kind:c.representation.kind,meaning:c.representation.meaning,amount:c.amount,status:c.normalization.status,issues:c.reviewIssues.map(x=>x.code)});
  }
 }catch(e){a.protocol_error=String(e.message)}
 for(let c of item.canonical_values) a.keys.push(c.kind==='date'?'date:'+c.value:classifyMonetaryExpression(c.value).kind==='not_monetary'?null:canonicalMonetaryExpression(c.value)??'literal:'+c.value);
 answer.push(a);
}
console.log(JSON.stringify(answer));
"""
def parsed(raw):
 text=raw.strip()
 if text.startswith('\x60\x60\x60'):
  m=re.fullmatch(r'\x60\x60\x60(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n\x60\x60\x60',text)
  if not m: return None
  text=m[1]
 try: return json.loads(text)
 except: return None
def envelope(p):
 return isinstance(p,dict) and set(p)=={'schemaVersion','candidates'} and p['schemaVersion']==3 and isinstance(p['candidates'],list) and len(p['candidates'])<=40
def shape(c,source):
 if not isinstance(c,dict) or set(c)!=FIELDS: return False
 if c['kind'] not in ('money','date') or c['scope'] not in ('individual','group','organization','unknown') or c['assertion'] not in ('claimed','admitted','decided','narrated','unknown'): return False
 if any(not isinstance(c[k],str) or not c[k].strip() or len(c[k].encode('utf-16-le'))//2>4000 for k in ('value','quote','blockId')): return False
 if any(c[k] is not None and (not isinstance(c[k],str) or not c[k].strip() or len(c[k].encode('utf-16-le'))//2>4000) for k in ('subject','period')): return False
 if any(c[k] is not None and not any(c[k] in b['text'] for b in source['blocks']) for k in ('subject','period')): return False
 if c['kind']=='date':
  if c['meaning'] not in ('employment_period','wage_period','contract_signing','contract_performance','payment_date','other_date') or c['completeness']!='not_applicable' or c['rateUnit'] is not None or c['period'] is not None: return False
 else:
  if c['meaning'] not in ('due_total','paid_total','payment','arrears','award','rate','other_money'): return False
  if c['meaning']=='rate':
   if c['completeness']!='not_applicable' or c['rateUnit'] not in ('month','day','hour','piece','unknown'): return False
  elif c['rateUnit'] is not None: return False
  elif c['meaning'] in ('due_total','paid_total'):
   if c['completeness'] not in ('complete','partial','unknown'): return False
  elif c['meaning']=='payment':
   if c['completeness'] not in ('partial','unknown'): return False
  elif c['completeness']!='not_applicable': return False
 blocks=[b for b in source['blocks'] if b['id']==c['blockId']]
 return bool(blocks) and c['quote'] in blocks[0]['text'] and c['value'] in c['quote']
def positions(text,needle):
 result=[]; at=text.find(needle)
 while at>=0:
  result.append(at); at=text.find(needle,at+1)
 return result

def finite_containment(kind,start,end,anchor,text):
 a,b=anchor['start'],anchor['end']
 if a<=start and end<=b: outer=(a,b); inner=(start,end)
 elif start<=a and b<=end: outer=(start,end); inner=(a,b)
 else:return False
 left=text[outer[0]:inner[0]].strip(); right=text[inner[1]:outer[1]].strip()
 if kind=='money':
  if left.upper() not in {'','人民币','RMB','CNY','¥','￥'}:return False
  if right[:1] in {'整','正'}:right=right[1:].strip()
  return right in {'','工资','劳务费','劳动报酬'}
 return left in {'','自','从','截至'} and right in {'','起','止','前','后','间','期间'}

def bind(c,source,label,protocol):
 if not protocol or not shape(c,source): return {'event':None,'reason':'invalid_protocol' if not protocol else 'invalid_evidence','positions':[]}
 text=next(b['text'] for b in source['blocks'] if b['id']==c['blockId'])
 allpos=[(q+v,q+v+len(c['value'])) for q in positions(text,c['quote']) for v in positions(c['quote'],c['value'])]
 memberships=[]
 for start,end in allpos:
  owners=[e['id'] for e in label['events'] if any(a['blockId']==c['blockId'] and finite_containment(c['kind'],start,end,a,text) for a in e['anchors'])]
  memberships.append(owners)
 if any(len(x)!=1 for x in memberships): reason='unregistered_position' if any(not x for x in memberships) else 'ambiguous_event'
 elif len(set(x[0] for x in memberships))!=1: reason='ambiguous_event'
 else: reason='aligned'
 return {'event':memberships[0][0] if reason=='aligned' else None,'reason':reason,'positions':[{'blockId':c['blockId'],'start':s,'end':e} for s,e in allpos]}

DIGITS=dict(zip('零〇一二三四五六七八九', [0,0,1,2,3,4,5,6,7,8,9]))
DIGITS.update(dict(zip('壹贰叁肆伍陆柒捌玖',[1,2,3,4,5,6,7,8,9]))); DIGITS['两']=2
SMALL={'十':10,'拾':10,'百':100,'佰':100,'千':1000,'仟':1000}
NUM='0-9零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟'
def chinese(s):
 if not s: return 0
 total=section=0; digit=0
 for ch in s:
  if ch in DIGITS: digit=DIGITS[ch]
  elif ch in SMALL: section+=(digit or 1)*SMALL[ch]; digit=0
  elif ch=='万': total+=(section+digit)*10000; section=digit=0
  elif ch=='亿': total=(total+section+digit)*100000000; section=digit=0
  else: return None
 return total+section+digit
def amount(s):
 s=s.strip().removeprefix('人民币').strip().removeprefix('￥').removeprefix('¥').strip()
 m=re.fullmatch(r'([0-9][0-9,，]*(?:\.[0-9]+)?)(万|亿)?[元圆](?:整|正)?',s)
 if m:
  n=decimal.Decimal(m[1].replace(',','').replace('，',''))*{'万':10000,'亿':100000000,None:1}[m[2]]
  return f'{n:.2f}'
 m=re.fullmatch(r'(['+NUM+r']+)[元圆](?:([零〇一二三四五六七八九两壹贰叁肆伍陆柒捌玖])角)?(?:零?([零〇一二三四五六七八九两壹贰叁肆伍陆柒捌玖])分)?(?:整|正)?',s)
 if not m:return None
 n=chinese(m[1])
 if n is None:return None
 cents=n*100+(DIGITS[m[2]]*10 if m[2] else 0)+(DIGITS[m[3]] if m[3] else 0)
 return f'{cents//100}.{cents%100:02}'
PREFIX=['不得少于','不得低于','不得超过','不得高于','不超过','不少于','不低于','不高于','大约','将近','接近','超过','不足','至少','至多','上限','下限','最高','最低','可能','或许','大概','估计','不确定','待核','暂计','暂定','约','近']
SUFFIX=['左右','上下','以上','以下','多','余','起']
def ownkey(c):
 if not isinstance(c,dict) or c.get('kind') not in ('money','date') or not isinstance(c.get('value'),str):return None
 if c['kind']=='date':return 'date:'+c['value']
 raw=c['value']; text=raw.strip()
 if text in ('元月','元旦','圆满','工资','薪资','薪酬','劳务费','劳动报酬'):return None
 exact=amount(text)
 if exact is None:
  token_pattern=r'(?:[¥￥]?\s*(?:[0-9][0-9,，]*(?:\.[0-9]+)?(?:万|亿)?|[零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟]+)\s*[元圆](?:[零〇一二三四五六七八九两壹贰叁肆伍陆柒捌玖]角)?(?:零?[零〇一二三四五六七八九两壹贰叁肆伍陆柒捌玖]分)?(?:整|正)?)'
  found=list(re.finditer(token_pattern,text))
  if len(found)==1:
   match=found[0]; remainder=text[:match.start()]+text[match.end():]
   if not re.search('['+NUM+']',remainder) and not any(x in remainder for x in PREFIX+['负','負','数','數','几','幾','余','多','美元','港币','港幣','新台币','CAD','加拿大元']):
    exact=amount(match[0])
 if exact is not None:return 'exact:'+exact
 # Dataset literal classes are checked independently with Decimal/Chinese integer
 # arithmetic; qualifiers are kept in place rather than converted to exact money.
 text=re.sub(r'\s*(?:工资|劳务费|劳动报酬)\s*$','',text).strip()
 text=re.sub(r'^人民币\s*','',text)
 prefix=next((x for x in PREFIX if text.startswith(x)),None)
 rest=text[len(prefix):].strip() if prefix else text
 suffix=next((x for x in SUFFIX if rest.endswith(x)),None)
 inner=rest[:-len(suffix)].strip() if suffix else rest
 modifier=re.fullmatch(r'(['+NUM+r',.，]+)(多|余)([元圆])',inner)
 status='uncertain' if prefix in ('可能','或许','大概','估计','不确定','待核','暂计','暂定') else 'approximate'
 if modifier and amount(modifier[1]+modifier[3]) is not None:
  return f'{status}:{prefix or ""}:{amount(modifier[1]+modifier[3])}:{suffix or ""}:inner={modifier[2]}'
 if (prefix or suffix) and amount(inner) is not None:return f'{status}:{prefix or ""}:{amount(inner)}:{suffix or ""}'
 # Fallback is literal evidence, not a calculation amount.
 return 'literal:'+raw
def equivalents(c,g,level):
 if c.get('kind')!=g['kind'] or ownkey(c) is None or ownkey(c)!=ownkey(g) or c.get('meaning')!=g['meaning']:return False
 if c.get('meaning')=='rate' and c.get('rateUnit')!=g['rateUnit']:return False
 keys=[] if level=='basic' else ['subject','scope','period','completeness']
 if level=='strict':keys+=['assertion']
 return all(c.get(k)==g[k] for k in keys)
def alternatives(label,index):
 return [label['expected'][index]]+[c for alt in label.get('acceptable_alternatives',[]) if alt['expected_index']==index for c in alt['candidates']]
def independent_match(candidates,bindings,label,level):
 # Exhaust all attainable gold subsets. This bitmask dynamic program is
 # independent of assess.mjs's recursive augmenting-path implementation.
 paths={0:[]}
 for actual,c in enumerate(candidates):
  edges=[g for g in range(len(label['expected'])) if bindings[actual]['event']==label['expected_event_ids'][g] and any(equivalents(c,v,level) for v in alternatives(label,g))]
  updated=dict(paths)
  for mask,pairs in paths.items():
   for g in edges:
    if not mask&(1<<g): updated.setdefault(mask|(1<<g),pairs+[(actual,g)])
  paths=updated
 mask=max(paths,key=lambda m:(m.bit_count(),-m)); pairs=paths[mask]; used={a for a,g in pairs}
 return {'tp':mask.bit_count(),'fp':len(candidates)-mask.bit_count(),'fn':len(label['expected'])-mask.bit_count(),'pairs':[{'actual':a,'expected':g} for a,g in pairs],'extra':[i for i in range(len(candidates)) if i not in used],'missing':[g for g in range(len(label['expected'])) if not(mask&(1<<g))]}
def audit(backend):
 path=BASE/'results'/f'holdout-{backend}-1/results.jsonl'; results=rows(path)
 payload=[]
 for result in results:
  inp=next(i for i in inputs if i['id']==result['id'])
  p=parsed(result['raw_output']); raw=p.get('candidates',[]) if isinstance(p,dict) and isinstance(p.get('candidates'),list) else []
  payload.append({**result,'source':inp['source'],'canonical_values':raw+labels[result['id']]['expected']})
 bridged=json.loads(subprocess.check_output(['node','--input-type=module','-e',bridge],input=json.dumps(payload).encode(),cwd=CODE_ROOT))
 bridge_map={x['id']:x for x in bridged}; result_map={x['id']:x for x in results}
 cases=[]; canonical_diffs=[]; protocol_diffs=[]
 for inp in inputs:
  label=labels[inp['id']]; result=result_map.get(inp['id']); meta=bridge_map.get(inp['id'],{'protocol':False,'accepted':[],'rejected':[],'defense':[]})
  p=parsed(result['raw_output']) if result else None; raw=p.get('candidates',[]) if isinstance(p,dict) and isinstance(p.get('candidates'),list) else []
  env=envelope(p)
  if env!=meta['protocol'] and result:protocol_diffs.append(inp['id'])
  for i,c in enumerate(raw+label['expected'] if result else []):
   key=ownkey(c)
   if key!=meta.get('keys',[])[i]:canonical_diffs.append({'id':inp['id'],'index':i,'value':c.get('value'),'own':key,'frozen_primitive':meta['keys'][i]})
  raw_bind=[bind(c,inp['source'],label,env) for c in raw]
  accepted=meta['accepted']; acc_bind=[bind(c,inp['source'],label,True) for c in accepted]
  row={'id':inp['id'],'gold':len(label['expected']),'returned':result is not None,'finish_reason':result.get('finish_reason') if result else None,'raw_count':len(raw),'accepted_count':len(accepted),'rejected':meta['rejected'],'raw_candidates':raw,'accepted_candidates':accepted,'raw_events':raw_bind,'accepted_events':acc_bind,'defense':meta['defense']}
  for mode in MODES:
   layer,level=mode.split('_');row[mode]=independent_match(raw if layer=='raw' else accepted,raw_bind if layer=='raw' else acc_bind,label,level)
  cases.append(row)
 metrics={}
 for mode in MODES:
  counts={k:sum(c[mode][k] for c in cases) for k in ('tp','fp','fn')}; tp,fp,fn=(counts[k] for k in ('tp','fp','fn'))
  metrics[mode]={**counts,'precision':tp/(tp+fp) if tp+fp else None,'recall':tp/(tp+fn) if tp+fn else None,'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None}
 return {'backend':backend,'results_path':str(path),'results_sha256':sha(path),'returned':len(results),'completed':sum(r.get('finish_reason')=='stop' for r in results),'planned_documents':len(inputs),'expected_facts':sum(len(x['expected']) for x in labels.values()),'metrics':metrics,'canonical_differences':canonical_diffs,'protocol_differences':protocol_diffs,'cases':cases}
all_audits={b:audit(b) for b in ['rules','qwen','deepseek']}
if '--compact' in sys.argv:
 for backend,a in all_audits.items():
  print(json.dumps({k:v for k,v in a.items() if k!='cases'},ensure_ascii=False))
else:print(json.dumps(all_audits,ensure_ascii=False))
