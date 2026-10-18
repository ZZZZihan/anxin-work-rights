"""Bind anonymous question review to frozen actual outputs, then reproduce results."""
import argparse
from collections import Counter,defaultdict
import hashlib
import json
import secrets
from pathlib import Path

from dependencies import ROOT,common
from assess import evaluate
from freeze import verify,verify_run
from run import model_facts

BACKENDS=('qwen','deepseek')
ARMS=('model','ungated','guarded')

def stable(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(value):return hashlib.sha256(stable(value).encode()).hexdigest()
def require(condition,message):
    if not condition:raise ValueError(message)
def unique(rows,key):
    result={r[key]:r for r in rows}
    require(len(result)==len(rows),'Duplicate '+key)
    return result

def context():
    verify()
    inputs=ROOT/'data/test.inputs.jsonl';labels=ROOT/'data/test.labels.jsonl'
    records=unique(common.read_jsonl(inputs),'id');gold=unique(common.read_jsonl(labels),'id')
    runs={}
    for backend in BACKENDS:
        directory=ROOT/'results'/backend
        protocol=verify_run(directory)
        require(protocol['backend']==backend,'Backend directory mismatch')
        rows=unique(common.read_jsonl(directory/'results.jsonl'),'id')
        assessment=evaluate(inputs,labels,directory)
        runs[backend]={'rows':rows,'assessment':assessment,'protocol':protocol,'hashes':{n:common.sha(directory/n) for n in ('protocol.json','results.jsonl','inputs-visible.json','outcome.json')}}
    identity={'inputs_sha256':common.sha(inputs),'labels_sha256':common.sha(labels),'freeze_sha256':common.sha(ROOT/'freeze.json'),'runs':{b:r['hashes'] for b,r in runs.items()}}
    return records,gold,runs,identity

def outputs(row):
    return {'model':row.get('parsed',{}).get('canonical'),**{a:row.get(a,{}).get('dispatch',{}).get('canonical') for a in ('ungated','guarded')}}
def needs_review(expected,actual):
    return expected['next_action']['type']=='ask_user' or (isinstance(actual,dict) and actual.get('next_action',{}).get('type')=='ask_user')

def make_packet(records,gold,runs,identity,salt=None):
    salt=salt or secrets.token_hex(32)
    packet=[];mapping={}
    for backend in BACKENDS:
        cases={c['id']:c for c in runs[backend]['assessment']['cases']}
        for ident,record in records.items():
            if cases[ident]['terminal']:continue
            grouped={}
            for arm,actual in outputs(runs[backend]['rows'].get(ident,{})).items():
                if needs_review(gold[ident]['expected'],actual):grouped.setdefault(stable(actual),[]).append(arm)
            for encoded,arms in grouped.items():
                rid=digest([salt,backend,ident,encoded])[:24]
                packet.append({'review_id':rid,'messages':record['messages'],'facts':{'fields':model_facts(record)['fields']},'expected':gold[ident]['expected'],'actual':json.loads(encoded)})
                mapping[rid]={'backend':backend,'id':ident,'arms':arms}
    packet.sort(key=lambda r:r['review_id'])
    return packet,{'identity':identity,'private_salt':salt,'packet_digest':digest(packet),'cases':mapping}


def prepare():
    records,gold,runs,identity=context();packet,mapping=make_packet(records,gold,runs,identity)
    directory=ROOT/'review';directory.mkdir(exist_ok=True)
    for name,value,jsonl in [('blind.jsonl',packet,True),('mapping.json',mapping,False)]:
        with (directory/name).open('x') as f:
            f.write(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in value) if jsonl else json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'anonymous_outputs':len(packet),'packet_digest':digest(packet)}))


def validate_reviews(packet,mapping,semantic):
    require(set(semantic)=={'packet_digest','reviewer','cases'},'Unexpected review document fields')
    require(semantic['packet_digest']==digest(packet)==mapping['packet_digest'],'Review packet digest mismatch')
    reviewer=semantic['reviewer']
    require(reviewer.get('kind')=='independent_agent' and reviewer.get('human_expert') is False,'Reviewer disclosure required')
    require(reviewer.get('model_requested')=='gpt-6.1-sol' and reviewer.get('reasoning_effort_requested')=='ultra','Requested reviewer configuration missing')
    indexed=unique(semantic['cases'],'review_id')
    require(set(indexed)==set(mapping['cases'])=={p['review_id'] for p in packet},'Review coverage mismatch')
    for row in indexed.values():
        require(set(row)=={'review_id','question_semantics_correct','reason'},'Unexpected review row fields')
        require(type(row['question_semantics_correct']) is bool and type(row['reason']) is str and bool(row['reason'].strip()),'Invalid semantic judgment')
    return indexed


