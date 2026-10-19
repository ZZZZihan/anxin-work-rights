import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Source-extracted native lifecycle probes, not whole HTTP/application tests.
// All processes, ports and paths below are synthetic and owned by this test.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const HELPER_ROOT = resolve(process.env.V7_OWNED_HELPER_ROOT ?? ROOT);
const sha = text => createHash('sha256').update(text).digest('hex');
const runners = ['cancel', 'poll'];
const socketOpen = port => new Promise(done => {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => { socket.destroy(); done(false); });
});
async function record(path) {
  for (let i = 0; i < 500; i++) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { await delay(10); } }
  throw new Error('Owned native fixture did not become ready.');
}
const leaf = `import{createServer}from'node:net';import{writeFile}from'node:fs/promises';
process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});
const server=createServer(socket=>socket.end());server.listen(0,'127.0.0.1',async()=>{await writeFile(process.argv[2],JSON.stringify({pid:process.pid,port:server.address().port}));});`;
const launcher = `import{spawn}from'node:child_process';spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:'ignore'});setInterval(()=>{},1000);`;
function extracted(source) {
  const abortStart = source.indexOf('const shutdown = new AbortController();');
  const timingStart = abortStart >= 0 ? abortStart : source.indexOf('const wait = ');
  const timingEnd = source.indexOf('const listen = ', timingStart);
  assert(timingStart >= 0 && timingEnd > timingStart, 'Use actual wait/bounded declarations.');
  const timing = (abortStart < 0 ? 'const shutdown = new AbortController();\n' : '') + source.slice(timingStart, timingEnd);
  const stop = source.match(/async function stopWorker\([^]*?\n\}/u)?.[0];
  assert(stop, 'Use the actual stopWorker function.');
  const handlerStart = source.indexOf('// These are CLI entry points.');
  const handlerEnd = handlerStart < 0 ? -1 : source.indexOf('\ntry {', handlerStart);
  const handler = handlerStart < 0 ? '' : source.slice(handlerStart, handlerEnd);
  if (handlerStart >= 0) {
    assert(handlerEnd > handlerStart);
    assert(handler.includes("process.on('SIGINT'") && handler.includes("process.on('SIGTERM'"));
    assert(source.includes("shutdown.signal.throwIfAborted();"), 'The real CLI checks interruption before starting work.');
    assert(source.includes('AbortSignal.any([shutdown.signal,'), 'Actual HTTP requests participate in the same shutdown signal.');
  }
  return { timing, stop, handler, hasHandler: handlerStart >= 0 };
}

for (const runner of runners) for (const signal of ['SIGINT', 'SIGTERM'])
  test(`${runner}: ${signal} twice reaches actual interrupt/finally cleanup and releases a redirected live descendant`,
    { skip: process.platform === 'win32', timeout: 20000 }, async t => {
      const sourcePath = resolve(ROOT, `scripts/material-facts-${runner}-http-regression.mjs`);
      const source = await readFile(sourcePath, 'utf8'), parts = extracted(source);
      const helperPath = resolve(HELPER_ROOT, 'scripts/owned-http-process-group.mjs');
      const directory = await mkdtemp(resolve(tmpdir(), 'anxin-round18-independent-'));
      t.after(() => rm(directory, { recursive: true, force: true }));
      await writeFile(resolve(directory, 'leaf.mjs'), leaf);
      await writeFile(resolve(directory, 'launcher.mjs'), launcher);
      const harness = `import{spawnOwnedChild,signalOwnedChild,stopChild}from${JSON.stringify(pathToFileURL(helperPath).href)};
import{writeFile,readFile}from'node:fs/promises';import{setTimeout as delay}from'node:timers/promises';import{resolve}from'node:path';
const dir=process.argv[2];let worker,migrationChild,failure,interruption,phase='synthetic_pending_request',releases=0;const cleanupFailures=[];
const errorRecord=e=>({name:e.name,message:e.message});const releaseHeldPoll=()=>{releases++;};const releaseHeldPolls=releaseHeldPoll;
${parts.timing}
${parts.stop}
${parts.handler}
worker=spawnOwnedChild(process.execPath,[resolve(dir,'launcher.mjs'),resolve(dir,'leaf.mjs'),resolve(dir,'owned-leaf.json')]);
for(let i=0;i<500;i++){try{await readFile(resolve(dir,'owned-leaf.json'));break;}catch{await delay(10);}}
await writeFile(resolve(dir,'runner-ready.json'),JSON.stringify({pid:process.pid,worker:worker.pid}));
try{await bounded(new Promise(()=>{}),30000,'Synthetic pending request deadline',shutdown.signal);}
catch(error){failure??={phase,...errorRecord(error)};}
finally{try{await stopWorker();}catch(error){cleanupFailures.push(errorRecord(error));}
await writeFile(resolve(dir,'finally-result.json'),JSON.stringify({failure,releases,cleanupFailures,aborted:shutdown.signal.aborted}));}
`;
      await writeFile(resolve(directory, 'harness.mjs'), harness);
      const sibling = spawn(process.execPath, [resolve(directory, 'leaf.mjs'), resolve(directory, 'sibling.json')], { stdio: 'ignore', detached: true });
      const child = spawn(process.execPath, [resolve(directory, 'harness.mjs'), directory], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      const closed = once(child, 'close');
      let ready, descendant;
      try {
        [ready, descendant] = await Promise.all([record(resolve(directory, 'runner-ready.json')), record(resolve(directory, 'owned-leaf.json'))]);
        const unrelated = await record(resolve(directory, 'sibling.json'));
        assert.equal(await socketOpen(descendant.port), true);
        child.kill(signal); await delay(50);
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        let timeout;
        const [code, exitSignal] = await Promise.race([closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Interrupted owned harness exceeded 13 seconds.')), 13000); })]).finally(() => clearTimeout(timeout));
        let final = null;
        try { final = JSON.parse(await readFile(resolve(directory, 'finally-result.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const open = await socketOpen(descendant.port), unrelatedOpen = await socketOpen(unrelated.port);
        let rebound = false;
        if (!open) { const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen(descendant.port, '127.0.0.1', done); }); await new Promise(done => server.close(done)); rebound = true; }
        console.log(JSON.stringify({ evidence: 'round18_extracted_native_interrupt', runner, signal, source_sha256: sha(source), helper_sha256: sha(await readFile(helperPath)), has_handler: parts.hasHandler,
          code, exitSignal, finally: final, socketOpen: open, unrelatedOpen, rebound, stdout, stderr }));
        assert.equal(open, false, 'The real owned descendant must stop listening before successful completion.');
        assert.equal(unrelatedOpen, true, 'An unrelated group is never signalled.');
        assert.equal(rebound, true); assert.equal(code, 1); assert.equal(exitSignal, null);
        assert(final, 'The actual extracted handler must reach finally.');
        assert.equal(final.aborted, true); assert.equal(final.releases, 1, 'Repeated signals remain idempotent.');
        assert.deepEqual(final.cleanupFailures, []); assert.equal(final.failure.phase, 'synthetic_pending_request');
        assert.equal(stdout, ''); assert.equal(stderr, '');
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        for (const pid of [ready?.worker, sibling.pid]) if (pid) {
          try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (!['ESRCH', 'EPERM'].includes(error.code)) throw error; }
        }
        await closed;
        if (sibling.exitCode === null && sibling.signalCode === null) await once(sibling, 'close');
      }
    });
