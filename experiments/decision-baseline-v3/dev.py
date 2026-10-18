"""Small public development fixtures, never counted as independent model tests."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

FIELDS=('period','agreed_due_total','wage_paid_total')

def make_record(identity='dev-complete', due='100.01', paid='0.00', status_due='confirmed', status_paid='confirmed', meaning_due='period_wage_total', state=None):
    period={'start':'2026-01-01','end':'2026-01-31'}
    def render(v):
        if v is None:return '未核实'
        if isinstance(v,list):return ' 与 '.join(render(x) for x in v)
        if isinstance(v,dict):return v['start']+' 至 '+v['end']
        return v+' 元'
    sources=[];events=[]
    for i,(field,value,status,meaning) in enumerate(zip(FIELDS,[period,due,paid],['confirmed',status_due,status_paid],['period',meaning_due,'period_wage_total'])):
        text=f'开发情境的受控记录：{field}，状态 {status}；值 {render(value)}。'
        source={'id':f's{i}','kind':'confirmation' if status=='confirmed' else 'evidence','text':text,'sha256':hashlib.sha256(text.encode()).hexdigest()}
        sources.append(source)
        events.append({'id':f'e{i}','field':field,'status':status,'value':value,'scope':None if i==0 else 'e0','meaning':meaning,'complete':True if i==0 or status=='confirmed' else False,'supersedes':None,'refs':[{'source_id':source['id'],'start':0,'end':len(text),'quote':text}]})
    return {'id':identity,'messages':[{'role':'user','content':'请根据已录入的期间和工资核实情况整理下一步。没有核实的金额不要猜。'}], 'tool_state':state,'fact_bundle':{'case_id':identity,'sources':sources,'events':events}}


def records():
    cases=[make_record(),make_record('dev-zero-due',due='0.00',paid='100.00'),
           make_record('dev-unknown-due',due=None,status_due='unknown'),
           make_record('dev-unknown-paid',paid=None,status_paid='unknown'),
           make_record('dev-monthly',due='5900.00',status_due='candidate',meaning_due='monthly_rate'),
           make_record('dev-conflict',due=['100.01','200.02'],status_due='conflict'),
           make_record('dev-both-unknown',due=None,paid=None,status_due='unknown',status_paid='unknown'),
           make_record('dev-known-after-timeout',state={'status':'TIMEOUT','attempts':1,'max_attempts':2}),
           make_record('dev-exhausted',state={'status':'TIMEOUT','attempts':2,'max_attempts':2}),
           make_record('dev-decimal',due='100.11',paid='30.06'),
           make_record('dev-unconfirmed-zero',due='0.00',status_due='candidate')]
    old=make_record('dev-period-revised')
    src=deepcopy(old['fact_bundle']['sources'][0]);src['id']='new-period-source';src['text']='受控确认的新期间 2026-02-01 至 2026-02-28';src['sha256']=hashlib.sha256(src['text'].encode()).hexdigest()
    ev=deepcopy(old['fact_bundle']['events'][0]);ev.update(id='new-period-event',supersedes='e0',value={'start':'2026-02-01','end':'2026-02-28'},refs=[{'source_id':src['id'],'start':0,'end':len(src['text']),'quote':src['text']}])
    old['fact_bundle']['sources'].append(src);old['fact_bundle']['events'].append(ev);cases.append(old)
    return cases

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('output',type=Path);args=ap.parse_args()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x') as f:
        for record in records():f.write(json.dumps(record,ensure_ascii=False)+'\n')
