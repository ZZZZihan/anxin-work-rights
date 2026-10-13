import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLinuxOcr, imageDimensions, parsePdfInfo, parseTesseractTsv, runOcrCommand } from './material-ocr-linux.mjs';
import { extractRuleFields } from './material-service.mjs';

const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const pageRow = (width = 1000, height = 700) => `1\t1\t0\t0\t0\t0\t0\t0\t${width}\t${height}\t-1\t`;
const tsv = (...rows) => [header, pageRow(), ...rows].join('\n');
const row = (word, text, left, width = 20, line = 1, confidence = 95) => `5\t1\t1\t1\t${line}\t${word}\t${left}\t100\t${width}\t30\t${confidence}\t${text}`;
function png(width = 1000, height = 700) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
const pdf = (count = 2) => `Pages: ${count}\nEncrypted: no\n${Array.from({ length: Math.min(count, 5) }, (_, index) => `Page ${index + 1} size: 1000 x 700 pts\nPage ${index + 1} MediaBox: 0.00 0.00 1000.00 700.00`).join('\n')}`;

test('TSV preserves page references, normalised left-top boxes, confidence and recognised text', () => {
  const blocks = parseTesseractTsv(tsv(row(1, '月', 30), row(2, '工资', 50, 40), row(3, ':', 90, 10), row(4, '8000', 110, 60), row(5, '元', 170),
    row(1, 'Example', 30, 100, 2, 80), row(2, 'Company', 150, 100, 2, 90)), 3);
  assert.deepEqual(blocks.map(({ id, page, text, bbox }) => ({ id, page, text, bbox })), [
    { id: 'p3-b1', page: 3, text: '月工资:8000元', bbox: [0.03, 100 / 700, 0.16, 30 / 700] },
    { id: 'p3-b2', page: 3, text: 'Example Company', bbox: [0.03, 100 / 700, 0.22, 30 / 700] },
  ]);
  assert.equal(blocks[0].confidence, 0.95);
  assert.equal(blocks[1].confidence, 0.85);
  assert.equal(extractRuleFields(blocks, 'contract')[0].value, '8000元');
  const mistaken = parseTesseractTsv(tsv(row(1, 'ALR:', 30, 100), row(2, '80007', 140, 100)));
  assert.equal(mistaken[0].text, 'ALR:80007', 'OCR errors are retained, not replaced using fixture facts.');
  assert.equal(extractRuleFields(mistaken, 'contract').length, 0);
});

test('TSV rejects ungrounded coordinates, missing dimensions, control text and oversized pages', () => {
  for (const input of [tsv(row(1, '文字', -1)), tsv(row(1, '文字', 999, 30)), tsv(row(1, '文字', 10, 20, 1, 101)),
    [header, row(1, '文字', 10)].join('\n'), tsv(row(1, '原文\t伪造', 10))]) {
    assert.throws(() => parseTesseractTsv(input), { code: 'OCR_FAILED' });
  }
  assert.throws(() => parseTesseractTsv([header, pageRow(8193, 100)].join('\n')), { code: 'IMAGE_TOO_LARGE' });
  assert.throws(() => parseTesseractTsv(tsv(row(1, '合'.repeat(3001), 10))), { code: 'TEXT_LIMIT' });
});

test('image preflight checks PNG/JPEG dimensions before decoding', () => {
  assert.deepEqual(imageDimensions(png(), 'image/png'), { width: 1000, height: 700 });
  assert.throws(() => imageDimensions(png(8000, 8000), 'image/png'), { code: 'IMAGE_TOO_LARGE' });
  assert.throws(() => imageDimensions(png(0, 100), 'image/png'), { code: 'IMAGE_TOO_LARGE' });
  assert.throws(() => imageDimensions(Buffer.from('broken'), 'image/png'), { code: 'INVALID_IMAGE' });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 100, 0, 200, 1, 0xff, 0xd9]);
  assert.deepEqual(imageDimensions(jpeg, 'image/jpeg'), { width: 200, height: 100 });
  assert.throws(() => imageDimensions(jpeg.subarray(0, 10), 'image/jpeg'), { code: 'INVALID_IMAGE' });
});

