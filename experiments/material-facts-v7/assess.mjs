import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseCandidateOutput, validateCandidateOutput, getCandidateRepresentation } from '../../lib/material-facts-v3.ts';
import { validateRuntimeCandidateOutput } from '../../lib/material-fact-runtime-ingest.ts';
import { reviewCandidateAgainstSource } from '../../lib/material-fact-source-review.ts';
import { canonicalMonetaryExpression, classifyMonetaryExpression } from '../../lib/material-money-v4.ts';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const semanticKeys = ['subject', 'scope', 'period', 'completeness', 'assertion'];
const modes = ['basic', 'relational', 'strict'];
const variants = (label, index) => [label.expected[index], ...(label.acceptable_alternatives ?? []).filter(item => item.expected_index === index).flatMap(item => item.candidates)];
const contains = (a, b) => a.start <= b.start && a.end >= b.end;

// An event anchor is evidence for a monetary/date fragment, not permission to
// replace that fragment with arbitrary surrounding narrative. Preserve offsets;
// these finite wrappers affect alignment only, never value/attribute equality.
function permittedContainment(kind, position, anchor, text) {
  if (!contains(anchor, position) && !contains(position, anchor)) return false;
  const outer = contains(anchor, position) ? anchor : position;
  const inner = outer === anchor ? position : anchor;
  const points = Array.from(text);
  const before = points.slice(outer.start, inner.start).join('');
  const after = points.slice(inner.end, outer.end).join('');
  if (kind === 'money') return /^\s*(?:(?:人民[币幣]|RMB|CNY|[¥￥])\s*)?$/iu.test(before)
    && /^\s*(?:整|正)?\s*(?:(?:工[资資]|[劳勞][务務][费費]|[劳勞][动動][报報]酬)\s*)?$/u.test(after);
  // Fold only the finite date boundary view. The original source, value,
  // quote and code-point offsets, and literal date equality remain unchanged.
  const dateBoundary = value => value.replace(/[從後間]/gu, glyph => ({ 從: '从', 後: '后', 間: '间' })[glyph]);
  return /^\s*(?:自|从|截至)?\s*$/u.test(dateBoundary(before))
    && /^\s*(?:起|止|前|后|间|期间)?\s*$/u.test(dateBoundary(after));
}

function canonical(candidate) {
  if (!object(candidate) || !['money', 'date'].includes(candidate.kind) || typeof candidate.value !== 'string') return null;
  if (candidate.kind === 'date') return `date:${candidate.value}`;
  if (classifyMonetaryExpression(candidate.value).kind === 'not_monetary') return null;
  // Unsupported/complex literal equality is still observable extraction evidence;
  // it never creates a calculation amount or makes an approximate value exact.
  return canonicalMonetaryExpression(candidate.value) ?? `literal:${candidate.value}`;
}
const basic = (a, b) => canonical(a) !== null && a.kind === b.kind && canonical(a) === canonical(b)
  && a.meaning === b.meaning && (a.meaning !== 'rate' || a.rateUnit === b.rateUnit);
const relational = (a, b) => basic(a, b) && semanticKeys.filter(key => key !== 'assertion').every(key => a[key] === b[key]);
const strict = (a, b) => relational(a, b) && a.assertion === b.assertion;
const predicates = { basic, relational, strict };

function validLiteral(candidate, source) {
  try { return validateCandidateOutput(JSON.stringify({ schemaVersion: 3, candidates: [candidate] }), source).candidates.length === 1; }
  catch { return false; }
}

/** All positions are Unicode code points in the unmodified source. Neither model
 * attributes nor a gold amount is used to select one of several possible quotes.
 */
export function resolveCandidateEvent(candidate, input, label) {
  if (!validLiteral(candidate, input.source)) return { status: 'invalid_evidence', event: null, positions: [] };
  const block = input.source.blocks.find(row => row.id === candidate.blockId);
  const positions = [];
  for (let q = block.text.indexOf(candidate.quote); q >= 0; q = block.text.indexOf(candidate.quote, q + 1)) {
    for (let v = candidate.quote.indexOf(candidate.value); v >= 0; v = candidate.quote.indexOf(candidate.value, v + 1)) {
      positions.push({ blockId: block.id, start: Array.from(block.text.slice(0, q + v)).length,
        end: Array.from(block.text.slice(0, q + v + candidate.value.length)).length });
    }
  }
  const possibleEvents = new Set();
  for (const position of positions) {
    const matched = label.events.filter(event => event.anchors.some(anchor => anchor.blockId === position.blockId
      && permittedContainment(candidate.kind, position, anchor, block.text)));
    if (matched.length !== 1) return { status: matched.length ? 'ambiguous_event' : 'unregistered_position', event: null, positions };
    possibleEvents.add(matched[0].id);
  }
  if (!positions.length || possibleEvents.size !== 1) return { status: 'ambiguous_event', event: null, positions };
  return { status: 'aligned', event: [...possibleEvents][0], positions };
}

