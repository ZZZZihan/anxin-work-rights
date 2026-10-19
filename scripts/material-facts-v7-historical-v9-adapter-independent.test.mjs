import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const E = 'experiments/material-facts-v7';
const STATE = 'ANXIN_MFV7_HISTORICAL_EXECUTION_V1';
const POLICY = 'cf6a04377e518064037cb3374591eb7747972f7259aa92ffa0f8440eefde7dea';
const plain = () => { const env = { ...process.env }; delete env[STATE]; delete env.NODE_OPTIONS; return env; };
for (const name of ['historical-v9-execution.mjs', 'historical-execution-policy-v1.mjs']) {
  const path = resolve(ROOT, E, name);
  console.log(JSON.stringify({ evidence: 'implementation_hash', path: `${E}/${name}`,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex') }));
}
async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'anxin independent v9 adapter '));
  try {
    const base = resolve(root, E); await mkdir(base, { recursive: true });
    for (const name of ['historical-v9-execution.mjs', 'historical-execution-policy-v1.mjs'])
      await cp(resolve(ROOT, E, name), resolve(base, name));
    return await action(root, base);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('an inherited nearly exhausted v9 budget actually terminates its native child and preserves the caller receipt', { timeout: 7000 }, async () => {
  await fixture(async (root, base) => {
    const script = resolve(base, 'corrective-assessment-v9.mjs');
    await writeFile(script, `console.log(JSON.stringify({pid:process.pid,state:JSON.parse(process.env.${STATE})}));setInterval(()=>{},1000);\n`);
    const receipt = resolve(root, 'caller-owned.jsonl'); await writeFile(receipt, '');
    const driver = resolve(root, 'driver.mjs');
    await writeFile(driver, `
import { existsSync, readFileSync } from 'node:fs';
import { runHistoricalV9CheckSync } from ${JSON.stringify(pathToFileURL(resolve(base, 'historical-v9-execution.mjs')).href)};
const started=Date.now();let result;
try { runHistoricalV9CheckSync(${JSON.stringify(script)},['--check'],{encoding:'utf8',timeout:1,stdio:'pipe'}); result={unexpected_success:true}; }
catch(error) {
  const child=JSON.parse(error.stdout);let child_alive=true;
  try { process.kill(child.pid,0); } catch(gone) { if(gone.code==='ESRCH')child_alive=false;else throw gone; }
  result={code:error.code,signal:error.signal,child,child_alive,elapsed_ms:Date.now()-started,
    receipt_exists:existsSync(${JSON.stringify(receipt)}),events:readFileSync(${JSON.stringify(receipt)},'utf8').trim().split('\\n').map(JSON.parse)};
}
console.log(JSON.stringify(result));
`);
    const now = Date.now(), state = { policy: 'material-facts-v7-historical-execution/1', policy_sha256: POLICY,
      started_ms: now - 100, root_deadline_ms: now + 2600, deadline_ms: now + 2600,
      depth: 3, receipt_path: receipt };
    const out = JSON.parse(execFileSync(process.execPath, [driver], { env: { ...plain(), [STATE]: JSON.stringify(state) },
      cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.equal(out.code, 'ETIMEDOUT'); assert.equal(out.signal, 'SIGTERM');
    assert.equal(out.child_alive, false); assert.equal(out.receipt_exists, true);
    assert(out.elapsed_ms >= 50 && out.elapsed_ms < 2000);
    assert.equal(out.child.state.started_ms, state.started_ms);
    assert.equal(out.child.state.root_deadline_ms, state.root_deadline_ms);
    assert.equal(out.child.state.deadline_ms, state.deadline_ms - 2000);
    assert.equal(out.child.state.depth, 4);
    assert(out.events.some(event => event.event === 'child_budget' && event.depth === 4 && event.requested_timeout_ms === 1));
    assert(out.events.some(event => event.event === 'preload_active' && event.depth === 4));
  });
});

test('the public v9 adapter rejects write and unrelated commands before their native sentinel can run', { timeout: 7000 }, async () => {
  await fixture(async (root, base) => {
    const sentinel = resolve(root, 'must-not-run.txt');
    for (const name of ['corrective-assessment-v9.mjs', 'run.mjs']) await writeFile(resolve(base, name),
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(sentinel)},'executed');\n`);
    const driver = resolve(root, 'rejection.mjs');
    await writeFile(driver, `
import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
import {runHistoricalV9CheckSync} from ${JSON.stringify(pathToFileURL(resolve(base, 'historical-v9-execution.mjs')).href)};
const before={...process.env};
for(const [name,args] of [['corrective-assessment-v9.mjs',['--write']],['run.mjs',['--check']],['corrective-assessment-v9.mjs',['--check','--write']]]) {
  assert.throws(()=>runHistoricalV9CheckSync(${JSON.stringify(base)}+'/'+name,args,{encoding:'utf8'}),/exact read-only/);
}
assert.deepEqual({...process.env},before);console.log(JSON.stringify({sentinel_exists:existsSync(${JSON.stringify(sentinel)}),commands_rejected:3}));
`);
    const out = JSON.parse(execFileSync(process.execPath, [driver], { env: plain(), cwd: root,
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.deepEqual(out, { sentinel_exists: false, commands_rejected: 3 });
  });
});
