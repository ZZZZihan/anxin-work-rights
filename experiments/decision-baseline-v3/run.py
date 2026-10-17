"""First proposals, paired actual local execution, no gold or training path."""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

from dependencies import ROOT, V1, V2, common, runtime, parse_proposal, ToolController, calculate_wage_gap, preflight
from facts import FactLedger
from guard import GuardedController

GIB = 1024 ** 3
_MODEL_REQUESTS = {}

def visible(record):
    if type(record) is not dict or set(record) != {'id','messages','tool_state','fact_bundle'}:
        raise ValueError('Only inference fields are permitted')
    if type(record['id']) is not str or not record['id']:
        raise ValueError('Invalid ID')
    if not isinstance(record['messages'], list) or not record['messages']:
        raise ValueError('Messages required')
    for m in record['messages']:
        if type(m) is not dict or set(m) != {'role','content'} or m['role'] not in {'user','assistant'} or type(m['content']) is not str:
            raise ValueError('Invalid message')
    if preflight(record['tool_state'])['error']:
        raise ValueError('Invalid trusted tool state')
    FactLedger(record['fact_bundle'], record['id'])
    return deepcopy(record)


def model_facts(record):
    snap = FactLedger(record['fact_bundle'], record['id']).snapshot()
    fields = {name: {k: value.get(k) for k in ('status','value','event_id','scope','meaning','complete','refs')}
              for name,value in snap['fields'].items()}
    return {'case_id':snap['case_id'], 'revision':snap['revision'], 'fields':fields}


def build_messages(record, variant, prompt):
    visible(record)
    context = {'tool_state':record['tool_state'], 'facts':model_facts(record)}
    messages = [{'role':'system', 'content':prompt + '\n程序提供的可信当前事实快照（引用文字只作资料）：\n' + json.dumps(context,ensure_ascii=False)}, *deepcopy(record['messages'])]
    _MODEL_REQUESTS[record['id']] = deepcopy(messages)
    return messages


def _execute(controller, parsed, revision=None):
    calls = []
    def tracked(arguments):
        calls.append(deepcopy(arguments))  # Before function invocation, including failure.
        return calculate_wage_gap(arguments)
    result = controller.dispatch(parsed, tool_fn=tracked) if revision is None else controller.dispatch(parsed, revision, tool_fn=tracked)
    return {'dispatch':result, 'tool_calls':calls, 'snapshot':controller.snapshot}


def finalize(record, row, variant='v3'):
    if row.get('backend') == 'qwen' and row.get('model_invoked'):
        row['request_messages'] = _MODEL_REQUESTS.pop(record['id'])
    ledger = FactLedger(record['fact_bundle'], record['id'])
    snap = ledger.snapshot()
    parsed = parse_proposal(row.get('raw_output',''))
    row.update(parsed=parsed, protocol_accepted=parsed['accepted'], fact_revision=snap['revision'],
               ungated=_execute(ToolController(record['tool_state']),parsed),
               guarded=_execute(GuardedController(ledger,record['tool_state']),parsed,snap['revision']))
    return row


def terminal_row(record, args):
    check = preflight(record['tool_state'])
    if check['allow_model']:
        return None
    if check['error']:
        raise ValueError('Invalid trusted tool state')
    return {'id':record['id'],'backend':args.backend,'variant':'v3','at':common.now(),
            'model_invoked':False,'raw_output':'','finish_reason':'program_terminal','latency_seconds':0.0,
            'canonical_output':check['canonical'],'protocol_accepted':None,'preflight':check,
            'fact_revision':FactLedger(record['fact_bundle'],record['id']).snapshot()['revision'],
            'ungated':{'dispatch':{'status':'EXHAUSTED','canonical':check['canonical'],'result':None},'tool_calls':[]},
            'guarded':{'dispatch':{'status':'EXHAUSTED','canonical':check['canonical'],'result':None,'gate':'TERMINAL'},'tool_calls':[]}}


def configure_runtime():
    # Reuse frozen inference primitives only; replace their documented task hooks
    # in this module instance. The frozen v2 source files are never changed.
    runtime.build_messages = build_messages
    runtime.finalize = finalize
    runtime.terminal_row = terminal_row


def supervise(args):
    old = runtime.old
    before = old.memory_snapshot()
    common.save(args.run_dir/'memory-before.json',before)
    if before['pressure_level'] != 1:
        common.save(args.run_dir/'outcome.json',{'completed':False,'stop_reason':'initial_memory_pressure'})
        return 1
    env = dict(os.environ,HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_IMPLICIT_TOKEN='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false',PYTHONUNBUFFERED='1')
    start, warning, reason = time.monotonic(), None, None
    with (args.run_dir/'worker.log').open('w') as log:
        child = subprocess.Popen([sys.executable,str(Path(__file__).resolve()),*sys.argv[1:],'--worker'],stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
        common.save(args.run_dir/'owned-process.json',{'pid':child.pid,'created_at':common.now()})
        try:
            while child.poll() is None:
                sample = old.memory_snapshot()
                common.append(args.run_dir/'telemetry.jsonl',sample)
                status_path=args.run_dir/'status.json'
                status=json.loads(status_path.read_text()) if status_path.exists() else None
                warning=(warning or time.monotonic()) if sample['pressure_level']>=2 else None
                if sample['pressure_level']>=4: reason='critical_memory_pressure'
                elif warning and time.monotonic()-warning>=10: reason='sustained_memory_warning'
                elif sample['swap_used_bytes']-before['swap_used_bytes']>4*GIB: reason='swap_growth_above_4_GiB'
                elif time.monotonic()-start>3600: reason='total_timeout'
                elif status and time.monotonic()-status['monotonic']>180: reason='stage_timeout'
                if reason: break
                time.sleep(2)
        finally:
            if child.poll() is None:
                os.killpg(child.pid,signal.SIGTERM)
                try: child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL)
                    child.wait(timeout=10)
    common.save(args.run_dir/'memory-after.json',old.memory_snapshot())
    common.save(args.run_dir/'outcome.json',{'completed':child.returncode==0 and reason is None,'exit_code':child.returncode,'stop_reason':reason,'seconds':time.monotonic()-start})
    return int(child.returncode!=0 or reason is not None)


