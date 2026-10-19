import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Only synthetic native processes/sockets are started. No Worker, model,
// credentials, application state or frozen experiment result is accessed.
const ROOT = resolve(process.env.V7_REVIEW_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const PYTHON = process.env.V7_TEST_PYTHON ?? 'python3';
const run = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runners = [
  ['v7', 'material-facts-v7-http-regression.mjs'],
  ['cancel', 'material-facts-cancel-http-regression.mjs'],
  ['poll', 'material-facts-poll-http-regression.mjs'],
  ['recovery', 'material-facts-recovery-http-regression.mjs'],
];
const boundedSource = `async function bounded(promise,ms,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}}`;
const declaration = (source, name) => {
  const match = source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`));
  assert(match, `Find the actual ${name} function without rewriting its body.`);
  return match[0];
};

async function adapter(name, filename) {
  const path = resolve(ROOT, 'scripts', filename), source = await readFile(path, 'utf8');
  console.log(JSON.stringify({ evidence: 'round14_runner_bytes', runner: name, sha256: sha(source) }));
  const common = `import assert from 'node:assert/strict';import{spawn}from'node:child_process';const wait=ms=>new Promise(done=>setTimeout(done,ms));${boundedSource}\n`;
  const helperImport = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/owned-http-process-group\.mjs['"];?/u);
  if (helperImport) {
    assert(source.includes('spawnOwnedChild('), `${name} must actually use owned spawning.`);
    const header = `import{${helperImport[1]}}from${JSON.stringify(pathToFileURL(resolve(ROOT, 'scripts/owned-http-process-group.mjs')).href)};\n`;
    if (name === 'v7' || name === 'recovery') {
      // These two runners call the imported API directly. Do not import the
      // HTTP script itself: its top level would launch application services.
      assert(source.includes('await stopChild('), `${name} must actually call owned shutdown.`);
      return common + header + 'export const start=spawnOwnedChild;export const stop=stopChild;\n';
    }
    const stop = declaration(source, 'stopWorker');
    return common + header + `let worker,workerClosed;function start(...args){worker=spawnOwnedChild(...args);workerClosed=new Promise(done=>worker.once('close',done));return worker;}\n${stop}\nexport{start};export const stop=async child=>{assert.equal(child,worker??child);await stopWorker();};\n`;
  }
  if (name === 'v7') {
    const begin = source.indexOf('// BEGIN OWNED HTTP CHILD LIFECYCLE');
    const end = source.indexOf('// END OWNED HTTP CHILD LIFECYCLE');
    assert(begin >= 0 && end > begin);
    return common + source.slice(begin, end) + '\nexport const start=spawnOwnedChild;export const stop=stopChild;\n';
  }
  const stop = declaration(source, name === 'recovery' ? 'stopChild' : 'stopWorker');
  // Keep the legacy runner's actual detachment/stdio policy; adding detachment
  // to poll/recovery here would hide their original integration behavior.
  const detached = name === 'cancel' ? "process.platform!=='win32'" : 'false';
  const stdio = name === 'cancel' ? "['ignore','pipe','pipe']" : "'ignore'";
  return common + `let worker,workerClosed;function start(command,args,options={}){worker=spawn(command,args,{...options,detached:${detached},stdio:${stdio}});worker.stdout?.resume();worker.stderr?.resume();workerClosed=new Promise(done=>worker.once('close',done));return worker;}\n${stop}\nexport{start};export const stop=${name === 'recovery' ? 'stopChild' : 'async child=>{assert.equal(child,worker??child);await stopWorker();}'};\n`;
}

const leafSource = `import{createServer}from'node:net';import{writeFile}from'node:fs/promises';
process.on('SIGTERM',()=>{});
const server=createServer(socket=>socket.end());server.listen(0,'127.0.0.1',async()=>{await writeFile(process.argv[2],JSON.stringify({pid:process.pid,port:server.address().port}));});\n`;
const launcherSource = `import{spawn}from'node:child_process';
spawn(process.execPath,[process.argv[2],process.argv[3]],{stdio:'ignore'});setInterval(()=>{},1000);\n`;
const exerciseSource = `import{readFile,writeFile}from'node:fs/promises';import{spawn,execFileSync}from'node:child_process';import{connect,createServer}from'node:net';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
const dir=process.argv[2],api=await import(pathToFileURL(resolve(dir,'adapter.mjs'))),wait=ms=>new Promise(done=>setTimeout(done,ms));
const record=resolve(dir,'leaf.json'),siblingRecord=resolve(dir,'sibling.json');
const alive=port=>new Promise(done=>{const s=connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();done(true);});s.once('error',()=>{s.destroy();done(false);});});
async function readRecord(path){for(let n=0;n<300;n++){try{return JSON.parse(await readFile(path));}catch{await wait(10);}}throw new Error('Owned fixture readiness timeout');}
async function state(pid){try{const s=await readFile('/proc/'+pid+'/stat','utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[0];}catch{return null;}}
const child=api.start(process.execPath,[resolve(dir,'launcher.mjs'),resolve(dir,'leaf.mjs'),record],{cwd:dir});child.once('error',()=>{});
const sibling=spawn(process.execPath,[resolve(dir,'leaf.mjs'),siblingRecord],{detached:process.platform!=='win32',stdio:'ignore'});sibling.once('error',()=>{});
await writeFile(resolve(dir,'ownership.json'),JSON.stringify({launcher:child.pid,sibling:sibling.pid,exercise:process.pid}));
let result;
try{const leaf=await readRecord(record),other=await readRecord(siblingRecord);await writeFile(resolve(dir,'known-leaves.json'),JSON.stringify([leaf,other]));
const before=await alive(leaf.port);let stopError=null,repeatError=null;const started=Date.now();
try{await api.stop(child,'Independent synthetic Worker');}catch(error){stopError={name:error.name,message:error.message};}
const stopMs=Date.now()-started,leafState=await state(leaf.pid);let killZero=false,killZeroError=null;try{process.kill(-child.pid,0);killZero=true;}catch(error){killZeroError={code:error.code,message:error.message};if(!['ESRCH','EPERM'].includes(error.code))throw error;}
const socketOpen=await alive(leaf.port),siblingOpen=await alive(other.port);let rebound=false;
if(!socketOpen){const server=createServer();try{await new Promise((done,reject)=>{server.once('error',reject);server.listen(leaf.port,'127.0.0.1',done);});rebound=true;}finally{await new Promise(done=>server.close(done));}}
try{await api.stop(child,'Repeated independent cleanup');}catch(error){repeatError={name:error.name,message:error.message};}
result={before,stopError,repeatError,stopMs,leafState,killZero,killZeroError,socketOpen,siblingOpen,rebound,leaf,other};
}catch(error){result={fixtureError:{name:error.name,message:error.message}};}
finally{for(const owned of[child,sibling]){if(owned.exitCode===null&&owned.signalCode===null){const closed=new Promise(done=>owned.once('close',done));owned.kill('SIGKILL');await closed;}}}
await writeFile(resolve(dir,'result.json'),JSON.stringify(result));\n`;

// A process-local Linux subreaper makes a genuine Z-state deterministic and
// recoverable. It never changes PID1 or the host. In normal mode it reaps
// adopted children promptly; hold-zombie deliberately defers that until the
// Node exercise returns, then reaps everything in finally.
const supervisorSource = `import ctypes,json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);node=sys.argv[2];hold=sys.argv[3]=='hold-zombie'
if sys.platform.startswith('linux'):
 lib=ctypes.CDLL(None,use_errno=True)
 if lib.prctl(36,1,0,0,0)!=0:raise OSError(ctypes.get_errno(),'PR_SET_CHILD_SUBREAPER')
stderr=open(root/'native-stderr.txt','w')
p=subprocess.Popen([node,str(root/'exercise.mjs'),str(root)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=stderr,start_new_session=True)
deadline=time.monotonic()+28;status=None;reaped=[];failure=None
try:
 while status is None:
  if time.monotonic()>deadline:raise TimeoutError('Owned synthetic exercise exceeded its native deadline')
  if hold:
   pid,s=os.waitpid(p.pid,os.WNOHANG)
   if pid:status=s
  else:
   while True:
    try:pid,s=os.waitpid(-1,os.WNOHANG)
    except ChildProcessError:break
    if not pid:break
    reaped.append(pid)
    if pid==p.pid:status=s
  time.sleep(.01)
 p.returncode=os.waitstatus_to_exitcode(status)
 if p.returncode!=0:raise RuntimeError('Synthetic node exit '+str(p.returncode))
 result=json.loads((root/'result.json').read_text())
except BaseException as error:
 failure=type(error).__name__+': '+str(error);result={}
finally:
 # Every PID below is either our direct child or was written by our fixture.
 # Verify the unique fixture path before signalling any recorded non-child.
 targets={p.pid}
 for name in ['ownership.json','known-leaves.json','leaf.json','sibling.json']:
  try:
   d=json.loads((root/name).read_text())
   if isinstance(d,list):targets.update(v['pid']for v in d)
   elif name=='ownership.json':targets.update(d.values())
   else:targets.add(d['pid'])
  except (FileNotFoundError,KeyError,json.JSONDecodeError):pass
 if sys.platform.startswith('linux'):
  try:targets.update(map(int,pathlib.Path('/proc/'+str(os.getpid())+'/task/'+str(os.getpid())+'/children').read_text().split()))
  except FileNotFoundError:pass
 for pid in targets:
  if pid==os.getpid():continue
  try:
   command=subprocess.run(['ps','-p',str(pid),'-o','command='],text=True,capture_output=True,timeout=1).stdout
   if str(root) in command:os.kill(pid,signal.SIGKILL)
  except ProcessLookupError:pass
 until=time.monotonic()+3
 while time.monotonic()<until:
  try:pid,s=os.waitpid(-1,os.WNOHANG)
  except ChildProcessError:break
  if pid:reaped.append(pid)
  else:time.sleep(.01)
 stderr.close()
remaining=[]
if sys.platform.startswith('linux'):
 try:remaining=list(map(int,pathlib.Path('/proc/'+str(os.getpid())+'/task/'+str(os.getpid())+'/children').read_text().split()))
 except FileNotFoundError:pass
print(json.dumps({'observation':result,'failure':failure,'reaped_owned_pids':reaped,'remaining_owned_children':remaining,'kernel':sys.platform,'held_zombies':hold}))
`;

async function fixture(t, runner, filename, mode, extraSource = '') {
  const directory = await mkdtemp(resolve(tmpdir(), 'anxin-r14-independent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [file, code] of [['adapter.mjs', (await adapter(runner, filename)) + extraSource], ['leaf.mjs', leafSource], ['launcher.mjs', launcherSource], ['exercise.mjs', extraSource ? exerciseSource.replace('const stopMs=Date.now()-started,leafState=', 'await wait(200);const stopMs=Date.now()-started,leafState=') : exerciseSource], ['supervisor.py', supervisorSource]]) await writeFile(resolve(directory, file), code);
  const { stdout, stderr } = await run(PYTHON, [resolve(directory, 'supervisor.py'), directory, process.execPath, mode], { timeout: 35000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  console.log(JSON.stringify({ evidence: 'round14_native_process_observation', runner, mode, ...result }));
  assert.equal(stderr, ''); assert.equal(result.failure, null, JSON.stringify(result));
  assert.deepEqual(result.remaining_owned_children, [], 'The supervisor must reap every owned adopted child, including held zombies.');
  assert.equal(result.observation.fixtureError, undefined, JSON.stringify(result));
  return result.observation;
}

for (const [runner, filename] of runners) test(`${runner}: stop releases a redirected TERM-ignoring descendant socket, preserves an unrelated group and is idempotent`, { skip: process.platform === 'win32', timeout: 40000 }, async t => {
  const result = await fixture(t, runner, filename, 'reap');
  assert.equal(result.before, true);
  assert.equal(result.stopError, null, JSON.stringify(result));
  assert.equal(result.socketOpen, false, 'A successful stop must not leave the real descendant listening.');
  assert.equal(result.rebound, true, 'A new owner must be able to bind the released socket.');
  assert.equal(result.siblingOpen, true, 'An unrelated detached process must stay alive.');
  assert.equal(result.repeatError, null, 'Repeated stop is idempotent.');
});

test('v7: a real retained Linux zombie makes kill(-pgid,0) succeed but must not make completed cleanup fail', { skip: process.platform !== 'linux', timeout: 40000 }, async t => {
  const [runner, filename] = runners[0];
  const result = await fixture(t, runner, filename, 'hold-zombie');
  assert.equal(result.leafState, 'Z', 'This is a kernel zombie, not a mocked ps row.');
  assert.equal(result.killZero, true, 'The original group probe actually reports the zombie-only group as existing.');
  assert.equal(result.socketOpen, false); assert.equal(result.rebound, true);
  assert.equal(result.siblingOpen, true);
  assert.equal(result.stopError, null, 'No live process/resource remains; a zombie is not a cleanup failure.');
  assert.equal(result.repeatError, null);
});

const helperPath = resolve(ROOT, 'scripts/owned-http-process-group.mjs');
let hasHelper = true;
try { await readFile(helperPath); } catch (error) { if (error.code === 'ENOENT') hasHelper = false; else throw error; }
const processTableProbe = mode => `
import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';
const nativeExec=cp.execFile;
cp.execFile=function(file,args,options,callback){
 if(file!=='/bin/ps')return nativeExec(file,args,options,callback);
 if(${JSON.stringify(mode)}==='pgid-zero')return nativeExec(file,args,options,(error,stdout,...rest)=>callback(error,'1 0 S\\n'+stdout,...rest));
 queueMicrotask(()=>callback(${mode === 'failure' ? "new Error('Synthetic process-table query failure')" : 'null'},${JSON.stringify(mode === 'malformed' ? 'not-a-process-row\n' : '')}));
 return{kill(){return true;}};
};syncBuiltinESMExports();\n`;

test('shared helper accepts an unrelated valid pgid=0 row while stopping real live descendants', { skip: !hasHelper || process.platform === 'win32', timeout: 40000 }, async t => {
  const result = await fixture(t, ...runners[0], 'reap', processTableProbe('pgid-zero'));
  assert.equal(result.stopError, null); assert.equal(result.socketOpen, false);
  assert.equal(result.rebound, true); assert.equal(result.siblingOpen, true);
  assert.equal(result.repeatError, null);
});

for (const mode of ['empty', 'malformed', 'failure']) test(`shared helper: ${mode} process-table inspection fails closed and still kills the owned live socket`, { skip: !hasHelper || process.platform === 'win32', timeout: 40000 }, async t => {
  const result = await fixture(t, ...runners[0], 'reap', processTableProbe(mode));
  assert(result.stopError, 'An unsuccessful inspection must never report successful cleanup.');
  assert.equal(result.socketOpen, false, 'Even after inspection failure the owned group must receive forced termination.');
  assert.equal(result.rebound, true); assert.equal(result.siblingOpen, true);
});

test('Windows runners refuse before creating an unowned process tree (emulated branch, not native Windows acceptance)', { skip: !hasHelper, timeout: 10000 }, async () => {
  const probe = `import assert from 'node:assert/strict';
import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';
import{spawnOwnedChild}from${JSON.stringify(pathToFileURL(helperPath).href)};
const originalPlatform=process.platform;Object.defineProperty(process,'platform',{value:'win32'});
let launches=0;cp.spawn=()=>{launches++;throw new Error('Unexpected process launch');};syncBuiltinESMExports();
assert.throws(()=>spawnOwnedChild(process.execPath,['-e','setInterval(()=>{},1000)']),{code:'ERR_OWNED_HTTP_PLATFORM_UNSUPPORTED'});
assert.equal(launches,0);console.log(JSON.stringify({emulatedBranch:'win32',actualKernel:originalPlatform,launches,unsupported:true}));\n`;
  const { stdout, stderr } = await run(process.execPath, ['--input-type=module', '-e', probe], { timeout: 5000 });
  const result = JSON.parse(stdout); console.log(JSON.stringify({ evidence: 'round31_windows_prelaunch_rejection', ...result }));
  assert.equal(stderr, ''); assert.equal(result.launches, 0); assert.equal(result.unsupported, true);
});
