import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Real subprocess/file-system publication and fault injection. The production
// createFreeze body is copied verbatim; unrelated readiness/model/data gates are
// explicit synthetic stubs. This is not a real freeze or model acceptance run.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENGINE = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || ROOT);
const E = 'experiments/material-facts-v7';
const source = await readFile(resolve(ENGINE, E, 'freeze.mjs'), 'utf8');
const start = source.indexOf('export async function createFreeze(');
const end = source.indexOf('\nif (await isMainModule', start);
assert(start >= 0 && end > start, 'Locate the complete production createFreeze body');
const createFreeze = source.slice(start, end);
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const write = async (root, name, bytes) => { const path = resolve(root, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); };

async function waitFor(path, child) {
  const deadline = Date.now() + 5000;
  while (!await exists(path)) {
    if (child.process.exitCode !== null) assert.fail(`Child exited before I/O barrier: ${JSON.stringify(await child.closed)}`);
    assert(Date.now() < deadline, 'Timed out waiting for the injected I/O barrier'); await delay(10);
  }
}

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-freeze-publication-')), children = [];
  t.after(async () => {
    for (const child of children) if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
    await Promise.all(children.map(child => child.closed)); await rm(root, { recursive: true, force: true });
  });
  await mkdir(resolve(root, E), { recursive: true });
  await copyFile(resolve(ENGINE, E, 'experiment-lock.mjs'), resolve(root, E, 'experiment-lock.mjs'));
  for (const [name, bytes] of Object.entries({
    'SOURCE_REVIEW.md': 'synthetic review\n', 'REVIEW.md': 'synthetic review\n', 'DEVELOPMENT.md': 'synthetic review\n',
    'technical-review.json': '{"status":"passed_independent_pre_run_technical_review","blocking_findings":[],"reviewed_sha256":{}}',
    'benchmark-review.independent.json': '{"status":"passed_independent_pre_run_benchmark_review","blocking_findings":[],"reviewed_sha256":{}}',
    'data/dev.inputs.jsonl': '{"id":"synthetic-dev"}\n', 'data/holdout.inputs.jsonl': '{"id":"synthetic-holdout"}\n',
    'review-evidence/receipt.json': '{"synthetic":true}\n', 'fixture-required.txt': 'synthetic required bytes\n',
    'results/dev-prior-failure/protocol.json': '{"synthetic":true}\n', 'results/dev-prior-failure/results.jsonl': '{"raw_output":"keep original failure"}\n',
    'results/dev-prior-failure/outcome.json': '{"completed":false}\n',
  })) await write(root, `${E}/${name}`, bytes);
  await write(root, `${E}/fixture-freeze.mjs`, `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withExperimentLock } from './experiment-lock.mjs';
const ROOT=${JSON.stringify(root)}, EXPERIMENT=${JSON.stringify(E)}, REQUIRED_FILES=[EXPERIMENT+'/fixture-required.txt'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const safePath=(root,path)=>resolve(root,path), json=async path=>JSON.parse(await readFile(path,'utf8'));
const inputs=[{id:'synthetic-case'}];
const validateData=async()=>({sets:{dev:{inputs},holdout:{inputs}},summary:{synthetic_fixture:true}});
const verifyLegacy=()=>({status:'SYNTHETIC_STUB'}), loadPolicy=async()=>({deepseek:{egress:'direct',reserved_upper_usd:2}});
const validateDevelopment=async()=>({synthetic_fixture:true}), messageBytes=async()=>JSON.stringify({messages:[]})+'\\n';
const deepseekReservation=()=>0, priorDeepseekReservation=async()=>0, validateQwenIdentity=async()=>({synthetic_fixture:true});
const checkFileHashes=async()=>{};
async function filesUnder(root,path) { const files=[];for(const entry of await readdir(resolve(root,path),{withFileTypes:true})) {
  if(entry.isDirectory()) files.push(...await filesUnder(root,path+'/'+entry.name));else files.push(path+'/'+entry.name);
}return files; }
${createFreeze}
`);
  // Patch native filesystem methods before the unchanged production function is
  // imported. Inject actual short writes / errors, never a fake assertion result.
  await write(root, 'faults.mjs', `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const root=${JSON.stringify(root)}, directory=root+'/${E}', final=directory+'/freeze.json', mode=process.env.FREEZE_FAULT;
const native={open:fs.promises.open.bind(fs.promises),write:fs.promises.writeFile.bind(fs.promises),link:fs.promises.link.bind(fs.promises),unlink:fs.promises.unlink.bind(fs.promises)};
const trace=(op,detail={})=>fs.appendFileSync(root+'/io-trace.jsonl',JSON.stringify({op,...detail})+'\\n');
const fault=(code,message)=>Object.assign(new Error(message),{code});
const isTemp=path=>String(path).startsWith(directory+'/.freeze-')&&String(path).endsWith('.tmp');
const isReceipt=path=>String(path).startsWith(directory+'/.freeze-')&&String(path).endsWith('.failure.json');
async function injectedWrite(path,bytes,writer) {
 const b=Buffer.from(bytes),cut=Math.max(1,Math.floor(b.length/2));
 if(['partial','receipt-fails','pause','kill'].includes(mode)) {
   await writer(b.subarray(0,cut));trace('partial-write',{path:String(path),bytes:cut,lock:fs.existsSync(directory+'/.experiment.lock')});
   if(mode==='partial'||mode==='receipt-fails') throw fault('ENOSPC','synthetic original partial write failure');
   fs.writeFileSync(root+'/write-paused','ready');const deadline=Date.now()+5000;
   while(!fs.existsSync(root+'/release-write')){if(Date.now()>deadline)throw new Error('I/O barrier timeout');await delay(10);}
   await writer(b.subarray(cut));
 } else await writer(b);
 trace('write-complete',{path:String(path),bytes:b.length});
}
fs.promises.writeFile=async(path,bytes,options)=>{
 if(['receipt-fails','unlink-receipt-fails'].includes(mode)&&isReceipt(path))throw fault('EACCES','synthetic failure receipt write failure');
 if(String(path)===final) return injectedWrite(path,bytes,chunk=>native.write(path,chunk,options));
 return native.write(path,bytes,options);
};
fs.promises.open=async(path,...args)=>{
 const handle=await native.open(path,...args);if(!isTemp(path))return handle;
 trace('open-temp',{path:String(path),flags:args[0]});let closeFault=false;
 return new Proxy(handle,{get(target,key){
  if(key==='writeFile')return bytes=>injectedWrite(path,bytes,chunk=>target.writeFile(chunk));
  if(key==='sync')return async()=>{trace('sync-temp');if(mode==='sync')throw fault('EIO','synthetic sync failure');return target.sync();};
  if(key==='close')return async()=>{trace('close-temp');await target.close();if(mode==='close'&&!closeFault){closeFault=true;throw fault('EIO','synthetic close failure');}};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
};
fs.promises.link=async(from,to)=>{
 trace('publish-link',{from:String(from),to:String(to),lock:fs.existsSync(directory+'/.experiment.lock')});
 if(mode==='publish')throw fault('EIO','synthetic link publication failure');
 if(mode==='race')await native.write(to,'prior external immutable freeze\\n',{flag:'wx'});
 return native.link(from,to);
};
fs.promises.unlink=async path=>{if(['unlink','unlink-receipt-fails'].includes(mode)&&isTemp(path))throw fault('EIO','synthetic published-temp cleanup failure');return native.unlink(path);};
syncBuiltinESMExports();
`);
  await write(root, 'child.mjs', `
import { createFreeze } from './${E}/fixture-freeze.mjs';
function describe(error){return {name:error.name,code:error.code,message:error.message,errors:error.errors?.map(describe),cause:error.cause?describe(error.cause):undefined};}
try {const freeze=await createFreeze(${JSON.stringify(root)});console.log(JSON.stringify({status:'FROZEN',freeze}));}
catch(error){console.error(JSON.stringify({status:'FAIL',error:describe(error)}));process.exitCode=1;}
`);
  const child = (mode = 'none') => {
    const process = spawn(globalThis.process.execPath, ['--import', resolve(root, 'faults.mjs'), resolve(root, 'child.mjs')], {
      cwd: root, env: { ...globalThis.process.env, FREEZE_FAULT: mode }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    process.stdout.on('data', bytes => { stdout += bytes; }); process.stderr.on('data', bytes => { stderr += bytes; });
    const closed = new Promise((resolveClose, reject) => { process.once('error', reject); process.once('close', (code, signal) => resolveClose({ code, signal, stdout, stderr })); });
    const record = { process, closed }; children.push(record); return record;
  };
  const paths = async suffix => (await readdir(resolve(root, E))).filter(name => name.startsWith('.freeze-') && name.endsWith(suffix)).map(name => resolve(root, E, name));
  return { root, child, paths, final: resolve(root, E, 'freeze.json'), lock: resolve(root, E, '.experiment.lock'), trace: async () => {
    try { return (await readFile(resolve(root, 'io-trace.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  } };
}

test('freeze publishes complete synced bytes by exclusive link, then removes its successful temporary file', async t => {
  const f = await fixture(t), result = await f.child().closed; assert.equal(result.code, 0, result.stderr);
  const bytes = await readFile(f.final, 'utf8'), output = JSON.parse(result.stdout); assert.equal(bytes, JSON.stringify(output.freeze, null, 2) + '\n');
  const trace = await f.trace(); assert.deepEqual(trace.map(row => row.op), ['open-temp', 'write-complete', 'sync-temp', 'close-temp', 'publish-link']);
  assert.equal(trace[0].flags, 'wx'); assert.equal(trace.at(-1).lock, true);
  assert.deepEqual(await f.paths('.tmp'), []); assert.deepEqual(await f.paths('.failure.json'), []); assert.equal(await exists(f.lock), false);
});

for (const mode of ['partial', 'sync', 'close', 'publish']) test(`failed ${mode} never creates freeze.json and retains its temporary bytes and failure receipt`, async t => {
  const f = await fixture(t), original = await readFile(resolve(f.root, E, 'results/dev-prior-failure/results.jsonl'));
  const failed = await f.child(mode).closed; assert.equal(failed.code, 1); assert.equal(await exists(f.final), false);
  const temps = await f.paths('.tmp'), receipts = await f.paths('.failure.json'); assert.equal(temps.length, 1); assert.equal(receipts.length, 1);
  assert((await readFile(temps[0])).length > 0); const receipt = JSON.parse(await readFile(receipts[0], 'utf8'));
  assert.equal(receipt.published, false); assert.match(JSON.stringify(receipt), /synthetic/); assert.equal(await exists(f.lock), false);
  if (mode === 'partial') { const partial = await readFile(temps[0], 'utf8'); assert.throws(() => JSON.parse(partial)); }
  assert.deepEqual(await readFile(resolve(f.root, E, 'results/dev-prior-failure/results.jsonl')), original);
  const retry = await f.child().closed; assert.equal(retry.code, 0, retry.stderr);
  assert.deepEqual(await f.paths('.tmp'), temps); assert.deepEqual(await f.paths('.failure.json'), receipts);
});

test('preexisting freeze is preserved byte for byte without allocating publication artifacts', async t => {
  const f = await fixture(t), bytes = 'original immutable freeze\n'; await writeFile(f.final, bytes);
  const result = await f.child().closed; assert.equal(result.code, 1); assert.match(result.stderr, /already exists/);
  assert.equal(await readFile(f.final, 'utf8'), bytes); assert.deepEqual(await f.paths('.tmp'), []); assert.equal(await exists(f.lock), false);
});

test('a destination appearing immediately before publication is never overwritten', async t => {
  const f = await fixture(t), result = await f.child('race').closed; assert.equal(result.code, 1); assert.match(result.stderr, /EEXIST/);
  assert.equal(await readFile(f.final, 'utf8'), 'prior external immutable freeze\n'); assert.equal((await f.paths('.tmp')).length, 1);
  const receipts = await f.paths('.failure.json'); assert.equal(receipts.length, 1); assert.equal(JSON.parse(await readFile(receipts[0], 'utf8')).published, false);
});

test('the shared lock covers an invisible partial write through native publication', async t => {
  const f = await fixture(t), owner = f.child('pause'); await waitFor(resolve(f.root, 'write-paused'), owner);
  assert.equal(await exists(f.final), false); const temps = await f.paths('.tmp'); assert.equal(temps.length, 1);
  const partial = await readFile(temps[0], 'utf8'); assert.throws(() => JSON.parse(partial));
  const contender = await f.child().closed; assert.equal(contender.code, 1); assert.match(contender.stderr, /EEXIST/);
  await writeFile(resolve(f.root, 'release-write'), 'release'); const published = await owner.closed; assert.equal(published.code, 0, published.stderr);
  assert.equal(JSON.parse(await readFile(f.final, 'utf8')).schema, 'material-facts-v7-freeze/1'); assert.equal(await exists(f.lock), false);
});

test('a killed partial writer leaves no pseudo-freeze and preserves its temporary bytes and owner lock', async t => {
  const f = await fixture(t), owner = f.child('kill'); await waitFor(resolve(f.root, 'write-paused'), owner);
  assert.equal(await exists(f.final), false); const temps = await f.paths('.tmp'); assert.equal(temps.length, 1);
  const before = await readFile(temps[0]), ownership = await readFile(resolve(f.lock, 'owner.json'));
  owner.process.kill('SIGKILL'); assert.equal((await owner.closed).signal, 'SIGKILL');
  assert.deepEqual(await readFile(temps[0]), before); assert.deepEqual(await readFile(resolve(f.lock, 'owner.json')), ownership);
  const blocked = await f.child().closed; assert.equal(blocked.code, 1); assert.match(blocked.stderr, /EEXIST/);
  // No failure receipt can be written after SIGKILL; the partial temp plus lock
  // are the recovery evidence. The implementation must never reap them by age.
  assert.deepEqual(await f.paths('.failure.json'), []);
});

test('failure-record errors do not replace the original partial-write failure', async t => {
  const f = await fixture(t), failed = await f.child('receipt-fails').closed;
  assert.equal(failed.code, 1); assert.equal(await exists(f.final), false); assert.equal((await f.paths('.tmp')).length, 1);
  assert.match(failed.stderr, /synthetic original partial write failure/); assert.match(failed.stderr, /synthetic failure receipt write failure/);
  assert.equal(await exists(f.lock), false);
});

test('post-publication cleanup failure retains valid immutable freeze plus an explicit published failure receipt', async t => {
  const f = await fixture(t), result = await f.child('unlink').closed; assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stderr).status, 'FROZEN_CLEANUP_WARNING'); assert.equal(JSON.parse(result.stderr).published, true);
  assert.equal(JSON.parse(await readFile(f.final, 'utf8')).schema, 'material-facts-v7-freeze/1');
  assert.deepEqual(JSON.parse(await readFile(f.final, 'utf8')), JSON.parse(result.stdout).freeze);
  const temps = await f.paths('.tmp'), receipts = await f.paths('.failure.json'); assert.equal(temps.length, 1); assert.equal(receipts.length, 1);
  assert.deepEqual(await readFile(temps[0]), await readFile(f.final)); assert.equal(JSON.parse(await readFile(receipts[0], 'utf8')).published, true);
  const bytes = await readFile(f.final); assert.equal((await f.child().closed).code, 1); assert.deepEqual(await readFile(f.final), bytes);
});

test('an already published freeze stays committed when both cleanup and its receipt write fail; warnings retain both failures', async t => {
  const f = await fixture(t), result = await f.child('unlink-receipt-fails').closed; assert.equal(result.code, 0, result.stderr);
  const warning = JSON.parse(result.stderr); assert.equal(warning.status, 'FROZEN_CLEANUP_WARNING'); assert.equal(warning.published, true);
  assert.equal(warning.receipt_written, false); assert.match(result.stderr, /published-temp cleanup failure/); assert.match(result.stderr, /failure receipt write failure/);
  const temps = await f.paths('.tmp'); assert.equal(temps.length, 1); assert.deepEqual(await readFile(temps[0]), await readFile(f.final));
  assert.deepEqual(await f.paths('.failure.json'), []); assert.equal(await exists(f.lock), false);
});
