import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.MATERIAL_FACTS_V7_ENGINEERING_ROOT || fileURLToPath(new URL('../', import.meta.url)));
const helper = resolve(ROOT, 'experiments/material-facts-v7/immutable-artifact-publication.mjs');
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

async function fixture(t) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'anxin-r43-collision-'))), output = resolve(root, 'results/report.json');
  const children = [];
  t.after(async () => {
    for (const item of children) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL');
    await Promise.allSettled(children.map(item => item.closed));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(dirname(output)); await copyFile(helper, resolve(root, 'helper.mjs'));
  await writeFile(resolve(root, 'publish.mjs'), `
import { publishImmutableFile } from './helper.mjs';
try { console.log(JSON.stringify(await publishImmutableFile(process.argv[2], process.argv[3]))); }
catch(error) { console.error(JSON.stringify({code:error.code,message:error.message,temporary_removed:error.publication_temporary_removed})); process.exitCode=1; }
`);
  const cli = (bytes, preload) => {
    const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), resolve(root, 'publish.mjs'), output, bytes], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const closed = new Promise((resolveClose, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolveClose({ code, signal, stdout, stderr })); });
    const item = { child, closed }; children.push(item); return item;
  };
  return { root, output, cli };
}

async function waitFor(path, item) {
  const end = Date.now() + 7000;
  while (!await exists(path)) {
    if (item.child.exitCode !== null || item.child.signalCode !== null) assert.fail(`Publisher closed before native link barrier: ${JSON.stringify(await item.closed)}`);
    assert(Date.now() < end, `Timed out waiting for ${path}`); await delay(10);
  }
}

test('EEXIST on an already frozen report preserves both report bytes and the complete result-directory inventory', async t => {
  const f = await fixture(t), original = Buffer.from('original failed-or-successful immutable report\n');
  await writeFile(f.output, original); const before = await readdir(dirname(f.output));
  const result = await f.cli('replacement must not publish').closed;
  assert.equal(result.code, 1); assert.equal(result.signal, null); assert.equal(JSON.parse(result.stderr).code, 'EEXIST');
  assert.deepEqual(await readFile(f.output), original); assert.deepEqual(await readdir(dirname(f.output)), before);
});

test('two real publishers past absence checks have exactly one winner and the collision loser leaves no stage', async t => {
  const f = await fixture(t), release = resolve(f.root, 'release-links');
  const makeBarrier = async name => {
    const ready = resolve(f.root, name + '-ready'), preload = resolve(f.root, name + '-preload.mjs');
    await writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const native=fs.promises.link;
fs.promises.link=async(from,to)=>{
  await fs.promises.writeFile(${JSON.stringify(ready)},'stage-complete-before-link');
  const end=Date.now()+7000; while(!fs.existsSync(${JSON.stringify(release)})){if(Date.now()>end)throw new Error('Synthetic native-link barrier timeout');await delay(10);}
  return native(from,to);
};
syncBuiltinESMExports();
`);
    return { ready, preload };
  };
  const a = await makeBarrier('a'), b = await makeBarrier('b'), first = f.cli('payload A', a.preload), second = f.cli('payload B', b.preload);
  await Promise.all([waitFor(a.ready, first), waitFor(b.ready, second)]);
  assert.equal(await exists(f.output), false); assert.equal((await readdir(dirname(f.output))).filter(name => name.endsWith('.stage')).length, 2);
  await writeFile(release, 'continue'); const results = await Promise.all([first.closed, second.closed]);
  assert.deepEqual(results.map(row => row.code).sort(), [0, 1]);
  assert.equal(JSON.parse(results.find(row => row.code === 1).stderr).code, 'EEXIST');
  assert(['payload A', 'payload B'].includes(await readFile(f.output, 'utf8')));
  assert.deepEqual(await readdir(dirname(f.output)), ['report.json']);
});

test('a target symlink arriving after absence check is never followed and the losing complete stage is removed', async t => {
  const f = await fixture(t), victim = resolve(f.root, 'outside-original.json'), original = Buffer.from('external original bytes\n');
  await writeFile(victim, original); const preload = resolve(f.root, 'arriving-target-preload.mjs');
  await writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const native=fs.promises.link;
fs.promises.link=async(from,to)=>{ await fs.promises.symlink(${JSON.stringify(victim)},to); return native(from,to); };
syncBuiltinESMExports();
`);
  const result = await f.cli('must not overwrite external target', preload).closed;
  assert.equal(result.code, 1); assert.equal(JSON.parse(result.stderr).code, 'EEXIST');
  assert.equal((await lstat(f.output)).isSymbolicLink(), true); assert.deepEqual(await readFile(victim), original);
  assert.deepEqual(await readdir(dirname(f.output)), ['report.json']);
  assert.equal(await realpath(f.output), fileURLToPath(pathToFileURL(victim)));
});
