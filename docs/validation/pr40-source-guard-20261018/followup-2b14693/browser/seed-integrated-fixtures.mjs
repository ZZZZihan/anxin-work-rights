import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd();
const v2=await import(pathToFileURL(resolve(root,'lib/material-facts-v2.ts')));
const v3=await import(pathToFileURL(resolve(root,'lib/material-facts-v3.ts')));
const f=JSON.parse(await readFile('/tmp/anxin-cases-ui-isolation.json','utf8'));
assert.equal(f.isolated,true);assert.ok(f.databasePath.includes('/anxin-cases-ui-'));
const knowledgeResponse=await fetch(`${f.base}/api/knowledge?query=${encodeURIComponent('工资')}`,{headers:{'oai-authenticated-user-id':f.owner,'oai-authenticated-user-email':'owner@synthetic.test'}});assert.equal(knowledgeResponse.status,200);const knowledge=await knowledgeResponse.json();
const db=new DatabaseSync(f.databasePath),at=new Date().toISOString();
const source=(name,texts)=>({id:randomUUID(),name,sha256:createHash('sha256').update(texts.join('\n')).digest('hex'),analysisRevision:1,ready:true,blocks:texts.map((text,i)=>({id:`b${i+1}`,page:1,text,bbox:null,confidence:null}))});
const legacy=source('合成v2非空漏提材料.txt',['王甲2024年7月完整应付工资8000元。李乙2024年8月完整应付工资9000元。']);
const rate=source('合成非总额归属核对材料.txt',['王甲2024年7月信息待核。','李乙2024年8月月薪8000元。']);
const base={kind:'money',value:'8000元',quote:'8000元',blockId:'b1',subject:'王甲',scope:'individual',meaning:'due_total',completeness:'complete',period:'2024年7月',rateUnit:null,assertion:'narrated'};
try {
  for(const source of [legacy,rate]) {
    db.prepare('INSERT INTO evidence_files(id,user_id,case_id,name,category,size,mime_type,status,note,object_key,uploaded_at,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(source.id,f.owner,f.caseId,source.name,'其他材料',123,'text/plain','uploaded','隔离浏览器回归合成资料',`synthetic/${source.id}`,at,source.sha256);
    const result={source:{evidenceId:source.id,name:source.name,sha256:source.sha256,mimeType:'text/plain'},engine:{ocr:'synthetic-ui-fixture',structuring:'ocr_rules',model:null},pageCount:1,blocks:source.blocks,fields:[],warnings:[],knowledge};
    db.prepare('INSERT INTO evidence_analyses(evidence_id,user_id,content_hash,document_kind,status,revision,run_id,job_id,result_json,error,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(source.id,f.owner,source.sha256,'other','ready',1,randomUUID(),null,JSON.stringify(result),null,at,at);
  }
  const generation=db.prepare('SELECT generation FROM case_material_generations WHERE case_id=? AND user_id=?').get(f.caseId,f.owner).generation;
  const legacyRaw=JSON.stringify({schemaVersion:2,candidates:[base]});
  let state=v2.ingestCandidates(v3.emptyFactState(generation),legacy,v2.validateCandidateOutput(legacyRaw,legacy),'synthetic-v2',f.owner,at);
  const rateRaw=JSON.stringify({schemaVersion:3,candidates:[{...base,blockId:'b2',meaning:'rate',completeness:'not_applicable',rateUnit:'month'}]});
  state=v3.ingestCandidates(state,rate,{raw:rateRaw},'synthetic-v3',f.owner,at);
  assert.equal(state.materials.length,2);for(const material of state.materials){assert.equal(material.candidates.length,1);assert.equal(material.rejected.length,0);}
  db.prepare('INSERT INTO case_material_facts(case_id,user_id,revision,state_json,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(case_id) DO UPDATE SET revision=revision+1,state_json=excluded.state_json,updated_at=excluded.updated_at').run(f.caseId,f.owner,JSON.stringify(state),at);
  const response=await fetch(`${f.base}/api/cases/${f.caseId}/facts`,{headers:{'oai-authenticated-user-id':f.owner,'oai-authenticated-user-email':'owner@synthetic.test'}});assert.equal(response.status,200);const body=await response.json();
  const storedLegacy=body.state.materials.find(m=>m.evidenceId===legacy.id);assert.equal(storedLegacy.schemaVersion,2);assert.equal(storedLegacy.raw,legacyRaw);assert.equal(storedLegacy.sourceCoverage.status,'possible_missing');assert.ok(storedLegacy.sourceCoverage.signals.some(s=>s.text==='9000元'&&!s.covered));
  const candidate=body.candidates.find(c=>c.evidenceId===rate.id);assert.equal(candidate.representation.meaning,'rate');assert.equal(candidate.value,'8000元');assert.ok(candidate.reviewIssues.some(i=>i.code==='source_relation_unresolved'));assert.equal(body.state.confirmations.due,null);assert.equal(body.state.confirmations.paid,null);assert.equal(body.canCalculate,false);
  const persisted=JSON.parse(db.prepare('SELECT state_json FROM case_material_facts WHERE case_id=? AND user_id=?').get(f.caseId,f.owner).state_json);assert.ok(persisted.materials.every(m=>!Object.hasOwn(m,'sourceCoverage')));
  await writeFile('/tmp/anxin-integrated-ui-fixtures.json',JSON.stringify({caseId:f.caseId,legacySourceId:legacy.id,rateSourceId:rate.id,generation,apiAssertions:'PASS',legacySchema:storedLegacy.schemaVersion,omittedSignal:'9000元',nonTotalWarning:'source_relation_unresolved',canCalculate:body.canCalculate}),{mode:0o600});
  console.log('integrated Panel synthetic fixtures and HTTP assertions PASS');
} finally {db.close();}