test('PDF preflight rejects encryption, page truncation and a large later page before rendering', () => {
  assert.equal(parsePdfInfo(pdf()), 2);
  assert.throws(() => parsePdfInfo(pdf(6)), { code: 'PDF_PAGE_LIMIT' });
  assert.throws(() => parsePdfInfo(pdf().replace('Encrypted: no', 'Encrypted: yes')), { code: 'PDF_LOCKED' });
  assert.throws(() => parsePdfInfo('Pages: 2\nEncrypted: no\nPage 1 size: 1000 x 700 pts'), { code: 'INVALID_PDF' });
  assert.throws(() => parsePdfInfo(pdf().replace('Page 2 MediaBox: 0.00 0.00 1000.00 700.00', 'Page 2 MediaBox: 0.00 0.00 5000.00 5000.00')), { code: 'IMAGE_TOO_LARGE' });
  assert.equal(parsePdfInfo('Pages: 1\nEncrypted: no\nPage size: 595.28 x 841.89 pts (A4)'), 1);
  // Both fit the former 144 DPI bounds; reject using the actual 216 DPI rendering scale.
  assert.throws(() => parsePdfInfo('Pages: 1\nEncrypted: no\nPage size: 3000 x 100 pts'), { code: 'IMAGE_TOO_LARGE' });
  assert.throws(() => parsePdfInfo('Pages: 1\nEncrypted: no\nPage size: 2300 x 2000 pts'), { code: 'IMAGE_TOO_LARGE' });
  assert.equal(parsePdfInfo('Pages: 1\nEncrypted: no\nPage size: 2730 x 100 pts'), 1);
  assert.throws(() => parsePdfInfo('Pages: 1\nEncrypted: no\nPage size: 2731 x 100 pts'), { code: 'IMAGE_TOO_LARGE' });
});

test('private executable/language/library configuration is passed only to Tesseract', async (t) => {
  const calls = [];
  const directory = await mkdtemp(join(tmpdir(), 'anxin-linux-ocr-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { ANXIN_TESSERACT_BIN: '/private/bin/tesseract', ANXIN_TESSDATA_PREFIX: '/private/share/tessdata', ANXIN_TESSERACT_LIBRARY_PATH: '/private/lib', LD_LIBRARY_PATH: '/original/lib' };
  const run = async (program, args, options) => {
    calls.push({ program, args, options });
    if (args[0] === '--list-langs') return 'List of available languages (1):\nchi_sim\n';
    if (args[0] === '-v') return '';
    return tsv(row(1, '月工资:8000元', 30, 200));
  };
  const ocr = createLinuxOcr({ env, run });
  assert.deepEqual((await ocr.probe()).capabilities, ['tesseract_chi_sim', 'poppler', 'utf8_text']);
  const result = await ocr.recognise(png(), 'image/png', directory);
  assert.equal(result.engine, 'tesseract_chi_sim');
  assert.equal(result.blocks[0].text, '月工资:8000元');
  for (const call of calls.filter((call) => call.program === '/private/bin/tesseract')) {
    assert.equal(call.options.env.TESSDATA_PREFIX, '/private/share/tessdata');
    assert.equal(call.options.env.LD_LIBRARY_PATH, '/private/lib');
  }
  for (const call of calls.filter((call) => call.program !== '/private/bin/tesseract')) {
    assert.equal(call.options.env.TESSDATA_PREFIX, undefined);
    assert.equal(call.options.env.LD_LIBRARY_PATH, '/original/lib');
    assert.equal(call.options.env.LC_ALL, 'C');
  }
  assert.throws(() => createLinuxOcr({ env: { ANXIN_TESSERACT_BIN: './untrusted' } }), /absolute/u);
});

test('missing Chinese language/tool capabilities fail explicitly while TXT remains advertised', async () => {
  const ocr = createLinuxOcr({ env: {}, run: async () => 'eng\n' });
  const capabilities = await ocr.probe();
  assert.deepEqual(capabilities.capabilities, ['utf8_text']);
  assert.equal(capabilities.error.code, 'OCR_UNAVAILABLE');
  await assert.rejects(ocr.recognise(png(), 'image/png', '/unused'), { code: 'OCR_UNAVAILABLE', status: 503 });
  const imageOnly = createLinuxOcr({ env: {}, run: async (program) => {
    if (program === 'tesseract') return 'chi_sim\n';
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  } });
  assert.deepEqual((await imageOnly.probe()).capabilities, ['tesseract_chi_sim', 'utf8_text']);
  await assert.rejects(imageOnly.recognise(Buffer.from('pdf'), 'application/pdf', '/unused'), { code: 'OCR_UNAVAILABLE' });
});

test('all PDF pages retain page IDs, bounded rendering arguments and citations; over-limit PDF never renders', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'anxin-linux-ocr-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let info = pdf();
  const renders = [];
  const run = async (program, args) => {
    if (args[0] === '--list-langs') return 'chi_sim\n';
    if (args[0] === '-v') return '';
    if (program === 'pdfinfo') return info;
    if (program === 'pdftoppm') { renders.push(args); await writeFile(`${args.at(-1)}.png`, png()); return ''; }
    return tsv(row(1, '月工资:8000元', 30, 200));
  };
  const ocr = createLinuxOcr({ env: {}, run });
  const result = await ocr.recognise(Buffer.from('controlled synthetic PDF bytes'), 'application/pdf', directory);
  assert.equal(result.pageCount, 2);
  assert.equal(result.engine, 'tesseract_chi_sim_poppler');
  assert.deepEqual(result.blocks.map((block) => [block.id, block.page]), [['p1-b1', 1], ['p2-b1', 2]]);
  assert.deepEqual(renders.map((args) => args.slice(0, 9)), [
    ['-f', '1', '-l', '1', '-r', '216', '-singlefile', '-png', join(directory, 'original.pdf')],
    ['-f', '2', '-l', '2', '-r', '216', '-singlefile', '-png', join(directory, 'original.pdf')],
  ]);
  for (const field of extractRuleFields(result.blocks, 'contract')) assert(result.blocks.find((block) => block.id === field.blockIds[0]).text.includes(field.quote));
  info = pdf(6); renders.length = 0;
  await assert.rejects(ocr.recognise(Buffer.from('six-page controlled PDF'), 'application/pdf', directory), { code: 'PDF_PAGE_LIMIT' });
  assert.equal(renders.length, 0);
  info = pdf().replace('Page 2 MediaBox: 0.00 0.00 1000.00 700.00', 'Page 2 MediaBox: 0.00 0.00 3000.00 100.00');
  await assert.rejects(ocr.recognise(Buffer.from('large second-page controlled PDF'), 'application/pdf', directory), { code: 'IMAGE_TOO_LARGE' });
  assert.equal(renders.length, 0, 'Preflight all page dimensions at the selected DPI before rendering any page.');
});

test('PDF password errors and OCR timeouts expose stable errors, not subprocess paths or stderr', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'anxin-linux-ocr-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let mode = 'password';
  const run = async (program, args) => {
    if (args[0] === '--list-langs') return 'chi_sim\n';
    if (args[0] === '-v') return '';
    throw Object.assign(new Error('/private/secret/path'), mode === 'password' ? { code: 1, stderr: 'Incorrect password /private/secret/path' } : { killed: true });
  };
  const ocr = createLinuxOcr({ env: {}, run });
  await assert.rejects(ocr.recognise(Buffer.from('encrypted'), 'application/pdf', directory), { code: 'PDF_LOCKED' });
  mode = 'timeout';
  await assert.rejects(ocr.recognise(png(), 'image/png', directory), { code: 'OCR_TIMEOUT' });
});