export function validateLabel(input, label) {
  assert(object(label) && Array.isArray(label.expected) && Array.isArray(label.events), 'Missing expected facts or events');
  assert(Array.isArray(label.expected_event_ids) && label.expected_event_ids.length === label.expected.length, 'Expected event identity count differs');
  assert.equal(new Set(label.events.map(event => event.id)).size, label.events.length, 'Duplicate event IDs');
  for (const event of label.events) {
    assert(typeof event.id === 'string' && event.id.length > 0 && Array.isArray(event.anchors) && event.anchors.length > 0, 'Invalid source event');
    for (const anchor of event.anchors) {
      const block = input.source.blocks.find(row => row.id === anchor.blockId);
      assert(block && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0
        && anchor.start < anchor.end && anchor.end <= Array.from(block.text).length, 'Invalid code-point event anchor');
      assert(!label.events.some(other => other.id !== event.id && other.anchors.some(candidate => candidate.blockId === anchor.blockId
        && candidate.start < anchor.end && anchor.start < candidate.end)), 'Different source events have overlapping anchors');
    }
  }
  for (const alternative of label.acceptable_alternatives ?? []) assert(Number.isInteger(alternative.expected_index)
    && alternative.expected_index >= 0 && alternative.expected_index < label.expected.length
    && Array.isArray(alternative.candidates) && alternative.candidates.length > 0, 'Invalid predeclared alternatives');
  label.expected.forEach((_, index) => {
    assert(label.events.some(event => event.id === label.expected_event_ids[index]), 'Expected fact has no registered event');
    for (const candidate of variants(label, index)) {
      const resolved = resolveCandidateEvent(candidate, input, label);
      assert.equal(resolved.event, label.expected_event_ids[index], `Label/alternative does not uniquely support its registered event: ${index}`);
      assert(canonical(candidate) !== null, `Label is not a monetary/date expression: ${index}`);
    }
  });
}

/** Maximum one-to-one matching; an extra duplicate remains an extra prediction. */
export function match(candidates, label, predicate, events) {
  assert(Array.isArray(events) && events.length === candidates.length, 'Event binding is required for every prediction');
  const owners = new Map();
  function augment(actual, visited) {
    for (let expected = 0; expected < label.expected.length; expected++) {
      if (visited.has(expected) || events[actual]?.event !== label.expected_event_ids[expected]
        || !variants(label, expected).some(value => predicate(candidates[actual], value))) continue;
      visited.add(expected);
      if (!owners.has(expected) || augment(owners.get(expected), visited)) { owners.set(expected, actual); return true; }
    }
    return false;
  }
  candidates.forEach((_, index) => augment(index, new Set()));
  const pairs = [...owners].map(([expected, actual]) => ({ expected, actual, event: label.expected_event_ids[expected] }));
  return { tp: pairs.length, fp: candidates.length - pairs.length, fn: label.expected.length - pairs.length, pairs,
    missing: label.expected.map((_, i) => i).filter(i => !owners.has(i)), extra: candidates.map((_, i) => i).filter(i => !pairs.some(pair => pair.actual === i)) };
}

