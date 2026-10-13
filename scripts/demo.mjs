import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnvironment, loadEnvironment } from '../deploy/synthetic-http/environment.mjs';
import { startEnvironment } from '../deploy/synthetic-http/server.mjs';
import { seedRegionalDemo } from './regional-demo.mjs';

// This launcher owns only a loopback, synthetic environment. The pointer holds
// no credentials; the existing environment helper keeps secrets in its private root.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(project);
const pointer = join(project, '.anxin-demo.json');
const command = process.argv[2] ?? 'start';
let running;
let stopRequested = false;

function currentEnvironment() {
  if (!existsSync(pointer)) return null;
  let saved, config;
  try {
    saved = JSON.parse(readFileSync(pointer, 'utf8'));
    config = loadEnvironment(saved.root);
  } catch {
    throw new Error('无法读取原展示环境。请保留 .anxin-demo.json 并检查其指向的目录；不要覆盖原记录。');
  }
  if (config.environmentId !== saved.environmentId || config.bindIp !== '127.0.0.1'
    || new URL(config.origin).hostname !== '127.0.0.1' || config.proxyMode
    || config.directEntry !== true || config.persistentDemo !== true) {
    throw new Error('展示记录与本机专用环境不匹配，请保留文件并检查 .anxin-demo.json。');
  }
  return config;
}

async function isRunning(config) {
  if (!config) return false;
  try {
    const response = await fetch(`${config.origin}/api/ready`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const ready = await response.json();
    if (ready.environmentId !== config.environmentId) throw new Error('展示端口已被其他实例占用。');
    return ready.status === 'ok';
  } catch (error) {
    if (error.message === '展示端口已被其他实例占用。') throw error;
    return false;
  }
}

async function build() {
  await new Promise((done, fail) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { stdio: 'inherit' });
    child.once('error', fail);
    child.once('exit', (code) => code === 0 ? done() : fail(new Error('展示构建失败，未启动新服务。')));
  });
}

async function run() {
  if (!['start', 'status'].includes(command) || process.argv.length > 3) {
    throw new Error('用法：npm run demo，或 npm run demo:status。');
  }
  let config = currentEnvironment();
  const active = await isRunning(config);
  if (command === 'status') {
    console.log(config ? `${active ? '运行中' : '已停止'}：${config.origin}\n展示数据目录：${config.root}` : '尚未创建展示环境，请运行 npm run demo。');
    return;
  }
  if (active) {
    console.log(`展示已经运行：${config.origin}\n未重新导入或覆盖数据。请在原启动终端按 Ctrl+C 停止。`);
    return;
  }
  // Handle interruption even during migrations/Worker startup, before the
  // environment's own signal handlers are installed. Let startup unwind so
  // it can remove its runtime marker and stop only its own child.
  const requestStop = () => {
    stopRequested = true;
    if (running) void running.stop().catch(() => { process.exitCode = 1; });
  };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  await build();
  if (stopRequested) return;
  if (!config) {
    config = createEnvironment({ directEntry: true, persistentDemo: true, port: 18091, workerPort: 18898 });
    const temporary = `${pointer}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ root: config.root, environmentId: config.environmentId }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, pointer);
  }
  running = await startEnvironment(config.root);
  if (stopRequested) { await running.stop(); return; }
  const counts = await seedRegionalDemo(config.root);
  if (stopRequested) { await running.stop(); return; }
  console.log(`\n安薪乐业展示已就绪：${config.origin}`);
  console.log(`已装载 ${counts.cases} 个案例、${counts.evidence} 份材料、${counts.documents} 份草稿、${counts.consultations} 组咨询。`);
  console.log('人物、单位及材料均为虚构；仅供本机功能展示。');
  console.log('按 Ctrl+C 停止；再次运行 npm run demo 会保留当前案件和修改。');
  console.log(`展示数据目录：${config.root}\n验收步骤：DEMO-ACCEPTANCE.md`);
}

async function main() {
  if (command === 'status') return run();
  const lock = join(project, '.anxin-demo.lock');
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid }) + '\n', { flag: 'wx', mode: 0o600 });
  } catch {
    throw new Error('另一进程正在准备展示。请等待后重试；异常中断后的锁文件按 DEMO-ACCEPTANCE.md 核实后处理。');
  }
  try { await run(); }
  finally { unlinkSync(lock); }
}

main().catch(async (error) => {
  if (running) await running.stop();
  if (stopRequested) return;
  // Do not print exception payloads from credential-bearing environment files.
  console.error(`展示未就绪：${error instanceof Error ? error.message : '启动失败。'}`);
  console.error('现有资料已保留。处理问题后重跑 npm run demo；不要删除已有环境来掩盖错误。');
  process.exitCode = 1;
});
