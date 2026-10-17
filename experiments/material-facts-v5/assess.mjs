import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseCandidateOutput, validateCandidateOutput, getCandidateRepresentation, normalizeCandidateValue } from '../../lib/material-facts-v2.ts';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function canonical(candidate) {
  if (!object(candidate) || !['money', 'date'].includes(candidate.kind) || typeof candidate.value !== 'string') return null;
  try { return normalizeCandidateValue(candidate).value; } catch { return null; }
}
const sameValue = (a, b) => canonical(a) !== null && canonical(b) !== null && a.kind === b.kind && canonical(a) === canonical(b);
const basic = (a, b) => sameValue(a, b) && a.meaning === b.meaning && (a.meaning !== 'rate' || a.rateUnit === b.rateUnit);
const semanticKeys = ['subject', 'scope', 'period', 'completeness', 'assertion'];
const strict = (a, b) => basic(a, b) && semanticKeys.every(key => a[key] === b[key]);
const variants = (label, index) => [label.expected[index], ...(label.acceptable_alternatives ?? []).filter(item => item.expected_index === index).flatMap(item => item.candidates)];

export function match(candidates, label, predicate) {
  const owners = new Map();
  function augment(actual, visited) {
    for (let expected = 0; expected < label.expected.length; expected++) {
      if (visited.has(expected) || !variants(label, expected).some(value => predicate(candidates[actual], value))) continue;
      visited.add(expected);
      if (!owners.has(expected) || augment(owners.get(expected), visited)) { owners.set(expected, actual); return true; }
    }
    return false;
  }
  candidates.forEach((_, index) => augment(index, new Set()));
  const pairs = [...owners].map(([expected, actual]) => ({ expected, actual }));
  return { tp: pairs.length, fp: candidates.length - pairs.length, fn: label.expected.length - pairs.length, pairs,
    missing: label.expected.map((_, i) => i).filter(i => !owners.has(i)), extra: candidates.map((_, i) => i).filter(i => !pairs.some(pair => pair.actual === i)) };
}

function focusConfusions(candidates, label) {
  // First consume correct semantic matches: repeated amounts must not create
  // invented cross-person errors. Diagnose only unique remaining value pairs.
  const correct = match(candidates, label, strict);
  const choices = correct.extra.map(actual => ({ actual, expected: correct.missing.filter(index => variants(label, index).some(expected => sameValue(candidates[actual], expected))) }));
  return choices.flatMap(choice => {
    if (choice.expected.length !== 1 || choices.some(other => other.actual !== choice.actual && other.expected.includes(choice.expected[0]))) {
      return choice.expected.length ? [{ actual: choice.actual, possible_expected: choice.expected, ambiguous: true, errors: [] }] : [];
    }
    const pair = { actual: choice.actual, expected: choice.expected[0] };
    const actual = candidates[pair.actual];
    const options = variants(label, pair.expected);
    const errors = [];
    if (actual.scope === 'individual' && options.every(expected => expected.scope === 'group')) errors.push('group_as_individual');
    if (actual.meaning === 'paid_total' && options.every(expected => expected.meaning === 'payment' && expected.completeness === 'partial')) errors.push('payment_as_paid_total');
    if (['employment_period', 'contract_performance'].includes(actual.meaning) && options.every(expected => expected.meaning === 'contract_signing')) errors.push('signing_as_work_or_performance');
    return errors.length ? [{ ...pair, errors }] : [];
  });
}

