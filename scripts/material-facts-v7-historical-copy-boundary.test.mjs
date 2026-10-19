import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const ROOT = process.env.V7_REVIEW_ROOT ?? process.cwd();
const E = 'experiments/material-facts-v7';
const { withCorrectionV29Code } = await import(pathToFileURL(resolve(ROOT, E, 'verify-correction-v29.mjs')));
const { withFrozenCode } = await import(pathToFileURL(resolve(ROOT, E, 'verify-frozen.mjs')));
test('direct historical entry points exclude only postfreeze diagnostics and retain all required evidence', { timeout: 180000 }, async t => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'anxin-v7-copy-boundary-'));
  try {
    for (const p of ['lib','scripts','experiments','docs','package.json']) await cp(resolve(ROOT,p),resolve(fixture,p), {recursive:true, filter: source => resolve(source)!==resolve(ROOT,E,'postfreeze-evidence')});
    const samples = [
      [`${E}/postfreeze-evidence/synthetic.bin`, Buffer.alloc(2*1024*1024,17)],
      [`${E}/postfreeze-evidence-neighbor/sentinel.bin`, Buffer.from('similarly named evidence remains')],
      [`${E}/review-evidence/copy-boundary-sentinel.bin`, Buffer.from('review evidence remains')],
      ['docs/postfreeze-evidence/sentinel.bin', Buffer.from('same leaf name outside diagnostic root remains')],
    ];
    for (const [p,b] of samples) { await mkdir(dirname(resolve(fixture,p)),{recursive:true}); await writeFile(resolve(fixture,p),b,{flag:'wx'}); }
    const verify = async temporary => {
      await assert.rejects(stat(resolve(temporary,E,'postfreeze-evidence')), {code:'ENOENT'});
      for (const [p,b] of samples.slice(1)) assert.deepEqual(await readFile(resolve(temporary,p)),b,p);
      for (const p of ['freeze.json','result-manifest.json','corrections-v30/manifest.json','data/holdout.labels.provisional.jsonl']) {
        assert.deepEqual(await readFile(resolve(temporary,E,p)),await readFile(resolve(fixture,E,p)),p);
      }
    };
    await t.test('latest direct archive restore omits diagnostic files while retaining neighbors', async () => {
      await withCorrectionV29Code(async temporary => {
        await verify(temporary);
        const {withCorrectionV28Code}=await import(pathToFileURL(resolve(temporary,E,'verify-correction-v28.mjs')));
        await withCorrectionV28Code(verify,temporary);
      }, fixture);
    });
    await t.test('original freeze restore also uses the bounded copy', () => withFrozenCode(verify,fixture));
    await t.test('original diagnostics and required evidence remain byte-identical after both paths', async () => {
      for (const [p,b] of samples) assert.deepEqual(await readFile(resolve(fixture,p)),b,p);
    });
  } finally { await rm(fixture,{recursive:true,force:true}); }
});
