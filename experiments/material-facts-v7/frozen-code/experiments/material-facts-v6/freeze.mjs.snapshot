import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const EXPERIMENT = 'experiments/material-facts-v6';
export const BACKENDS = ['rules', 'qwen', 'deepseek'];
export const LEGACY = 'experiments/material-facts-v5';
export const RUN_HASH_FILES = ['lib/material-facts.ts', 'lib/material-fact-types.ts', 'lib/material-facts-v2.ts', 'lib/material-fact-types-v2.ts', 'lib/material-facts-v3.ts', 'lib/material-fact-types-v3.ts',
  'scripts/fact-runtime-v2.py', 'scripts/fact_memory_runtime.py', 'scripts/fact_api_transport.py', `${EXPERIMENT}/run.mjs`, `${EXPERIMENT}/assess.mjs`];
export const REQUIRED_FILES = [...RUN_HASH_FILES, 'lib/material-facts-v3.test.ts', 'lib/material-facts-v6-eval.test.ts', `${EXPERIMENT}/PROTOCOL.md`, `${EXPERIMENT}/model-identity.json`,
  `${EXPERIMENT}/run-via-test-egress.py`, `${EXPERIMENT}/freeze.mjs`, `${EXPERIMENT}/verify.mjs`, `${EXPERIMENT}/SOURCE_REVIEW.md`, `${EXPERIMENT}/REVIEW.md`, `${EXPERIMENT}/DEVELOPMENT.md`, `${EXPERIMENT}/ANNOTATION.md`,
  `${EXPERIMENT}/development-receipt.json`, `${EXPERIMENT}/development/domain-before-dedup.ts.txt`, `${EXPERIMENT}/summarize.mjs`,
  `${LEGACY}/verify.mjs`, `${LEGACY}/freeze.json`, `${LEGACY}/result-manifest.json`];
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const same = (actual, expected, message) => assert(isDeepStrictEqual(actual, expected), message);
export const json = async path => JSON.parse(await readFile(path, 'utf8'));
export const jsonl = async path => (await readFile(path, 'utf8')).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
export function safePath(root, path) {
  assert(typeof path === 'string' && path && !isAbsolute(path), 'Manifest path must be relative');
  const result = resolve(root, path), inside = relative(resolve(root), result);
  assert(inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside), 'Manifest path escapes the repository');
  return result;
}
export async function filesUnder(root, directory) {
  const found = [];
  async function visit(path) {
    const info = await lstat(safePath(root, path));
    assert(!info.isSymbolicLink(), `Artifact symlink is not allowed: ${path}`);
    if (info.isDirectory()) for (const entry of (await readdir(safePath(root, path))).sort()) await visit(`${path}/${entry}`);
    else { assert(info.isFile(), `Artifact is not a regular file: ${path}`); found.push(path); }
  }
  await visit(directory);
  return found.sort();
}
export async function checkFileHashes(root, files) {
  assert(files && typeof files === 'object' && !Array.isArray(files), 'Missing hash map');
  for (const [path, hash] of Object.entries(files)) {
    assert(/^[a-f0-9]{64}$/u.test(hash), `Invalid recorded hash: ${path}`);
    assert.equal(sha(await readFile(safePath(root, path))), hash, `Frozen artifact changed: ${path}`);
  }
}
export function verifyLegacy(root) {
  // The complete old verifier includes its own old-data and report recomputation.
  const output = execFileSync(process.execPath, [resolve(root, LEGACY, 'verify.mjs')], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 ** 2, timeout: 60000 });
  const receipt = JSON.parse(output.trim());
  assert.equal(receipt.status, 'PASS', 'Old v5 replication verification failed');
  return { script: `${LEGACY}/verify.mjs`, status: 'PASS', output_sha256: sha(output), result_files: receipt.result_files, result_manifest_sha256: receipt.result_manifest_sha256 };
}
const canonicalUrl = value => { if (!value) return null; const url = new URL(value); url.hash = ''; url.search = ''; return url.href; };

