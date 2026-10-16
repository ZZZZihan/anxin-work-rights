/** Offline evaluation only. Gold labels never enter the production search function. */
import { searchPublicKnowledge } from './public-retrieval';
import type { KnowledgeSearch, KnowledgeSearchOptions, KnowledgeTopic } from './public-retrieval-types';

const ANNOTATION = 'agent_curated_not_legal_expert_reviewed';
export type EvaluationTask = {
  id: string;
  taskType: 'case_retrieval' | 'provision_retrieval' | 'no_answer';
  split: 'dev' | 'test';
  groupId: string;
  query: string;
  topic?: KnowledgeTopic;
  expectedRecordIds: string[];
  expectedCitationRefs: string[];
  annotationStatus: typeof ANNOTATION;
  rationale: string;
};
export type EvaluationCorpus = {
  fingerprint: string;
  records: { id: string; kind: 'case' | 'provision'; groupId: string; sourceId: string; refs: string[] }[];
  sources: { id: string; url: string; paragraphs: { id: string; text: string }[] }[];
};
export type Search = (query: string, options: KnowledgeSearchOptions) => KnowledgeSearch;

function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim())
    && new Set(value).size === value.length;
}

export function validateEvaluationTasks(input: unknown, corpus: EvaluationCorpus): EvaluationTask[] {
  requireValid(Array.isArray(input) && input.length > 0, 'tasks must be a nonempty array');
  const records = new Map(corpus.records.map((record) => [record.id, record]));
  const paragraphs = new Map(corpus.sources.flatMap((source) => source.paragraphs.map((p) => [p.id, source.id])));
  const ids = new Set<string>();
  const queries = new Set<string>();
  const splitByGroup = new Map<string, string>();
  const splitByRecord = new Map<string, string>();
  const allowed = new Set(['id', 'taskType', 'split', 'groupId', 'query', 'topic', 'expectedRecordIds',
    'expectedCitationRefs', 'annotationStatus', 'rationale']);
  for (const raw of input) {
    requireValid(raw && typeof raw === 'object' && !Array.isArray(raw), 'task must be an object');
    const task = raw as EvaluationTask;
    requireValid(Object.keys(raw).every((key) => allowed.has(key)), `${task.id}: unknown task field`);
    for (const key of ['id', 'groupId', 'query', 'rationale'] as const) {
      requireValid(typeof task[key] === 'string' && task[key].trim(), `task has missing ${key}`);
    }
    requireValid(task.query.length <= 60000, `${task.id}: query exceeds production input limit`);
    requireValid(['case_retrieval', 'provision_retrieval', 'no_answer'].includes(task.taskType), `${task.id}: invalid taskType`);
    requireValid(['dev', 'test'].includes(task.split), `${task.id}: invalid split`);
    requireValid(task.annotationStatus === ANNOTATION, `${task.id}: unsupported annotation status`);
    requireValid(task.topic === undefined || ['wage_arrears', 'employment_relationship'].includes(task.topic), `${task.id}: invalid topic`);
    requireValid(strings(task.expectedRecordIds) && strings(task.expectedCitationRefs), `${task.id}: invalid or duplicate gold labels`);
    requireValid(!ids.has(task.id), `${task.id}: duplicate task id`);
    ids.add(task.id);
    const query = task.query.normalize('NFKC').replace(/[\s\p{P}]/gu, '').toLocaleLowerCase('zh-CN');
    requireValid(query && !queries.has(query), `${task.id}: duplicate normalized query`);
    queries.add(query);
    const groupKey = `${task.taskType}:${task.groupId}`;
    requireValid(!splitByGroup.has(groupKey) || splitByGroup.get(groupKey) === task.split, `${task.id}: group split leakage`);
    splitByGroup.set(groupKey, task.split);
    if (task.taskType === 'no_answer') {
      requireValid(task.expectedRecordIds.length === 0 && task.expectedCitationRefs.length === 0, `${task.id}: no_answer must have no gold`);
      continue;
    }
    requireValid(task.expectedRecordIds.length && task.expectedCitationRefs.length, `${task.id}: retrieval needs gold records and citations`);
    const goldRefs = new Set<string>();
    for (const id of task.expectedRecordIds) {
      const record = records.get(id);
      requireValid(record, `${task.id}: unknown gold record ${id}`);
      requireValid(record.kind === (task.taskType === 'case_retrieval' ? 'case' : 'provision'), `${task.id}: gold record kind mismatch`);
      if (task.taskType === 'case_retrieval') {
        requireValid(record.groupId === task.groupId, `${task.id}: groupId differs from source case group`);
      }
      const sourceGroup = `${task.taskType}:${record.groupId}`;
      requireValid(!splitByGroup.has(sourceGroup) || splitByGroup.get(sourceGroup) === task.split,
        `${task.id}: gold source group split leakage`);
      splitByGroup.set(sourceGroup, task.split);
      requireValid(!splitByRecord.has(id) || splitByRecord.get(id) === task.split, `${task.id}: gold record split leakage`);
      splitByRecord.set(id, task.split);
      requireValid(task.expectedCitationRefs.some((ref) => record.refs.includes(ref)), `${task.id}: gold record lacks supporting citation`);
      for (const ref of record.refs) {
        requireValid(paragraphs.get(ref) === record.sourceId, `${task.id}: corpus reference crosses source`);
        goldRefs.add(ref);
      }
    }
    requireValid(task.expectedRecordIds.some((id) => records.get(id)!.groupId === task.groupId),
      `${task.id}: groupId differs from every gold source group`);
    requireValid(task.expectedCitationRefs.every((ref) => goldRefs.has(ref)), `${task.id}: gold citation outside gold records`);
  }
  return input as EvaluationTask[];
}

