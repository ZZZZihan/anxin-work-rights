import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.env.V7_REVIEW_ROOT);
const E='experiments/material-facts-v7';
const {withCorrectionV6Code}=await import(pathToFileURL(resolve(root,E,'verify-correction-v6.mjs')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const path=resolve(root,E,'corrections-v6/manifest.json'),before=await readFile(path);
assert.equal(sha(before),'0c9ef56e30e278c816e088a934df1cb8f0cdc944c262b9bd9f88be146909ee69');
await withCorrectionV6Code(async temporary=>{
  const target=resolve(temporary,E,'corrections-v6/manifest.json');
  const value=JSON.parse(before);
  const variants={whitespace:Buffer.concat([before,Buffer.from('\n')]),
    reordered:Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).reverse()),null,2)+'\n')};
  for(const [name,changed] of Object.entries(variants)) {
    assert.deepEqual(JSON.parse(changed),value);assert.notEqual(sha(changed),sha(before));
    await writeFile(target,changed);
    const output=execFileSync(process.execPath,[resolve(temporary,E,'corrective-assessment-v6.mjs'),'--check'],
      {cwd:temporary,encoding:'utf8',timeout:180000,maxBuffer:16*1024**2});
    const receipt=JSON.parse(output);assert.equal(receipt.status,'PASS');
    console.log(JSON.stringify({evidence:'actual_archived_v6_accepted_json_equivalent_manifest_rewrite',
      variant:name,original_sha256:sha(before),changed_sha256:sha(changed),actual_status:receipt.status,model_requests:receipt.model_requests}));
  }
},root);
assert.deepEqual(await readFile(path),before);
console.log(JSON.stringify({evidence:'live_v6_manifest_unchanged',sha256:sha(before)}));