def metric(values):
    values=list(values);applicable=[v for v in values if v is not None]
    require(all(type(x) is bool for x in applicable),'Invalid metric')
    return {'correct':sum(applicable),'planned':len(values),'applicable':len(applicable),'not_applicable':len(values)-len(applicable),'rate':sum(applicable)/len(applicable) if applicable else None}

def summarize():
    records,gold,runs,identity=context()
    stored=common.read_jsonl(ROOT/'review/blind.jsonl');storedmap=json.loads((ROOT/'review/mapping.json').read_text())
    require(type(storedmap.get('private_salt')) is str and len(storedmap['private_salt'])==64,'Missing private review salt')
    packet,mapping=make_packet(records,gold,runs,identity,storedmap['private_salt'])
    require(stored==packet and storedmap==mapping,'Anonymous packet or mapping changed')
    semantic=json.loads((ROOT/'review/semantic.json').read_text());review=validate_reviews(packet,mapping,semantic)
    joined={}
    for rid,target in mapping['cases'].items():
        for arm in target['arms']:
            key=(target['backend'],target['id'],arm)
            require(key not in joined,'Duplicate semantic target');joined[key]=review[rid]['question_semantics_correct']
    comparison={'identity':identity,'semantic_sha256':common.sha(ROOT/'review/semantic.json'),'reviewer':semantic['reviewer'],'backends':{}}
    for backend,run in runs.items():
        cases=run['assessment']['cases'];scored=[]
        for case in cases:
            row={'id':case['id'],'group_id':case['group_id'],'terminal':case['terminal'],'category':case['category']}
            for arm in ARMS:
                canonical=case['model_canonical_correct'] if arm=='model' else case['arms'][arm]['canonical_correct']
                row[arm]=None if arm=='model' and case['terminal'] else bool(canonical and joined.get((backend,case['id'],arm),True))
            scored.append(row)
        slices={}
        for name,items in [('all',scored),('nonterminal',[c for c in scored if not c['terminal']]),('terminal',[c for c in scored if c['terminal']])]:
            groups=defaultdict(list)
            for c in items:groups[c['group_id']].append(c)
            slices[name]={'semantics':{a:metric(c[a] for c in items) for a in ARMS},'groups':{a:metric(None if any(c[a] is None for c in v) else all(c[a] for c in v) for v in groups.values() if len(v)==2) for a in ARMS},'singletons':sum(len(v)==1 for v in groups.values()),'gate_wins':sum(c['guarded'] and not c['ungated'] for c in items),'gate_losses':sum(not c['guarded'] and c['ungated'] for c in items)}
        actual=list(run['rows'].values());invoked=[r for r in actual if r.get('model_invoked')]
        usage=Counter()
        for r in invoked:
            for key,value in (r.get('usage') or {}).items():
                if type(value) is int:usage[key]+=value
        comparison['backends'][backend]={'assessment':run['assessment'],'semantic_slices':slices,'semantic_cases':scored,'provider_usage':dict(usage),'response_models':dict(Counter(r.get('response_model') for r in invoked if r.get('response_model'))),'max_mlx_peak_bytes':max((r.get('mlx_peak_bytes',0) for r in invoked),default=0) or None,'outcome':json.loads((ROOT/'results'/backend/'outcome.json').read_text())}
    q={c['id']:c for c in comparison['backends']['qwen']['semantic_cases']};d={c['id']:c for c in comparison['backends']['deepseek']['semantic_cases']}
    comparison['paired_nonterminal']={a:{'qwen_wins':sum(q[i][a] and not d[i][a] for i in q if not q[i]['terminal']),'deepseek_wins':sum(not q[i][a] and d[i][a] for i in q if not q[i]['terminal']),'ties':sum(q[i][a]==d[i][a] for i in q if not q[i]['terminal'])} for a in ARMS}
    return comparison

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--prepare-review',action='store_true');ap.add_argument('--check',action='store_true');args=ap.parse_args()
    if args.prepare_review:prepare()
    else:
        value=summarize();path=ROOT/'comparison.json'
        if args.check:require(json.loads(path.read_text())==value,'Comparison reproduction mismatch')
        else:common.save(path,value)
        print(json.dumps({b:{'nonterminal':r['semantic_slices']['nonterminal'],'canonical':r['assessment']['nonterminal']} for b,r in value['backends'].items()},ensure_ascii=False,indent=2))