export function assessCase(input, label, result) {
  validateLabel(input, label);
  const completed = result?.finish_reason === 'stop';
  let raw = [], accepted = [], rejected = [], format = null, protocol = false, nativeJson = false;
  let reviewIssues = [], coverage = null, normalization = [], productionDefense = [];
  const errors = [];
  if (!result) errors.push('missing_request');
  else {
    try { JSON.parse(result.raw_output); nativeJson = true; } catch { /* Raw format is a separate observation. */ }
    try {
      const parsed = parseCandidateOutput(result.raw_output);
      format = parsed.format;
      if (Array.isArray(parsed.parsed?.candidates)) raw = parsed.parsed.candidates;
    } catch { errors.push('invalid_json'); }
    try {
      const batch = validateRuntimeCandidateOutput(result.raw_output, input.source);
      protocol = true; rejected = batch.rejected;
      if (completed) {
        coverage = batch.coverage;
        accepted = batch.candidates.map(getCandidateRepresentation);
        const reviewed = batch.candidates.map(candidate => reviewCandidateAgainstSource(candidate, input.source));
        normalization = reviewed.filter(candidate => candidate.representation.kind === 'money').map(candidate => ({ id: candidate.id, ...candidate.normalization }));
        reviewIssues = reviewed.flatMap((candidate, index) => (candidate.reviewIssues ?? []).map(issue => ({ index, ...issue })));
        productionDefense = reviewed.map((candidate, index) => ({ index, kind: candidate.representation.kind,
          amount: candidate.amount, normalization: candidate.normalization.status, issues: candidate.reviewIssues.map(issue => issue.code),
          exact_money_without_review_issue: candidate.representation.kind === 'money' && candidate.amount !== null && !candidate.reviewIssues.length,
          calculation_authorized: false }));
      }
    } catch { errors.push('invalid_protocol'); }
    if (!completed) errors.push(`incomplete:${result.finish_reason}`);
  }
  // A malformed candidate is still counted in raw FP. A malformed envelope cannot
  // grant matches merely because its nested array happened to be readable.
  const rawEvents = raw.map(candidate => protocol ? resolveCandidateEvent(candidate, input, label)
    : { status: 'invalid_protocol', event: null, positions: [] });
  const acceptedEvents = accepted.map(candidate => resolveCandidateEvent(candidate, input, label));
  const matches = {};
  for (const mode of modes) {
    matches[`raw_${mode}`] = match(raw, label, predicates[mode], rawEvents);
    matches[`accepted_${mode}`] = match(accepted, label, predicates[mode], acceptedEvents);
  }
  const acceptedStrict = matches.accepted_strict;
  const attributeErrors = acceptedStrict.extra.flatMap(actual => {
    const possible = acceptedStrict.missing.filter(index => acceptedEvents[actual].event === label.expected_event_ids[index]
      && variants(label, index).some(option => basic(accepted[actual], option)));
    if (!possible.length) return [];
    if (possible.length !== 1 || acceptedStrict.extra.some(other => other !== actual
      && acceptedEvents[other].event === label.expected_event_ids[possible[0]] && variants(label, possible[0]).some(option => basic(accepted[other], option))))
      return [{ actual, possible_expected: possible, ambiguous: true, mismatches: [] }];
    const choices = variants(label, possible[0]).filter(option => basic(accepted[actual], option))
      .map(option => semanticKeys.filter(key => accepted[actual][key] !== option[key]));
    return [{ actual, expected: possible[0], event: acceptedEvents[actual].event, mismatches: choices.sort((a, b) => a.length - b.length)[0] ?? [] }];
  });
  return { id: input.id, completed, native_json: nativeJson, format, protocol, raw_count: raw.length, accepted_count: accepted.length,
    rejected, review_issues: reviewIssues, coverage, normalization, ...matches,
    event_alignment: { raw: rawEvents, accepted: acceptedEvents }, production_defense: productionDefense,
    attribute_errors: attributeErrors, errors, exact_document: completed && protocol && acceptedStrict.fp === 0 && acceptedStrict.fn === 0 && rejected.length === 0 };
}

export function assess(inputs, labels, results) {
  if ([inputs, labels, results].some(rows => new Set(rows.map(row => row.id)).size !== rows.length)) throw new Error('Duplicate IDs');
  if (inputs.length !== labels.length || inputs.some(input => !labels.some(label => label.id === input.id)) || results.some(result => !inputs.some(input => input.id === result.id))) throw new Error('IDs mismatch');
  const cases = inputs.map(input => assessCase(input, labels.find(label => label.id === input.id), results.find(result => result.id === input.id)));
  const metrics = {};
  for (const mode of modes.flatMap(mode => [`raw_${mode}`, `accepted_${mode}`])) {
    const total = cases.reduce((sum, row) => ({ tp: sum.tp + row[mode].tp, fp: sum.fp + row[mode].fp, fn: sum.fn + row[mode].fn }), { tp: 0, fp: 0, fn: 0 });
    metrics[mode] = { ...total, precision: total.tp + total.fp ? total.tp / (total.tp + total.fp) : null,
      recall: total.tp + total.fn ? total.tp / (total.tp + total.fn) : null,
      f1: 2 * total.tp + total.fp + total.fn ? 2 * total.tp / (2 * total.tp + total.fp + total.fn) : null };
  }
  return { planned_documents: inputs.length, expected_facts: labels.reduce((n, label) => n + label.expected.length, 0), returned: results.length,
    completed: cases.filter(row => row.completed).length, native_json: cases.filter(row => row.native_json).length,
    protocol_valid: cases.filter(row => row.protocol).length, exact_documents: cases.filter(row => row.exact_document).length,
    raw_candidates: cases.reduce((n, row) => n + row.raw_count, 0), accepted_candidates: cases.reduce((n, row) => n + row.accepted_count, 0),
    rejected_candidates: cases.reduce((n, row) => n + row.rejected.length, 0), review_issues: cases.reduce((n, row) => n + row.review_issues.length, 0),
    metrics, cases };
}
export const readJsonl = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputs, labels, results, output] = process.argv.slice(2);
  const report = assess(await readJsonl(inputs), await readJsonl(labels), await readJsonl(results));
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
}