test('aborting a direct OCR child kills and settles it before caller cleanup', async () => {
  const controller = new AbortController();
  const pending = runOcrCommand(process.execPath, ['-e', 'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)'], { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    await assert.rejects(pending, (error) => {
      assert.equal(error.name, 'AbortError');
      if (error.stdout) assert.throws(() => process.kill(Number(error.stdout), 0), { code: 'ESRCH' });
      return true;
    });
  } finally { clearTimeout(timer); }
});

test('a missing direct executable closes and rejects without hanging startup', async () => {
  await assert.rejects(runOcrCommand('/nonexistent-anxin-test/tesseract', ['--list-langs']), { code: 'ENOENT' });
});

test('real Linux Tesseract/Poppler recognises explicit synthetic PNG/PDF fixtures without model inference', {
  skip: process.platform === 'linux' ? false : 'Tesseract is the supported Linux runtime; macOS real OCR uses Apple Vision and is tested in material-service.test.mjs.',
}, async (t) => {
  const ocr = createLinuxOcr();
  const available = await ocr.probe();
  if (!available.pdf) { t.skip('Tesseract chi_sim or Poppler is not installed on this test host.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'anxin-linux-ocr-real-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, mime, expected] of [
    ['contract.png', 'image/png', ['张小合', '8000元']], ['wage-statement.png', 'image/png', ['6500元', '2026年02月10日']],
    ['chat.png', 'image/png', ['公司拖欠2月份工资', '安排你明天上午到工厂上班']], ['contract.pdf', 'application/pdf', ['张小合', '8000元']],
  ]) {
    const result = await ocr.recognise(await readFile(new URL(`../fixtures/material-demo/${name}`, import.meta.url)), mime, directory);
    const text = result.blocks.map((block) => block.text).join('\n');
    for (const value of expected) assert(text.includes(value), `${name}: ${value}\n${text}`);
    if (name === 'contract.png' || name === 'contract.pdf') {
      const fields = extractRuleFields(result.blocks, 'contract');
      for (const [key, value] of Object.entries({ employer: '合成星海科技有限公司', worker: '张小合', job: '设备维护员', employment_start: '2026年01月05日', wage_standard: '8000元' })) {
        assert(fields.some((field) => field.key === key && field.value === value), `${name}: ${key}=${value}\n${text}`);
      }
      for (const field of fields) assert(result.blocks.filter((block) => field.blockIds.includes(block.id)).map((block) => block.text).join('\n').includes(field.quote));
    }
    assert(result.blocks.every((block) => block.bbox[0] + block.bbox[2] <= 1 && block.bbox[1] + block.bbox[3] <= 1));
  }
});
