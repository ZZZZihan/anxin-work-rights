import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = fileURLToPath(new URL('./', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path));
const jsonl = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const prior = await json(resolve(base, 'prior-artifacts.json'));
const freeze = await json(resolve(base, 'freeze.json'));
for (const manifest of [prior, freeze]) {
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(sha(await readFile(resolve(root, file))), hash, file);
}
execFileSync(process.execPath, [resolve(root, 'experiments/material-facts-v4/verify.mjs')], { stdio: 'pipe' });
if (!process.argv.includes('--preflight')) {
  const manifest = await json(resolve(base, 'result-manifest.json'));
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(sha(await readFile(resolve(base, file))), hash, file);
  for (const backend of ['rules', 'qwen', 'deepseek']) {
    const dir = resolve(base, 'results', `${backend}-1`);
    const protocol = await json(resolve(dir, 'protocol.json'));
    assert.equal(protocol.mode, 'replication');
    assert.equal(protocol.training, false);
    assert.equal(protocol.input_sha256, freeze.input_sha256);
    assert.equal(sha(await readFile(resolve(dir, 'messages.jsonl'))), freeze.messages_sha256);
    assert.deepEqual(protocol.case_ids, freeze.case_ids);
    for (const [file, hash] of Object.entries(protocol.hashes)) assert.equal(hash, freeze.files[file], file);
    const rows = await jsonl(resolve(dir, 'results.jsonl'));
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert(rows.every(row => freeze.case_ids.includes(row.id)));
    if (backend === 'rules') continue;
    const events = await jsonl(resolve(dir, 'events.jsonl'));
    if (backend === 'qwen') {
      for (const event of events.filter(row => row.type === 'load')) {
        assert.equal(event.model.repository, freeze.qwen.repository);
        assert.equal(event.model.revision, freeze.qwen.revision);
        assert.deepEqual(event.packages, freeze.qwen.packages);
        assert.equal(event.model.source_manifest_sha256, freeze.qwen['source-manifest.json'].sha256);
        assert.equal(event.model.weights_verification_sha256, freeze.qwen['weights-verification.json'].sha256);
      }
      for (const row of rows.filter(row => ['stop', 'length'].includes(row.finish_reason))) {
        for (const type of ['load', 'generating', 'wired_policy']) assert.equal(events.filter(event => event.type === type && event.id === row.id).length, 1, `Missing/duplicate ${type}: ${row.id}`);
      }
      for (const event of events.filter(row => row.type === 'wired_policy')) {
        assert.equal(event.wired_observed_bytes, 20 * 1024 ** 3);
      }
    } else {
      const transport = await jsonl(resolve(dir, 'transport-attempts.jsonl'));
      assert.deepEqual(transport, events.filter(row => row.type === 'transport'));
      for (const id of freeze.case_ids) {
        const attempts = transport.filter(row => row.id === id);
        assert(attempts.filter(row => row.event === 'send_started').length <= 1);
        assert(attempts.filter(row => row.event === 'transport_attempt').length <= 3);
      }
      assert.equal((await json(resolve(dir, 'egress.json'))).ssh_closed, true);
    }
  }
  execFileSync(process.execPath, [resolve(base, 'analyze.mjs'), '--check'], { stdio: 'pipe' });
}
console.log(JSON.stringify({ status: 'PASS', old_files_unchanged: Object.keys(prior.files).length,
  frozen_new_files: Object.keys(freeze.files).length, inference: false, training: false }));