export function validateEvaluationManifest(input: unknown, tasks: EvaluationTask[], fingerprint: string, tasksSha256: string) {
  requireValid(input && typeof input === 'object', 'missing evaluation manifest');
  const manifest = input as {
    datasetId: string; schemaVersion: number; tasksFile: string; tasksSha256: string;
    annotationStatus: string; sourceDataFingerprint: string;
    counts: { tasks: number; groups: number; byTaskType: Record<string, number>; bySplit: Record<string, number> };
    caseTestGroups: string[]; provisionTestGroups: string[]; noAnswerTestGroups: string[];
  };
  requireValid(manifest.datasetId === 'anxin-labor-eval-v1' && manifest.schemaVersion === 1
    && manifest.tasksFile === 'tasks.jsonl' && manifest.annotationStatus === ANNOTATION, 'unsupported evaluation manifest');
  requireValid(manifest.tasksSha256 === tasksSha256, 'frozen task hash mismatch; document annotation changes before refreezing');
  requireValid(manifest.sourceDataFingerprint === fingerprint, 'evaluation manifest corpus fingerprint mismatch');
  requireValid(manifest.counts?.tasks === tasks.length && manifest.counts.groups === new Set(tasks.map((task) => `${task.taskType}:${task.groupId}`)).size,
    'evaluation manifest task/group counts mismatch');
  for (const [field, taskField] of [['byTaskType', 'taskType'], ['bySplit', 'split']] as const) {
    const actual: Record<string, number> = {};
    tasks.forEach((task) => { actual[task[taskField]] = (actual[task[taskField]] ?? 0) + 1; });
    const declared = manifest.counts[field];
    requireValid(declared && Object.keys(declared).length === Object.keys(actual).length
      && Object.entries(actual).every(([key, count]) => declared[key] === count), `evaluation manifest ${field} mismatch`);
  }
  for (const [taskType, field] of [
    ['case_retrieval', 'caseTestGroups'], ['provision_retrieval', 'provisionTestGroups'], ['no_answer', 'noAnswerTestGroups'],
  ] as const) {
    const actual = [...new Set(tasks.filter((task) => task.taskType === taskType && task.split === 'test').map((task) => task.groupId))].sort();
    requireValid(strings(manifest[field]) && JSON.stringify([...manifest[field]].sort()) === JSON.stringify(actual),
      `evaluation manifest ${field} mismatch`);
  }
}

function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, value: denominator ? Number((numerator / denominator).toFixed(6)) : null };
}

