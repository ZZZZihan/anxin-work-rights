import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createMaterialService } from './material-service.mjs';

const token = randomBytes(32).toString('hex');
const model = process.env.ANXIN_MATERIAL_MODEL || process.env.ANXIN_VISION_MODEL || null;
const service = await createMaterialService({ token, port: 0, model });
let stopping = false;
const child = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'dev', '--hostname', '127.0.0.1', '--port', process.env.ANXIN_DEMO_PORT || '3013'], {
  stdio: 'inherit',
  env: { ...process.env, ANXIN_MATERIAL_SERVICE_URL: service.url, ANXIN_MATERIAL_SERVICE_TOKEN: token },
});
console.log('本地材料样例已启动；识别服务只连接本机，原文件保存在项目本地 D1/R2。');
console.log(model ? `本地结构化模型：${model}（使用本机已有模型，不下载）` : '当前为真实 OCR + 规则提取；启用本地模型请设置 ANXIN_MATERIAL_MODEL。');
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  await service.close();
  process.exitCode = code;
}
child.once('error', async () => { console.error('开发服务器未启动，请先运行 npm ci。'); await stop(1); });
child.once('exit', (code) => { void stop(code || 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(0); });