/** Programmatic inspection only; no candidate text or holdout labels are printed. */
export async function validateData(root, { dataDirectory = resolve(root, EXPERIMENT, 'data') } = {}) {
  const domain = await import(pathToFileURL(resolve(root, 'lib/material-facts-v3.ts')).href);
  const selected = await json(resolve(dataDirectory, 'sources.selected.json'));
  assert(Array.isArray(selected.sources) && selected.sources.length === 11, 'Expected eleven selected sources');
  assert.equal(new Set(selected.sources.map(row => row.id)).size, 11, 'Duplicate selected source');
  const sets = {};
  for (const [split, count] of [['dev', 3], ['holdout', 8]]) {
    const inputs = await jsonl(resolve(dataDirectory, `${split}.inputs.jsonl`));
    const labels = await jsonl(resolve(dataDirectory, `${split}.labels.provisional.jsonl`));
    assert.equal(inputs.length, count, `Wrong ${split} document count`);
    assert.equal(new Set(inputs.map(row => row.id)).size, count, `Duplicate ${split} input id`);
    same(inputs.map(row => row.id), labels.map(row => row.id), `${split} input/label IDs differ`);
    assert.equal(new Set(inputs.map(row => row.family_id)).size, count, `Repeated ${split} case family`);
    let facts = 0, alternatives = 0;
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index], label = labels[index];
      assert(typeof input.id === 'string' && input.id && typeof input.family_id === 'string' && input.family_id, `${split} missing input identifiers`);
      domain.validateFactSource(input.source);
      assert.equal(input.source.ready, true, `${split} source is not ready`);
      assert.equal(input.source.sha256, sha(input.source.blocks.map(block => block.text).join('\n\n')), `${split} excerpt hash mismatch`);
      const source = selected.sources.find(row => row.id === input.source_id);
      assert(source && source.split === split && source.family_id === input.family_id, `${split} selected-source binding mismatch`);
      assert.equal(source.excerpt_sha256, input.source.sha256, `${split} selected excerpt hash mismatch`);
      assert.equal(canonicalUrl(source.url), canonicalUrl(input.origin?.url), `${split} source URL mismatch`);
      assert.equal(label.schemaVersion, 3, `${split} label schema must be version 3`);
      assert(Array.isArray(label.expected), `${split} label.expected must be an array`);
      assert.equal(label.label_status, 'provisional_non_expert', `${split} labels must preserve their provisional status`);
      const validate = entries => {
        const batch = domain.validateCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: entries }), input.source);
        assert.equal(batch.rejected.length, 0, `${split} label has rejected candidates`);
        assert.equal(batch.candidates.length, entries.length, `${split} label candidate count changed`);
        batch.candidates.forEach((candidate, candidateIndex) => {
          const representation = domain.getCandidateRepresentation(candidate);
          same(representation, entries[candidateIndex], `${split} label representation changed`);
          if (representation.kind === 'money' && /[xX×＊*]/u.test(representation.value)) assert.equal(candidate.amount, null, `${split} masked amount became numeric`);
          if (domain.parseAmount(representation.value)?.cents === 0 || /^\s*0(?:\.0+)?\s*元\s*[/／]/u.test(representation.value)) assert.equal(candidate.amount, '0.00', `${split} explicit zero was lost`);
        });
      };
      validate(label.expected); facts += label.expected.length;
      assert(Array.isArray(label.acceptable_alternatives ?? []), `${split} alternatives must be an array`);
      for (const alternative of label.acceptable_alternatives ?? []) {
        assert(Number.isInteger(alternative.expected_index) && alternative.expected_index >= 0 && alternative.expected_index < label.expected.length, `${split} alternative has invalid target`);
        assert(Array.isArray(alternative.candidates) && alternative.candidates.length > 0 && typeof alternative.reason === 'string' && alternative.reason.trim(), `${split} alternative lacks candidates or rationale`);
        for (const candidate of alternative.candidates) validate([candidate]);
        alternatives += alternative.candidates.length;
      }
    }
    sets[split] = { inputs, labels, facts, alternatives };
  }
  const oldInputs = [...await jsonl(resolve(root, 'experiments/material-facts-v4/data/dev.inputs.jsonl')), ...await jsonl(resolve(root, 'experiments/material-facts-v4/data/holdout.inputs.jsonl')), ...await jsonl(resolve(root, 'experiments/material-facts-v5/data/dev.inputs.jsonl')), ...await jsonl(resolve(root, 'experiments/material-facts-v5/data/holdout.inputs.jsonl'))];
  const dev = sets.dev.inputs, holdout = sets.holdout.inputs;
  for (const field of ['id', 'source_id', 'family_id']) {
    const devKeys = new Set(dev.map(row => row[field]));
    assert(holdout.every(row => !devKeys.has(row[field])), `Development/holdout overlap: ${field}`);
    const oldKeys = new Set(oldInputs.map(row => row[field]).filter(Boolean));
    assert([...dev, ...holdout].every(row => !oldKeys.has(row[field])), `New data overlaps v4/v5: ${field}`);
  }
  const oldUrls = new Set(oldInputs.map(row => canonicalUrl(row.origin?.url)).filter(Boolean));
  const oldCases = new Set(oldInputs.map(row => row.origin?.case_id).filter(Boolean));
  assert([...dev, ...holdout].every(row => !oldUrls.has(canonicalUrl(row.origin?.url)) && (!row.origin?.case_id || !oldCases.has(row.origin.case_id))), 'New source URL/case overlaps v4/v5');
  const devUrls = new Set(dev.map(row => canonicalUrl(row.origin?.url)));
  const devCases = new Set(dev.map(row => row.origin?.case_id).filter(Boolean));
  assert(holdout.every(row => !devUrls.has(canonicalUrl(row.origin?.url)) && (!row.origin?.case_id || !devCases.has(row.origin.case_id))), 'Development/holdout case or URL overlap');
  return { sets, domain, summary: { dev: 3, holdout: 8, dev_facts: sets.dev.facts, holdout_facts: sets.holdout.facts, alternatives: sets.dev.alternatives + sets.holdout.alternatives } };
}
export const messageBytes = (inputs, domain) => inputs.map(input => JSON.stringify({ id: input.id, messages: domain.buildExtractionMessages(input.source) })).join('\n') + '\n';