export function evaluateRetrieval(tasks: EvaluationTask[], corpus: EvaluationCorpus, search: Search = searchPublicKnowledge) {
  validateEvaluationTasks(tasks, corpus);
  const records = new Map(corpus.records.map((record) => [record.id, record]));
  const sources = new Map(corpus.sources.map((source) => [source.id, source]));
  const paragraphs = new Map(corpus.sources.flatMap((source) => source.paragraphs.map((p) => [p.id, p.text])));
  const results = tasks.map((task) => {
    // Match current HTTP entry points: only query and the same top-K, without annotation-supplied topic hints.
    const response = search(task.query, { limit: 6 });
    requireValid(response.fingerprint === corpus.fingerprint, `${task.id}: search index fingerprint differs from corpus`);
    requireValid(response.hits.length <= 6, `${task.id}: search exceeded top 6`);
    const ids = response.hits.map((hit) => hit.id);
    requireValid(new Set(ids).size === ids.length, `${task.id}: duplicate returned record`);
    // Structural provenance is a hard data-integrity gate, not a semantic correctness score.
    for (const hit of response.hits) {
      const record = records.get(hit.id);
      requireValid(record && record.kind === hit.kind, `${task.id}: returned unknown record or wrong kind`);
      requireValid(hit.citations.length > 0, `${task.id}: returned record has no citations`);
      requireValid(new Set(hit.citations.map((citation) => citation.paragraphId)).size === hit.citations.length,
        `${task.id}: duplicate returned citation`);
      for (const citation of hit.citations) {
        requireValid(record.refs.includes(citation.paragraphId) && citation.sourceId === record.sourceId
          && citation.sourceUrl === sources.get(record.sourceId)?.url
          && citation.text === paragraphs.get(citation.paragraphId), `${task.id}: invalid returned citation provenance`);
      }
    }
    const matched = task.expectedRecordIds.filter((id) => ids.includes(id));
    const firstRank = ids.findIndex((id) => task.expectedRecordIds.includes(id));
    const citations = new Set(response.hits.flatMap((hit) => hit.citations.map((citation) => citation.paragraphId)));
    const matchedRefs = task.expectedCitationRefs.filter((ref) => citations.has(ref));
    const failure = task.taskType === 'no_answer'
      ? (ids.length ? 'unexpected_results' : null)
      : (matched.length === 0 ? 'missed_all_annotated_records'
        : matched.length < task.expectedRecordIds.length ? 'missed_some_annotated_records' : null);
    return {
      taskId: task.id, taskType: task.taskType, split: task.split, topic: task.topic ?? 'unspecified', groupId: task.groupId,
      method: response.method, retrievedIds: ids, expectedRecordIds: task.expectedRecordIds,
      matchedRecordIds: matched, firstRelevantRank: firstRank < 0 ? null : firstRank + 1,
      expectedCitationRefs: task.expectedCitationRefs, matchedCitationRefs: matchedRefs,
      returnedCitations: response.hits.reduce((sum, hit) => sum + hit.citations.length, 0), failure,
    };
  });
  function summarize(rows: typeof results) {
    const positive = rows.filter((row) => row.taskType !== 'no_answer');
    const negative = rows.filter((row) => row.taskType === 'no_answer');
    const reciprocalRankSum = positive.reduce((sum, row) => sum + (row.firstRelevantRank ? 1 / row.firstRelevantRank : 0), 0);
    return {
      tasks: rows.length,
      hitAt6: ratio(positive.filter((row) => row.matchedRecordIds.length > 0).length, positive.length),
      mrrAt6: { reciprocalRankSum: Number(reciprocalRankSum.toFixed(9)), denominator: positive.length,
        value: positive.length ? Number((reciprocalRankSum / positive.length).toFixed(6)) : null },
      annotatedRecordRecallAt6: ratio(positive.reduce((sum, row) => sum + row.matchedRecordIds.length, 0),
        positive.reduce((sum, row) => sum + row.expectedRecordIds.length, 0)),
      annotatedCitationCoverageAt6: ratio(positive.reduce((sum, row) => sum + row.matchedCitationRefs.length, 0),
        positive.reduce((sum, row) => sum + row.expectedCitationRefs.length, 0)),
      noAnswerAccuracy: ratio(negative.filter((row) => row.retrievedIds.length === 0).length, negative.length),
      returnedCitationsValidated: rows.reduce((sum, row) => sum + row.returnedCitations, 0),
      failureTasks: rows.filter((row) => row.failure !== null).length,
    };
  }
  const slices = (key: 'split' | 'taskType' | 'topic') => Object.fromEntries(
    [...new Set(results.map((row) => row[key]))].sort().map((value) => [value, summarize(results.filter((row) => row[key] === value))]),
  );
  return { topK: 6, overall: summarize(results), bySplit: slices('split'), byTaskType: slices('taskType'), byTopic: slices('topic'), results };
}
