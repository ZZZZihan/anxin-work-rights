import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const SCRIPT = resolve(process.env.V7_HTTP_REGRESSION_MODULE ?? resolve(ROOT, 'scripts/material-facts-v7-http-regression.mjs'));
const code = await readFile(SCRIPT, 'utf8');
const sharedLifecycle = code.includes("from './owned-http-process-group.mjs'");
const sharedUrl = pathToFileURL(resolve(ROOT, 'scripts/owned-http-process-group.mjs')).href;
const begin = code.indexOf('// BEGIN OWNED HTTP CHILD LIFECYCLE');
const end = code.indexOf('// END OWNED HTTP CHILD LIFECYCLE');
let implementation;
if (sharedLifecycle) implementation = `import {spawnOwnedChild,stopChild} from ${JSON.stringify(sharedUrl)};`;
else if (begin >= 0 && end > begin) implementation = code.slice(begin, end);
else {
  const start = code.indexOf('async function stopChild('), stop = code.indexOf('\nasync function startWorker(', start);
  assert(start >= 0 && stop > start, 'Locate original production shutdown for the real red baseline.');
  implementation = code.slice(start, stop) + '\nconst spawnOwnedChild=(command,args,options={})=>spawn(command,args,{...options,stdio:"ignore"});\n';
}
const wait = ms => new Promise(done => setTimeout(done, ms));
async function liveGroupMembers(pgid) {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8', timeout: 2000 }).trim().split('\n')
    .map(line => line.trim().split(/\s+/u)).filter(([, group, state]) => Number(group) === pgid && !/^[ZX]/iu.test(state));
}
async function until(action) {
  for (let i = 0; i < 250; i++) { if (await action()) return; await wait(20); }
  assert.fail('Synthetic process did not reach the requested barrier.');
}
async function publishRecord(record, info, write = writeFile) {
  const staged = `${record}.${process.pid}.tmp`;
  await write(staged, JSON.stringify(info), { flag: 'wx' });
  await rename(staged, record);
}
async function readyRecord(record, child) {
  let info;
  await until(async () => {
    try { info = JSON.parse(await readFile(record, 'utf8')); return true; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Synthetic child exited before publishing its ready record (exit=${child.exitCode}, signal=${child.signalCode}).`);
      }
      return false;
    }
  });
  return info;
}
const portAlive = port => new Promise(done => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => { socket.destroy(); done(false); });
});
async function fixture(t, mode = 'default') {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-http-tree-'));
  const childRecords = [];
  t.after(async () => {
    for (const path of childRecords) {
      try { const info = JSON.parse(await readFile(path)); try { process.kill(info.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(resolve(root, 'implementation.mjs'), `import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const wait=ms=>new Promise(done=>setTimeout(done,ms));
async function bounded(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}}
${implementation}
export {spawnOwnedChild,stopChild};\n`);
  await writeFile(resolve(root, 'leaf.mjs'), `import {createServer} from 'node:net';import{writeFile,rename}from'node:fs/promises';
${publishRecord.toString()}
const server=createServer(socket=>socket.end());server.listen(0,'127.0.0.1',async()=>{await publishRecord(process.argv[2],{pid:process.pid,port:server.address().port});});
if(process.argv[3]?.endsWith('ignore-term'))process.on('SIGTERM',()=>{});\n`);
  await writeFile(resolve(root, 'launcher.mjs'), `import{spawn}from'node:child_process';import{readFile}from'node:fs/promises';
spawn(process.execPath,[${JSON.stringify(resolve(root, 'leaf.mjs'))},process.argv[2],process.argv[3]],{stdio:process.argv[3]==='redirected-ignore-term'?'ignore':'inherit'});
if(process.argv[3]==='launcher-exits'){while(true){try{JSON.parse(await readFile(process.argv[2],'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(done=>setTimeout(done,10));}}process.exit(0);}\n`);
  const api = await import(pathToFileURL(resolve(root, 'implementation.mjs')).href);
  const record = resolve(root, 'leaf.json'); childRecords.push(record);
  const child = api.spawnOwnedChild(process.execPath, [resolve(root, 'launcher.mjs'), record, mode], { cwd: root });
  child.once('error', () => {});
  t.after(async () => { try { await api.stopChild(child, 'Synthetic launcher'); } catch { child.kill('SIGKILL'); } });
  const info = await readyRecord(record, child);
  assert.equal(await portAlive(info.port), true);
  return { root, api, child, info, childRecords };
}

console.log(JSON.stringify({ evidence: 'production_http_lifecycle_under_test', sha256: createHash('sha256').update(code).digest('hex') }));
for (const mode of ['default', 'ignore-term', 'redirected-ignore-term', 'launcher-exits']) test('stop owned HTTP launcher and listening descendant: ' + mode, { skip: process.platform === 'win32', timeout: 25000 }, async t => {
  const f = await fixture(t, mode);
  if (mode === 'launcher-exits') await until(() => f.child.exitCode !== null);
  await f.api.stopChild(f.child, 'Synthetic Worker');
  assert.deepEqual(await liveGroupMembers(f.child.pid), [], 'The owned POSIX group has no remaining non-zombie member.');
  assert.equal(await portAlive(f.info.port), false, 'A workerd-like descendant must not retain its socket after stopChild returns.');
  const port = f.info.port;
  const server = createServer();
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); }); }
  finally { await new Promise(done => server.close(done)); }
  // A completed close remains safe if the outer HTTP cleanup repeats it.
  await f.api.stopChild(f.child, 'Synthetic Worker');
});

test('shutdown only signals its own detached process group', { skip: process.platform === 'win32', timeout: 25000 }, async t => {
  const f = await fixture(t);
  const record = resolve(f.root, 'unrelated-leaf.json'); f.childRecords.push(record);
  const sibling = spawn(process.execPath, [resolve(f.root, 'leaf.mjs'), record, 'default'], { detached: true, stdio: 'ignore' });
  t.after(() => { if (sibling.exitCode === null && sibling.signalCode === null) sibling.kill('SIGKILL'); });
  const info = await readyRecord(record, sibling);
  await f.api.stopChild(f.child, 'Synthetic Worker');
  assert.deepEqual(await liveGroupMembers(f.child.pid), [], 'The owned POSIX group has no remaining non-zombie member.');
  assert.equal(await portAlive(f.info.port), false);
  assert.equal(await portAlive(info.port), true, 'Stopping the test Worker must preserve an unrelated process/socket.');
});

for (const partial of ['', '{"pid":']) test('ready marker is not published during ' + (partial ? 'partial' : 'empty') + ' JSON write', { timeout: 5000 }, async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-ready-record-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = resolve(root, 'ready.json'), info = { pid: process.pid, port: 12345 };
  let release, reached;
  const paused = new Promise(done => { reached = done; });
  const resume = new Promise(done => { release = done; });
  const writing = publishRecord(record, info, async (path, contents, options) => {
    await writeFile(path, partial, options);
    reached(path);
    await resume;
    await writeFile(path, contents);
  });
  const staged = await paused;
  try {
    assert.equal(await readFile(staged, 'utf8'), partial, 'The real filesystem write is paused before JSON is complete.');
    await assert.rejects(readFile(record), { code: 'ENOENT' }, 'Existence must mean that the complete record has been published.');
  } finally { release(); await writing; }
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), info);
  await assert.rejects(readFile(staged), { code: 'ENOENT' });
});

test('ready record preserves malformed JSON failures', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-ready-record-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = resolve(root, 'ready.json');
  await writeFile(record, '{"pid":');
  await assert.rejects(readyRecord(record, { exitCode: null, signalCode: null }), SyntaxError);
});

test('ready record reports a real child exit before publication', { timeout: 5000 }, async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'anxin-v7-ready-record-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['-e', 'process.exit(17)'], { stdio: 'ignore' });
  await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  await assert.rejects(readyRecord(resolve(root, 'ready.json'), child), /exited before publishing.*exit=17/);
});