export async function createFreeze(root = ROOT) {
  const destination = resolve(root, EXPERIMENT, 'freeze.json');
  try { await lstat(destination); throw new Error('freeze.json already exists; do not overwrite this experiment'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let results = [];
  try { results = await readdir(resolve(root, EXPERIMENT, 'results')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert(!results.some(name => name.startsWith('holdout-')), 'Formal holdout attempt exists before freezing');
  const validation = await validateData(root), legacy = verifyLegacy(root);
  for (const path of [`${EXPERIMENT}/SOURCE_REVIEW.md`, `${EXPERIMENT}/REVIEW.md`]) assert((await readFile(resolve(root, path), 'utf8')).trim(), `Missing review content: ${path}`);
  const qwen = await json(resolve(root, EXPERIMENT, 'model-identity.json'));
  same(qwen, await json(resolve(root, LEGACY, 'model-identity.json')), 'Qwen model identity differs from the verified replication');
  assert.equal(qwen.repository, 'mlx-community/Qwen3-32B-4bit');
  assert.equal(qwen.revision, 'bcaaf7f538adf166c1080a2befdb4f6019f66639');
  const paths = [...new Set([...REQUIRED_FILES, ...await filesUnder(root, `${EXPERIMENT}/data`)])].sort();
  const files = {};
  for (const path of paths) files[path] = sha(await readFile(safePath(root, path)));
  const freeze = { schema: 'material-facts-v6-freeze/1', schemaVersion: 3, frozen_at: new Date().toISOString(), formal_calls_started: false, training: false, adapters: null,
    scope: 'new_case_grouped_public_text_holdout_v3', labels: 'provisional_non_expert', deepseek_egress: 'direct', ...validation.summary,
    case_ids: validation.sets.holdout.inputs.map(row => row.id), dev_case_ids: validation.sets.dev.inputs.map(row => row.id),
    input_sha256: sha(await readFile(resolve(root, EXPERIMENT, 'data/holdout.inputs.jsonl'))), messages_sha256: sha(messageBytes(validation.sets.holdout.inputs, validation.domain)),
    dev_input_sha256: sha(await readFile(resolve(root, EXPERIMENT, 'data/dev.inputs.jsonl'))), dev_messages_sha256: sha(messageBytes(validation.sets.dev.inputs, validation.domain)), qwen, legacy, files };
  await writeFile(destination, JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' });
  return freeze;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 2, 'freeze.mjs takes no arguments; run only after development and independent review are complete');
    const freeze = await createFreeze();
    console.log(JSON.stringify({ status: 'FROZEN', dev: freeze.dev, holdout: freeze.holdout, frozen_files: Object.keys(freeze.files).length, inference: false, training: false }));
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', error: error.message })); process.exitCode = 1; }
}