export function assessCase(input, label, result) {
  const completed = result?.finish_reason === 'stop';
  let raw = [], accepted = [], rejected = [], format = null, protocol = false, nativeJson = false, reviewIssues = [];
  const errors = [];
  if (!result) errors.push('missing_request');
  else {
    try { JSON.parse(result.raw_output); nativeJson = true; } catch { /* separately measured native JSON */ }
    try {
      const parsed = parseCandidateOutput(result.raw_output);
      format = parsed.format;
      if (Array.isArray(parsed.parsed?.candidates)) raw = parsed.parsed.candidates;
    } catch { errors.push('invalid_json'); }
    try {
      const batch = validateCandidateOutput(result.raw_output, input.source);
      protocol = true; rejected = batch.rejected;
      if (completed) {
        accepted = batch.candidates.map(getCandidateRepresentation);
        reviewIssues = batch.candidates.flatMap((candidate, index) => (candidate.reviewIssues ?? []).map(issue => ({ index, ...issue })));
      }
    } catch { errors.push('invalid_protocol'); }
    if (!completed) errors.push(`incomplete:${result.finish_reason}`);
  }
  const acceptedBasic = match(accepted, label, basic), acceptedStrict = match(accepted, label, strict);
  return { id: input.id, completed, native_json: nativeJson, format, protocol, raw_count: raw.length, accepted_count: accepted.length, rejected, review_issues: reviewIssues,
    raw_basic: match(raw, label, basic), raw_strict: match(raw, label, strict), accepted_basic: acceptedBasic, accepted_strict: acceptedStrict,
    focus_confusions: { raw: focusConfusions(raw, label), accepted: focusConfusions(accepted, label) },
    attribute_errors: acceptedStrict.extra.flatMap(actualIndex => {
      const possible = acceptedStrict.missing.filter(index => variants(label, index).some(option => basic(accepted[actualIndex], option)));
      if (!possible.length) return [];
      const unique = possible.length === 1 && !acceptedStrict.extra.some(other => other !== actualIndex && variants(label, possible[0]).some(option => basic(accepted[other], option)));
      if (!unique) return [{ actual: actualIndex, possible_expected: possible, ambiguous: true, mismatches: [] }];
      const pair = { actual: actualIndex, expected: possible[0] };
      const actual = accepted[pair.actual];
      const choices = variants(label, pair.expected).filter(option => basic(actual, option)).map(option => semanticKeys.filter(key => actual[key] !== option[key]));
      const mismatches = choices.sort((a, b) => a.length - b.length)[0] ?? [];
      return mismatches.length ? [{ ...pair, mismatches }] : [];
    }), errors, exact_document: completed && protocol && acceptedStrict.fp === 0 && acceptedStrict.fn === 0 && rejected.length === 0 };
}

export function assess(inputs, labels, results) {
  if ([inputs, labels, results].some(rows => new Set(rows.map(row => row.id)).size !== rows.length)) throw new Error('Duplicate IDs');
  if (inputs.length !== labels.length || inputs.some(input => !labels.some(label => label.id === input.id)) || results.some(result => !inputs.some(input => input.id === result.id))) throw new Error('IDs mismatch');
  const cases = inputs.map(input => assessCase(input, labels.find(label => label.id === input.id), results.find(result => result.id === input.id)));
  const metrics = {};
  for (const mode of ['raw_basic', 'raw_strict', 'accepted_basic', 'accepted_strict']) {
    const total = cases.reduce((sum, row) => ({ tp: sum.tp + row[mode].tp, fp: sum.fp + row[mode].fp, fn: sum.fn + row[mode].fn }), { tp: 0, fp: 0, fn: 0 });
    metrics[mode] = { ...total, precision: total.tp + total.fp ? total.tp / (total.tp + total.fp) : null, recall: total.tp + total.fn ? total.tp / (total.tp + total.fn) : null,
      f1: 2 * total.tp + total.fp + total.fn ? 2 * total.tp / (2 * total.tp + total.fp + total.fn) : null };
  }
  return { planned_documents: inputs.length, expected_facts: labels.reduce((n, label) => n + label.expected.length, 0), returned: results.length,
    completed: cases.filter(row => row.completed).length, native_json: cases.filter(row => row.native_json).length, protocol_valid: cases.filter(row => row.protocol).length,
    exact_documents: cases.filter(row => row.exact_document).length, raw_candidates: cases.reduce((n, row) => n + row.raw_count, 0),
    accepted_candidates: cases.reduce((n, row) => n + row.accepted_count, 0), rejected_candidates: cases.reduce((n, row) => n + row.rejected.length, 0),
    review_issues: cases.reduce((n, row) => n + row.review_issues.length, 0), metrics, cases };
}
export const readJsonl = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, labels, results, output] = process.argv.slice(2);
  const report = assess(await readJsonl(input), await readJsonl(labels), await readJsonl(results));
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
}
