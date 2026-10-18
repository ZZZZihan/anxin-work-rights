import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const SCRIPT = resolve(process.env.OWNED_CLEANUP_CANCEL_SCRIPT ?? resolve(ROOT, 'scripts/material-facts-cancel-http-regression.mjs'));
const source = await readFile(SCRIPT, 'utf8');
const begin = source.indexOf('async function stopWorker()'), end = source.indexOf('\nasync function cleanup(', begin);
assert(begin >= 0 && end > begin);
const shared = source.includes("from './owned-http-process-group.mjs'");
const pause = ms => new Promise(done => setTimeout(done, ms));
const socketAlive = port => new Promise(done => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => { socket.destroy(); done(false); });
});
async function until(check) {
  for (let attempt = 0; attempt < 250; attempt++) { if (await check()) return; await pause(20); }
  assert.fail('Real child-process fixture did not reach its barrier.');
}
function liveMembers(pgid) {
  return execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8', timeout: 2000 }).trim().split('\n')
    .map(line => line.trim().split(/\s+/u)).filter(([, group, state]) => Number(group) === pgid && !/^[ZX]/iu.test(state));
}

for (const mode of ['redirected-ignore-term', 'launcher-exits']) test(`actual cancel stopWorker closes redirected descendant: ${mode}`, { skip: process.platform === 'win32', timeout: 25000 }, async t => {
  const temp = await mkdtemp(resolve(tmpdir(), 'anxin-cancel-owned-tree-'));
  let child, sibling;
  t.after(async () => {
    for (const owned of [child, sibling]) if (owned?.pid) {
      try { process.kill(-owned.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await rm(temp, { recursive: true, force: true });
  });
  await writeFile(resolve(temp, 'leaf.mjs'), `import {createServer} from 'node:net';import{writeFile}from'node:fs/promises';
process.on('SIGTERM',()=>{});const server=createServer(s=>s.end());server.listen(0,'127.0.0.1',async()=>{await writeFile(process.argv[2],JSON.stringify({pid:process.pid,port:server.address().port}));});\n`);
  await writeFile(resolve(temp, 'launcher.mjs'), `import{spawn}from'node:child_process';import{readFile}from'node:fs/promises';
spawn(process.execPath,[${JSON.stringify(resolve(temp, 'leaf.mjs'))},process.argv[2]],{stdio:'ignore'});
if(process.argv[3]==='launcher-exits'){while(true){try{await readFile(process.argv[2]);break;}catch{await new Promise(r=>setTimeout(r,10));}}process.exit(0);}\n`);
  const helper = pathToFileURL(resolve(ROOT, 'scripts/owned-http-process-group.mjs')).href;
  await writeFile(resolve(temp, 'actual-stop.mjs'), `import{spawn}from'node:child_process';
${shared ? `import{spawnOwnedChild,stopChild}from${JSON.stringify(helper)};` : ''}
let worker,workerClosed;const bounded=async(p,ms,message)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}};
${source.slice(begin, end)}
export function start(args){worker=${shared ? 'spawnOwnedChild' : 'spawn'}(process.execPath,args,{detached:true,stdio:['ignore','pipe','pipe']});worker.stdout.resume();worker.stderr.resume();workerClosed=new Promise(r=>worker.once('close',r));return worker;}
export{stopWorker};\n`);
  const api = await import(pathToFileURL(resolve(temp, 'actual-stop.mjs')));
  const record = resolve(temp, 'leaf.json'), otherRecord = resolve(temp, 'other.json');
  child = api.start([resolve(temp, 'launcher.mjs'), record, mode]);
  sibling = spawn(process.execPath, [resolve(temp, 'leaf.mjs'), otherRecord], { detached: true, stdio: 'ignore' });
  await until(async () => { try { await readFile(record); await readFile(otherRecord); return true; } catch { return false; } });
  const info = JSON.parse(await readFile(record)), other = JSON.parse(await readFile(otherRecord));
  assert.equal(await socketAlive(info.port), true);
  if (mode === 'launcher-exits') await until(() => child.exitCode !== null);
  await api.stopWorker();
  assert.equal(await socketAlive(info.port), false, 'stopWorker must not return while its redirected descendant owns a socket.');
  assert.deepEqual(liveMembers(child.pid), [], 'No non-zombie member may remain in the owned group.');
  assert.equal(await socketAlive(other.port), true, 'An unrelated detached group must remain running.');
  const rebound = createServer();
  try { await new Promise((done, reject) => { rebound.once('error', reject); rebound.listen(info.port, '127.0.0.1', done); }); }
  finally { await new Promise(done => rebound.close(done)); }
  await api.stopWorker();
});
