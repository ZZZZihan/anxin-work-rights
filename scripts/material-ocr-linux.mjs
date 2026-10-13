import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const MAX_PIXELS = 40_000_000;
const MAX_SIDE = 8192;
const MAX_TEXT = 32_000;
const MAX_BLOCKS = 1000;
const OCR_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 16 * 1024 * 1024;

function failure(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }

/** Direct children only: no shell, network, user-selected command, or shared output path. */
export function runOcrCommand(program, args, { signal, env, timeout = OCR_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let outcome;
    const child = execFile(program, args, {
      encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout, signal, env, killSignal: 'SIGKILL',
    }, (error, stdout, stderr) => { outcome = { error, stdout, stderr }; });
    // Abort callbacks may run before process exit. Wait for closed stdio before the caller removes files.
    child.once('close', () => {
      const { error, stdout, stderr } = outcome;
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
      else resolve(stdout);
    });
  });
}

function checkDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw failure('IMAGE_TOO_LARGE', '图片或 PDF 页面像素过大，请缩小后重新识别。');
  }
  return { width, height };
}

/** Inspect encoded dimensions before handing compressed input to a decoder. */
export function imageDimensions(bytes, mime) {
  if (mime === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      throw failure('INVALID_IMAGE', '图片无法读取，请确认 PNG 文件完整。');
    }
    return checkDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (mime !== 'image/jpeg' || bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) {
    throw failure('INVALID_IMAGE', '图片无法读取，请确认 JPEG 文件完整。');
  }
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (frames.has(marker)) {
      if (length < 8) break;
      return checkDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  throw failure('INVALID_IMAGE', '图片无法读取，请确认 JPEG 文件完整。');
}

/** TSV adds token boundaries, not literal spaces between every Chinese character. */
function lineText(words) {
  return words.reduce((text, word) => {
    if (!text) return word.text;
    const adjoiningChineseOrPunctuation = /[\p{Script=Han}\p{P}\p{S}]$/u.test(text) || /^[\p{Script=Han}\p{P}\p{S}]/u.test(word.text);
    return text + (adjoiningChineseOrPunctuation ? '' : ' ') + word.text;
  }, '');
}

/** Keep Tesseract's reading order and exact recognised characters; never repair words or amounts. */
export function parseTesseractTsv(tsv, page = 1) {
  const lines = tsv.split(/\r?\n/u);
  if (lines.shift() !== 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext') {
    throw failure('OCR_FAILED', '文字识别结果格式不正确。');
  }
  let dimensions;
  const groups = new Map();
  for (const line of lines) {
    if (!line) continue;
    const columns = line.split('\t');
    if (columns.length < 12) throw failure('OCR_FAILED', '文字识别结果格式不正确。');
    const [level, pageNumber, block, paragraph, row, word, left, top, width, height, confidence] = columns.slice(0, 11).map(Number);
    if (level === 1) {
      if (dimensions) throw failure('OCR_FAILED', '单页识别结果包含重复页面。');
      dimensions = checkDimensions(width, height);
    }
    if (level !== 5) continue;
    const text = columns.slice(11).join('\t').trim();
    if (!text) continue;
    if (![pageNumber, block, paragraph, row, word, left, top, width, height].every(Number.isInteger) ||
        pageNumber !== 1 || block < 1 || paragraph < 1 || row < 1 || word < 1 || left < 0 || top < 0 || width <= 0 || height <= 0 ||
        !Number.isFinite(confidence) || confidence < 0 || confidence > 100 || !dimensions ||
        left + width > dimensions.width || top + height > dimensions.height || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\t]/u.test(text)) {
      throw failure('OCR_FAILED', '文字识别位置或文字格式不正确。');
    }
    const key = `${block}-${paragraph}-${row}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ text, left, top, width, height, confidence });
    if (groups.size > MAX_BLOCKS) throw failure('BLOCK_LIMIT', '识别文字段落过多，请拆分材料后重试。');
  }
  if (!dimensions) throw failure('OCR_FAILED', '文字识别结果缺少页面尺寸。');
  let textLength = 0;
  return [...groups.values()].map((words, index) => {
    const text = lineText(words);
    textLength += text.length;
    if (text.length > 3000 || textLength > MAX_TEXT) throw failure('TEXT_LIMIT', '识别文字过多，请拆分材料后重试。');
    const left = Math.min(...words.map((word) => word.left));
    const top = Math.min(...words.map((word) => word.top));
    const right = Math.max(...words.map((word) => word.left + word.width));
    const bottom = Math.max(...words.map((word) => word.top + word.height));
    const weight = words.reduce((sum, word) => sum + word.text.length, 0);
    return { id: `p${page}-b${index + 1}`, page, text,
      bbox: [left / dimensions.width, top / dimensions.height, (right - left) / dimensions.width, (bottom - top) / dimensions.height],
      confidence: words.reduce((sum, word) => sum + word.confidence * word.text.length, 0) / weight / 100 };
  });
}

export function parsePdfInfo(output) {
  if (/^Encrypted:\s+yes\b/mi.test(output)) throw failure('PDF_LOCKED', 'PDF 已加密，请解锁后重新上传。');
  const pageCount = Number(/^Pages:\s+(\d+)\s*$/mi.exec(output)?.[1]);
  if (!Number.isInteger(pageCount) || pageCount < 1) throw failure('INVALID_PDF', 'PDF 无法读取或没有页面。');
  if (pageCount > 5) throw failure('PDF_PAGE_LIMIT', '最多识别 5 页 PDF，请拆分后上传。');
  const pages = new Map();
  for (const match of output.matchAll(/^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts\b/gmi)) {
    pages.set(Number(match[1]), [Number(match[2]), Number(match[3])]);
  }
  // Some Poppler versions omit the page number for a one-page document.
  if (pageCount === 1 && !pages.size) {
    const match = /^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts\b/mi.exec(output);
    if (match) pages.set(1, [Number(match[1]), Number(match[2])]);
  }
  for (const match of output.matchAll(/^Page\s+(\d+)\s+MediaBox:\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*$/gmi)) {
    pages.set(Number(match[1]), [Number(match[4]) - Number(match[2]), Number(match[5]) - Number(match[3])]);
  }
  for (let page = 1; page <= pageCount; page += 1) {
    const size = pages.get(page);
    if (!size) throw failure('INVALID_PDF', '无法确认所有 PDF 页面尺寸。');
    checkDimensions(Math.ceil(size[0] * 2), Math.ceil(size[1] * 2));
  }
  return pageCount;
}

/** Server-owned configuration only; these values are never accepted from an HTTP caller. */
export function createLinuxOcr({ env = process.env, run = runOcrCommand } = {}) {
  const tesseract = env.ANXIN_TESSERACT_BIN || 'tesseract';
  if (env.ANXIN_TESSERACT_BIN && !isAbsolute(tesseract)) throw new Error('ANXIN_TESSERACT_BIN must be an absolute path.');
  if (env.ANXIN_TESSDATA_PREFIX && !isAbsolute(env.ANXIN_TESSDATA_PREFIX)) throw new Error('ANXIN_TESSDATA_PREFIX must be an absolute path.');
  const tesseractEnv = { ...env, ...(env.ANXIN_TESSDATA_PREFIX ? { TESSDATA_PREFIX: env.ANXIN_TESSDATA_PREFIX } : {}),
    ...(env.ANXIN_TESSERACT_LIBRARY_PATH ? { LD_LIBRARY_PATH: env.ANXIN_TESSERACT_LIBRARY_PATH } : {}) };
  const toolEnv = { ...env, LC_ALL: 'C', LANG: 'C' };
  let availability;
  async function probe() {
    const checked = await Promise.allSettled([
      run(tesseract, ['--list-langs'], { env: tesseractEnv, timeout: 5000 }),
      run('pdfinfo', ['-v'], { env: toolEnv, timeout: 5000 }),
      run('pdftoppm', ['-v'], { env: toolEnv, timeout: 5000 }),
    ]);
    const image = checked[0].status === 'fulfilled' && /^chi_sim\s*$/mu.test(checked[0].value);
    const pdf = image && checked[1].status === 'fulfilled' && checked[2].status === 'fulfilled';
    availability = { image, pdf, capabilities: [...(image ? ['tesseract_chi_sim'] : []), ...(pdf ? ['poppler'] : []), 'utf8_text'],
      ...(!image ? { error: { code: 'OCR_UNAVAILABLE', message: '本机 Tesseract 中文识别引擎或 chi_sim 语言包未就绪。' } }
        : !pdf ? { error: { code: 'OCR_UNAVAILABLE', message: '本机 PDF 渲染工具 pdfinfo/pdftoppm 未就绪；图片识别仍可使用。' } } : {}) };
    return availability;
  }
  async function recognise(bytes, mime, directory, signal) {
    const available = availability || await probe();
    if (!(mime === 'application/pdf' ? available.pdf : available.image)) {
      throw failure('OCR_UNAVAILABLE', available.error?.message || '本机文字识别引擎未就绪。', 503);
    }
    const deadline = AbortSignal.timeout(OCR_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    async function command(program, args, commandEnv, invalidCode, invalidMessage) {
      try { return await run(program, args, { env: commandEnv, signal: combined, timeout: OCR_TIMEOUT_MS }); }
      catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw failure('TEXT_LIMIT', '识别输出过多，请拆分材料后重试。');
        if (deadline.aborted || error.killed) throw failure('OCR_TIMEOUT', '文字识别超时，请拆分或缩小材料后重试。');
        if (error.code === 'ENOENT') throw failure('OCR_UNAVAILABLE', '本机文字识别工具不可用，请重启服务并核对配置。', 503);
        if (program === 'pdfinfo' && (/password|encrypted|permission/iu.test(error.stderr || '') || error.code === 3)) {
          throw failure('PDF_LOCKED', 'PDF 已加密或禁止读取，请解锁后重新上传。');
        }
        throw failure(invalidCode, invalidMessage);
      }
    }
    const input = join(directory, mime === 'application/pdf' ? 'original.pdf' : mime === 'image/png' ? 'original.png' : 'original.jpg');
    if (mime !== 'application/pdf') imageDimensions(bytes, mime);
    await writeFile(input, bytes, { mode: 0o600 });
    let pageCount = 1;
    const imagePaths = [];
    if (mime === 'application/pdf') {
      pageCount = parsePdfInfo(await command('pdfinfo', ['-f', '1', '-l', '5', '-box', input], toolEnv, 'INVALID_PDF', 'PDF 无法读取，请确认文件完整。'));
      for (let page = 1; page <= pageCount; page += 1) {
        if (combined.aborted) throw signal?.aborted ? signal.reason : failure('OCR_TIMEOUT', '文字识别超时，请拆分或缩小材料后重试。');
        const prefix = join(directory, `page-${page}`);
        await command('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '144', '-singlefile', '-png', input, prefix], toolEnv, 'PDF_RENDER_FAILED', 'PDF 页面无法渲染。');
        const path = `${prefix}.png`;
        imageDimensions(await readFile(path), 'image/png');
        imagePaths.push(path);
      }
    } else imagePaths.push(input);
    const blocks = [];
    for (let page = 1; page <= imagePaths.length; page += 1) {
      const tsv = await command(tesseract, [imagePaths[page - 1], 'stdout', '-l', 'chi_sim', '--psm', '3', 'tsv'], tesseractEnv, 'OCR_FAILED', '文字识别失败，请确认材料清晰且格式正确。');
      blocks.push(...parseTesseractTsv(tsv, page));
      if (blocks.length > MAX_BLOCKS) throw failure('BLOCK_LIMIT', '识别文字段落过多，请拆分材料后重试。');
      if (blocks.reduce((count, block) => count + block.text.length, 0) > MAX_TEXT) throw failure('TEXT_LIMIT', '识别文字过多，请拆分材料后重试。');
    }
    if (!blocks.length) throw failure('OCR_EMPTY', '未识别到文字，请上传清晰且包含文字的材料。');
    if (combined.aborted) throw signal?.aborted ? signal.reason : failure('OCR_TIMEOUT', '文字识别超时，请拆分或缩小材料后重试。');
    return { pageCount, blocks, imagePaths, engine: mime === 'application/pdf' ? 'tesseract_chi_sim_poppler' : 'tesseract_chi_sim' };
  }
  return { probe, recognise };
}
