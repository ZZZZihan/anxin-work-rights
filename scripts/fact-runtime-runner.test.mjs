import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const runner = new URL('../experiments/material-facts-v4-replication-20261017/run.mjs', import.meta.url).href;
const fixture = String.raw`
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import assert from 'node:assert/strict';
const [runner, scenario] = process.argv.slice(1);
const files = new Map(), signals = [], inputs = [{ id:'first', source:{} }, { id:'interrupted', source:{} }];
const child = new EventEmitter();
child.stdout = new PassThrough(); child.stderr = new PassThrough();
child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
const emit = row => child.stdout.write(JSON.stringify(row) + '\n');
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms === 180_000 ? 30 : ms, ...args);
child.stdin.on('finish', () => setImmediate(() => {
  emit({type:'requesting', id:'first'});
  emit({type:'result',id:'first',raw_output:'{"candidates":[]}',finish_reason:'stop'});
  emit({type:'requesting',id:'interrupted'});
  if (scenario === 'cancel') realTimeout(() => process.emit('SIGTERM'), 10);
}));
child.kill = signal => {
  signals.push(signal);
  realTimeout(() => {
    emit({type:'result',id:'interrupted',raw_output:'{"candidates":[]}',finish_reason:'stop'});
    child.emit('exit',0,null);
    realTimeout(() => child.emit('close',0,null), 10);
  }, 5);
  return true;
};
globalThis.boundaryFixture = {
  io: {
    readFile: async path => Buffer.from(String(path).endsWith('inputs.jsonl') ? inputs.map(r=>JSON.stringify(r)).join('\n')+'\n' : 'source'),
    mkdir: async()=>{},
    writeFile: async(path, data)=>files.set(path,Buffer.from(data)),
    appendFile: async(path,data)=>files.set(path,Buffer.concat([files.get(path)??Buffer.alloc(0),Buffer.from(data)])),
  },
  workers: { spawn:()=>child, execFile:()=>{} },
};
const mocks = {
  'node:fs/promises':'export const {readFile,mkdir,writeFile,appendFile}=globalThis.boundaryFixture.io;',
  'node:child_process':'export const {spawn,execFile}=globalThis.boundaryFixture.workers;',
  '../../lib/material-facts.ts':'export const buildExtractionMessages=()=>[];export const extractRuleCandidates=()=>"{}";',
};
registerHooks({resolve(specifier,context,next){
  if(context.parentURL===runner&&mocks[specifier])return {url:'data:text/javascript,'+encodeURIComponent(mocks[specifier]),shortCircuit:true};
  return next(specifier,context);
}});
process.argv=[process.execPath,runner,'--backend','deepseek','--out','/virtual/out','--inputs','/virtual/inputs.jsonl','--key-file','/virtual/key'];
await import(runner);
assert.equal(process.exitCode,1);
assert.deepEqual(signals,['SIGTERM']);
const rows=files.get('/virtual/out/results.jsonl').toString().trim().split('\n').map(JSON.parse);
assert.equal(rows.length,2);
assert.equal(rows[0].finish_reason,'stop');
assert.equal(rows[1].original_finish_reason,'stop');
assert.equal(rows[1].finish_reason,scenario==='cancel'?'parent_cancel':'absolute_request_timeout');
assert.equal(JSON.parse(files.get('/virtual/out/outcome.json')).completed,false);
assert.equal(process.listenerCount('SIGTERM'),0);
process.exitCode=0;
console.log('PASS');
`;

for (const scenario of ['deadline', 'cancel']) {
  test(`API runner preserves earlier response and rejects late success after ${scenario}`, async () => {
    const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', fixture, runner, scenario], { timeout: 10_000 });
    assert.match(stdout, /PASS/);
  });
}
