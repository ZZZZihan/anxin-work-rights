import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseAmount, validateCandidateOutput } from '../../lib/material-facts.ts';

const numericKinds = new Set(['monthly_rate', 'due_total', 'paid_total', 'arrears', 'award', 'payment', 'other_amount']);
const canonical = c => numericKinds.has(c.kind) ? parseAmount(c.value)?.amount ?? c.value : c.value;
const basic = (a, b) => a?.kind === b.kind && canonical(a) === canonical(b);
const semantic = (a, b) => basic(a, b) && ['subject', 'period', 'qualifier', 'assertion'].every(k => a[k] === b[k]);
const variants = (label, index) => [label.expected[index], ...(label.acceptable_alternatives ?? []).filter(item => item.expected_index === index).flatMap(item => item.candidates)];

/** Maximum bipartite matching: duplicates cannot inflate recall. */
export function matchCandidates(candidates, label, predicate) {
  const owners = new Map();
  function augment(index, visited) {
    for (let target = 0; target < label.expected.length; target++) {
      if (visited.has(target) || !variants(label, target).some(expected => predicate(candidates[index], expected))) continue;
      visited.add(target);
      if (!owners.has(target) || augment(owners.get(target), visited)) { owners.set(target, index); return true; }
    }
    return false;
  }
  candidates.forEach((_, index) => augment(index, new Set()));
  const pairs = [...owners].map(([expected, actual]) => ({ expected, actual }));
  return { tp: pairs.length, fp: candidates.length - pairs.length, fn: label.expected.length - pairs.length, pairs,
    missing: label.expected.map((_, index) => index).filter(index => !owners.has(index)),
    extra: candidates.map((_, index) => index).filter(index => !pairs.some(pair => pair.actual === index)) };
}

export function assessCase(input, label, result) {
  const errors = [], complete = !!result && result.finish_reason === 'stop';
  let raw = [], accepted = [], rejected = [], protocol = false;
  if (result) {
    try { const parsed = JSON.parse(result.raw_output); if (Array.isArray(parsed.candidates)) raw = parsed.candidates; } catch { errors.push('invalid_json'); }
    try { const batch = validateCandidateOutput(result.raw_output, input.source); accepted = batch.candidates; rejected = batch.rejected; protocol = true; }
    catch { errors.push('invalid_protocol'); }
    if (!complete) errors.push(`incomplete:${result.finish_reason}`);
  } else errors.push('missing_request');
  // Incomplete generation is not accepted as a successful business response even if parseable.
  const rawBasic = matchCandidates(raw, label, basic);
  const acceptedBasic = matchCandidates(complete ? accepted : [], label, basic);
  const acceptedStrict = matchCandidates(complete ? accepted : [], label, semantic);
  const attributeErrors = acceptedBasic.pairs.map(pair => {
    const actual = accepted[pair.actual];
    const options = label.expected.flatMap((_, i) => variants(label, i)).filter(v => basic(actual, v));
    const choices = options.map(v => ['subject', 'period', 'qualifier', 'assertion'].filter(key => actual[key] !== v[key]));
    const mismatches = choices.sort((a, b) => a.length - b.length)[0] ?? [];
    return { ...pair, kind: actual.kind, value: actual.value, mismatches };
  }).filter(item => item.mismatches.length);

  return { id: input.id, completed: complete, protocol, raw_count: raw.length, accepted_count: accepted.length, rejected,
    raw_basic: rawBasic, accepted_basic: acceptedBasic, accepted_strict: acceptedStrict, attribute_errors: attributeErrors, errors,
    exact_document: complete && protocol && acceptedStrict.fp === 0 && acceptedStrict.fn === 0 && rejected.length === 0 };
}

export function assess(inputs, labels, results) {
  if (new Set(inputs.map(r => r.id)).size !== inputs.length || new Set(labels.map(r => r.id)).size !== labels.length || new Set(results.map(r => r.id)).size !== results.length) throw new Error('Duplicate IDs');
  if (inputs.length !== labels.length || inputs.some(input => !labels.some(label => label.id === input.id)) || results.some(result => !inputs.some(input => input.id === result.id))) throw new Error('Dataset/result IDs mismatch');
  const cases = inputs.map(input => assessCase(input, labels.find(row => row.id === input.id), results.find(row => row.id === input.id)));
  const metrics = {};
  for (const mode of ['raw_basic', 'accepted_basic', 'accepted_strict']) {
    const total = cases.reduce((sum, row) => ({ tp: sum.tp + row[mode].tp, fp: sum.fp + row[mode].fp, fn: sum.fn + row[mode].fn }), { tp: 0, fp: 0, fn: 0 });
    metrics[mode] = { ...total, precision: total.tp + total.fp ? total.tp / (total.tp + total.fp) : null, recall: total.tp + total.fn ? total.tp / (total.tp + total.fn) : null, f1: 2 * total.tp + total.fp + total.fn ? 2 * total.tp / (2 * total.tp + total.fp + total.fn) : null };
  }
  return { planned_documents: inputs.length, returned: results.length, completed: cases.filter(r => r.completed).length, protocol_valid: cases.filter(r => r.protocol).length,
    exact_documents: cases.filter(r => r.exact_document).length, raw_candidates: cases.reduce((s, r) => s + r.raw_count, 0), rejected_candidates: cases.reduce((s, r) => s + r.rejected.length, 0), metrics, cases };
}
const jsonl = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputs, labels, results, output] = process.argv.slice(2);
  const report = assess(await jsonl(inputs), await jsonl(labels), await jsonl(results));
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
}