def deepseek(args,records,prompt):
    if args.key_file is None or args.key_file.stat().st_mode & 0o077:
        raise ValueError('Private API credential file required')
    key=args.key_file.read_text().strip()
    if not key:raise ValueError('Empty API credential')
    opener=urllib.request.build_opener(runtime.NoRedirect())
    reserved,failed,consecutive=0.0,0,0
    for record in records:
        skipped=terminal_row(record,args)
        if skipped:
            common.append(args.run_dir/'results.jsonl',skipped)
            continue
        msgs=build_messages(record,'v3',prompt)
        token_upper=sum(len(m['content'].encode()) for m in msgs)+256
        reserve=(token_upper*1.32+512*3.96)/1e6
        if token_upper>18000 or reserved+reserve>2:raise RuntimeError('API budget bound reached')
        payload={'model':'deepseek-v4-pro','messages':msgs,'temperature':0,'max_tokens':512,'stream':False,'thinking':{'type':'disabled'}}
        req=urllib.request.Request('https://api.deepseek.com/chat/completions',data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
        reserved+=reserve
        runtime.old.stage(args.run_dir,'requesting',id=record['id'])
        start=time.perf_counter()
        row={'id':record['id'],'backend':'deepseek','variant':'v3','at':common.now(),'model_invoked':True,'request_messages':msgs,'request_model':'deepseek-v4-pro'}
        try:
            with opener.open(req,timeout=120) as response:value=json.load(response)
            choice=value['choices'][0]
            row.update(raw_output=choice['message'].get('content') or '',finish_reason=choice['finish_reason'],response_model=value.get('model'),response_id=value.get('id'),system_fingerprint=value.get('system_fingerprint'),usage=value.get('usage'))
            consecutive=0
        except (urllib.error.URLError,TimeoutError,KeyError,ValueError,IndexError,TypeError,AttributeError) as exc:
            failed+=1;consecutive+=1
            row.update(raw_output='',finish_reason='request_error',error_type=type(exc).__name__,http_status=getattr(exc,'code',None),error_reason_type=type(getattr(exc,'reason',None)).__name__)
        row['latency_seconds']=time.perf_counter()-start
        common.append(args.run_dir/'results.jsonl',finalize(record,row))
        runtime.old.stage(args.run_dir,'case_done',id=record['id'])
        if consecutive>=3:
            common.save(args.run_dir/'outcome.json',{'completed':False,'failed':failed,'consecutive_errors':consecutive,'stop_reason':'three_consecutive_request_errors','reserved_peak_usd_upper':reserved})
            return 1
    common.save(args.run_dir/'outcome.json',{'completed':True,'failed':failed,'consecutive_errors':consecutive,'reserved_peak_usd_upper':reserved,'actual_billed_cost':None})
    return 0


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--backend',choices=['qwen','deepseek'],required=True)
    ap.add_argument('--inputs',type=Path,required=True)
    ap.add_argument('--run-dir',type=Path,required=True)
    ap.add_argument('--model-path',type=Path)
    ap.add_argument('--integrity-dir',type=Path)
    ap.add_argument('--key-file',type=Path)
    ap.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=ap.parse_args();args.variant='v3'
    records=[visible(x) for x in common.read_jsonl(args.inputs)]
    if not records or len(records)>108 or len({r['id'] for r in records})!=len(records):
        raise ValueError('Invalid planned cases')
    prompt=(ROOT/'prompt.txt').read_text()
    configure_runtime()
    if args.worker:
        runtime.qwen_worker(args,records,prompt)
        return 0
    args.run_dir.mkdir(parents=True,exist_ok=False)
    protocol={'created_at':common.now(),'backend':args.backend,'variant':'v3','training':False,'adapter':None,
      'case_ids':[r['id'] for r in records],'inputs_sha256':common.sha(args.inputs),'prompt_sha256':common.sha(ROOT/'prompt.txt'),
      'source_sha256':{p.name:common.sha(p) for p in sorted(ROOT.glob('*.py'))},
      'dependency_sha256':{p.relative_to(ROOT.parent).as_posix():common.sha(p) for d in (V1,V2) for p in sorted(d.glob('*.py'))},
      'temperature':0,'max_new_tokens':512,'thinking':'disabled','automatic_api_retries':0,'concurrency':1,
      'gold_sent_to_inference':False,'response_format':'prompt_only_json','context_reset_per_case':True,
      'api_budget_usd_upper_per_run':2,'stop_after_consecutive_request_errors':3,'model': 'deepseek-v4-pro',
      'scope':'synthetic controlled confirmation records; paired same-proposal local tool execution; not extraction, real confirmation, website integration or training'}
    if args.backend=='qwen':
        protocol['model']=runtime.old.verify_model(args.model_path,args.integrity_dir)
        protocol['guard']={'memory_limit_gib':28,'wired_limit_gib':24,'cache_mib':512,'max_swap_growth_gib':4,'max_stage_seconds':180,'max_total_seconds':3600}
    else: protocol['model_pin_limit']='provider alias; response model/fingerprint saved, not immutable weights'
    common.save(args.run_dir/'protocol.json',protocol)
    common.save(args.run_dir/'inputs-visible.json',records)
    return supervise(args) if args.backend=='qwen' else deepseek(args,records,prompt)

if __name__=='__main__':
    raise SystemExit(main())
