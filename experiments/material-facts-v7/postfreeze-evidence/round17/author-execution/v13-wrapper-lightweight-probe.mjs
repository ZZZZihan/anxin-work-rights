// Reproducible author checks of the real wrapper plus a minimal owned fixture.
// No historical CLI, scoring, publication or model execution occurs here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT=resolve(process.env.V7_REVIEW_ROOT ?? fileURLToPath(new URL('../../../../', import.meta.url)));
const SOURCE=resolve(process.env.V7_ARCHIVE_SOURCE_ROOT ?? ROOT);
const E='experiments/material-facts-v7';
const {withCorrectionV13Code}=await import(pathToFileURL(resolve(ROOT,E,'verify-correction-v13.mjs')));
const manifestBytes=await readFile(resolve(SOURCE,E,'corrections-v13/manifest.json'));
const manifest=JSON.parse(manifestBytes);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const archiveManifest=await readFile(resolve(ROOT,E,'correction-code-v13/manifest.json'));
assert.equal(sha(manifestBytes),'7d65625d6dd48f1319eec1ca86066fcc4bfaeed0d5f23c7195157d5e7a3fc04c');
async function fixture(action){
  const root=await mkdtemp(resolve(tmpdir(),'anxin-v7-v13-wrapper-author-'));
  try{
    for(const path of ['lib','scripts','docs',`${E}/corrections-v13`])await mkdir(resolve(root,path),{recursive:true});
    await writeFile(resolve(root,'package.json'),'{}\n');
    await writeFile(resolve(root,E,'corrections-v13/manifest.json'),manifestBytes);
    await cp(resolve(ROOT,E,'correction-code-v13'),resolve(root,E,'correction-code-v13'),{recursive:true});
    return await action(root);
  }finally{await rm(root,{recursive:true,force:true});}
}
test('real v13 wrapper restores all58 snapshot hashes despite current source drift',async()=>fixture(async root=>{
  await writeFile(resolve(root,'lib/material-money-v4.ts'),'// synthetic current drift\n');
  let owned;
  const result=await withCorrectionV13Code(async temporary=>{
    owned=temporary;
    for(const [path,digest]of Object.entries(manifest.code_sha256))assert.equal(sha(await readFile(resolve(temporary,path))),digest,path);
    return 'restored58';
  },root);
  assert.equal(result,'restored58');
  await assert.rejects(readFile(resolve(owned,'package.json')),{code:'ENOENT'});
}));
test('real v13 wrapper cleans its restored tree and preserves callback error identity',async()=>fixture(async root=>{
  let owned;const expected=new Error('Synthetic author callback failure');
  await assert.rejects(withCorrectionV13Code(async temporary=>{owned=temporary;throw expected;},root),error=>error===expected);
  assert(owned);await assert.rejects(readFile(resolve(owned,'package.json')),{code:'ENOENT'});
}));
for(const change of ['missing','bytes','extra','manifest'])test(`real v13 wrapper refuses ${change} before callback`,async()=>fixture(async root=>{
  const target=resolve(root,E,'correction-code-v13/experiments/material-facts-v7/corrective-assessment-v13.mjs.snapshot');
  if(change==='missing')await rm(target);
  if(change==='bytes')await writeFile(target,Buffer.concat([await readFile(target),Buffer.from('\n// synthetic archive drift\n')]));
  if(change==='extra'){
    const extra=JSON.parse(archiveManifest);extra.files['scripts/unbound.mjs']='0'.repeat(64);
    await writeFile(resolve(root,E,'correction-code-v13/manifest.json'),JSON.stringify(extra)+'\n');
  }
  if(change==='manifest')await writeFile(resolve(root,E,'corrections-v13/manifest.json'),Buffer.concat([manifestBytes,Buffer.from('\n')]));
  let entered=false;
  await assert.rejects(withCorrectionV13Code(async()=>{entered=true;},root));
  assert.equal(entered,false);
}));
