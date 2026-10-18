// Descriptive aggregation of the frozen scorer's reports; no model calls.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = fileURLToPath(new URL('./', import.meta.url));
const json = async p => JSON.parse(await readFile(resolve(base,p),'utf8'));
const lines = async p => { try { return (await readFile(resolve(base,p),'utf8')).split('\n').filter(Boolean).map(JSON.parse); } catch(e) { if(e.code==='ENOENT')return [];throw e; } };
const counts = values => values.reduce((o,x)=>(o[x]=(o[x]??0)+1,o),{});
const summary = { scope:'frozen_new_public_material_text_only', training:false, dev_documents:3, holdout_documents:8, holdout_facts:null, models:{} };
for (const backend of ['rules','qwen','deepseek']) {
  const prefix=`results/holdout-${backend}-1/`,report=await json(prefix+'report.json'),outcome=await json(prefix+'outcome.json');
  const rows=await lines(prefix+'results.jsonl'),events=await lines(prefix+'events.jsonl'),memory=await lines(prefix+'memory.jsonl');
  summary.holdout_facts ??= report.expected_facts;
  assert.equal(summary.holdout_facts,report.expected_facts);
  const value={ coverage_status:counts(report.cases.map(c=>c.coverage?.status??'unavailable')), normalization_status:counts(report.cases.flatMap(c=>c.normalization.map(n=>n.status))), planned:report.planned_documents,returned:report.returned,completed:report.completed,native_json:report.native_json,protocol_valid:report.protocol_valid,exact_documents:report.exact_documents,
    raw_candidates:report.raw_candidates,accepted_candidates:report.accepted_candidates,rejected_candidates:report.rejected_candidates,review_issues:report.review_issues,metrics:report.metrics,
    finish_reasons:counts(rows.map(r=>r.finish_reason)),focus_raw:counts(report.cases.flatMap(c=>c.focus_confusions.raw.flatMap(p=>p.errors))),focus_accepted:counts(report.cases.flatMap(c=>c.focus_confusions.accepted.flatMap(p=>p.errors))),
    ambiguous_focus_raw:report.cases.flatMap(c=>c.focus_confusions.raw).filter(p=>p.ambiguous).length,
    unique_attribute_mismatches:counts(report.cases.flatMap(c=>c.attribute_errors.flatMap(p=>p.mismatches))),ambiguous_attribute_pairs:report.cases.flatMap(c=>c.attribute_errors).filter(p=>p.ambiguous).length,
    rejection_reasons:counts(report.cases.flatMap(c=>c.rejected.map(r=>r.reason))),latency_sum_seconds:rows.reduce((n,r)=>n+(r.latency_seconds??0),0),process_seconds:(outcome.attempts??[]).reduce((n,r)=>n+(r.seconds??0),0),batch_completed:outcome.completed };
  if(backend==='qwen'){
    value.memory={pressure_levels:[...new Set(memory.map(m=>m.level))],samples:memory.length,swap_first_bytes:memory[0]?.swap_used_bytes??null,swap_max_bytes:memory.length?Math.max(...memory.map(m=>m.swap_used_bytes)):null,
      peak_mlx_gib:Math.max(0,...events.filter(e=>e.type==='phase_memory').map(e=>(e.mlx_peak_bytes??0)/1024**3),...rows.map(r=>r.peak_memory_gib??r.peak_memory_gb??0))};
  }
  if(backend==='deepseek'){
    const protocol=await json(prefix+'protocol.json');
    const t=await lines(prefix+'transport-attempts.jsonl');value.transport={route:protocol.deepseek.egress,connection_attempts:t.filter(t=>t.event==='transport_attempt').length,post_attempts:t.filter(t=>t.event==='send_started').length,ssh_closed:protocol.deepseek.egress==='direct'?null:(await json(prefix+'egress.json')).ssh_closed};
    value.usage=rows.reduce((n,r)=>({prompt_tokens:n.prompt_tokens+(r.usage?.prompt_tokens??0),completion_tokens:n.completion_tokens+(r.usage?.completion_tokens??0)}),{prompt_tokens:0,completion_tokens:0});
  }
  summary.models[backend]=value;
}
if(process.argv.includes('--check')) assert.deepEqual(await json('comparison.json'),summary);
else await writeFile(resolve(base,'comparison.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
