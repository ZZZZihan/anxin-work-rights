import { describe, expect, it, vi } from 'vitest';
import { evaluateRetrieval, validateEvaluationTasks, validateEvaluationManifest } from './retrieval-evaluation';
import type { EvaluationCorpus, EvaluationTask, Search } from './retrieval-evaluation';
import type { KnowledgeSearch } from './public-retrieval-types';

const corpus: EvaluationCorpus = {
  fingerprint: 'fixture-fingerprint',
  records: [
    { id: 'case-a', kind: 'case', groupId: 'case-group-a', sourceId: 'source-a', refs: ['p1', 'p2'] },
    { id: 'case-a-duplicate', kind: 'case', groupId: 'case-group-a', sourceId: 'source-a', refs: ['p2'] },
    { id: 'law-a:1', kind: 'provision', groupId: 'law-a', sourceId: 'source-a', refs: ['p1'] },
    { id: 'law-a:2', kind: 'provision', groupId: 'law-a', sourceId: 'source-a', refs: ['p2'] },
  ],
  sources: [{ id: 'source-a', url: 'https://example.invalid/a', paragraphs: [{ id: 'p1', text: '原文一' }, { id: 'p2', text: '原文二' }] }],
};
function task(overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id: 'task-a', taskType: 'case_retrieval', split: 'dev', groupId: 'case-group-a',
    query: '单位欠我的工资', expectedRecordIds: ['case-a'], expectedCitationRefs: ['p1'],
    annotationStatus: 'agent_curated_not_legal_expert_reviewed', rationale: '原文一涉及对应事实', ...overrides,
  };
}
function response(ids: string[] = []): KnowledgeSearch {
  return {
    method: 'deterministic_keyword_topic_v1', fingerprint: corpus.fingerprint, query: '工资', expandedTerms: [],
    hits: ids.map((id) => {
      const record = corpus.records.find((record) => record.id === id)!;
      return {
        id, kind: record.kind, title: id, summary: 'fixture', matchedTerms: [], topics: ['wage_arrears'], versionNote: '',
        annotationStatus: 'agent_curated_not_legal_expert_reviewed',
        citations: record.refs.map((ref) => ({
          paragraphId: ref, text: corpus.sources[0].paragraphs.find((p) => p.id === ref)!.text,
          sourceId: record.sourceId, sourceUrl: corpus.sources[0].url, sourceTitle: 'fixture', publisher: 'fixture',
          publishedOn: null, retrievedAt: '2026-10-16T00:00:00Z',
        })),
      };
    }),
  };
}

describe('retrieval evaluation integrity and denominators', () => {
  it('never passes gold labels, split, or rationale to production retrieval', () => {
    const search = vi.fn<Search>(() => response(['case-a']));
    const input = task({ topic: 'wage_arrears' });
    const report = evaluateRetrieval([input], corpus, search);
    expect(search.mock.calls).toEqual([[input.query, { limit: 6 }]]);
    expect(report.overall.hitAt6).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  it('keeps negative denominators separate and records misses without hiding them', () => {
    const tasks = [
      task(),
      task({ id: 'task-b', query: '报酬未到账' }),
      task({ id: 'task-c', query: '欠付劳动报酬', expectedRecordIds: ['case-a', 'case-a-duplicate'], expectedCitationRefs: ['p1', 'p2'] }),
      task({ id: 'task-d', taskType: 'no_answer', groupId: 'weather', query: '明天有雨吗', expectedRecordIds: [], expectedCitationRefs: [] }),
      task({ id: 'task-e', taskType: 'no_answer', groupId: 'weather', query: '明天温度多少', expectedRecordIds: [], expectedCitationRefs: [] }),
    ];
    const search = vi.fn<Search>()
      .mockReturnValueOnce(response(['law-a:1', 'case-a']))
      .mockReturnValueOnce(response([]))
      .mockReturnValueOnce(response(['case-a']))
      .mockReturnValueOnce(response([]))
      .mockReturnValueOnce(response(['case-a']));
    const report = evaluateRetrieval(tasks, corpus, search);
    expect(report.overall.hitAt6).toEqual({ numerator: 2, denominator: 3, value: 0.666667 });
    expect(report.overall.annotatedRecordRecallAt6).toEqual({ numerator: 2, denominator: 4, value: 0.5 });
    expect(report.overall.mrrAt6).toEqual({ reciprocalRankSum: 1.5, denominator: 3, value: 0.5 });
    expect(report.overall.noAnswerAccuracy).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(report.results.map((row) => row.failure)).toEqual([null, 'missed_all_annotated_records', 'missed_some_annotated_records', null, 'unexpected_results']);
    expect(report.byTaskType.no_answer.hitAt6.value).toBeNull();
  });

  it.each([
    { expectedRecordIds: ['missing'] },
    { expectedCitationRefs: ['nonexistent'] },
    { expectedRecordIds: ['case-a-duplicate'], expectedCitationRefs: ['p1'] },
    { taskType: 'provision_retrieval' },
    { groupId: 'fake-group' },
    { annotationStatus: 'legal_expert_reviewed' },
    { expectedRecordIds: ['case-a', 'case-a'] },
    { taskType: 'no_answer' },
    { topic: 'criminal' },
  ])('rejects corrupt labels: %j', (overrides) => {
    expect(() => validateEvaluationTasks([{ ...task(), ...overrides }], corpus)).toThrow();
  });

  it('rejects group leakage even when two tasks reference different records of the same case', () => {
    expect(() => validateEvaluationTasks([task(), task({ id: 'second', query: '追讨欠付报酬', split: 'test',
      expectedRecordIds: ['case-a-duplicate'], expectedCitationRefs: ['p2'] })], corpus)).toThrow(/group split leakage/);
  });

  it('splits provisions by law rather than allowing different articles of a law across splits', () => {
    const first = task({ taskType: 'provision_retrieval', groupId: 'law-a', expectedRecordIds: ['law-a:1'] });
    const second = { ...first, id: 'second', query: '请查另一条文', split: 'test' as const, expectedRecordIds: ['law-a:2'], expectedCitationRefs: ['p2'] };
    expect(() => validateEvaluationTasks([first, second], corpus)).toThrow(/group split leakage/);
  });

  it('rejects repeated queries despite punctuation or full-width spacing', () => {
    expect(() => validateEvaluationTasks([task(), task({ id: 'second', query: '单位，欠我的工资！　' })], corpus)).toThrow(/duplicate normalized query/);
  });

  it('binds every gold law to one split even when primary group IDs differ', () => {
    const extended: EvaluationCorpus = { ...corpus, records: [...corpus.records,
      { id: 'law-b:1', kind: 'provision', groupId: 'law-b', sourceId: 'source-a', refs: ['p2'] }] };
    const first = task({ taskType: 'provision_retrieval', groupId: 'law-a',
      expectedRecordIds: ['law-a:1', 'law-b:1'], expectedCitationRefs: ['p1', 'p2'] });
    const second = { ...first, id: 'second', query: '另部法律的其他规则', groupId: 'law-b',
      split: 'test' as const, expectedRecordIds: ['law-b:1'], expectedCitationRefs: ['p2'] };
    expect(() => validateEvaluationTasks([first, second], extended)).toThrow(/group split leakage/);
    expect(validateEvaluationTasks([first, { ...second, split: 'dev' }], extended)).toHaveLength(2);
  });

  it('rejects an index/corpus mismatch and altered source paragraphs', () => {
    expect(() => evaluateRetrieval([task()], corpus, () => ({ ...response(), fingerprint: 'stale' }))).toThrow(/fingerprint/);
    const corrupted = response(['case-a']);
    corrupted.hits[0].citations[0].text = '无来源的改写';
    expect(() => evaluateRetrieval([task()], corpus, () => corrupted)).toThrow(/provenance/);
  });

  it('rejects stale frozen hashes, source snapshots, counts and split lists before evaluating', () => {
    const manifest = {
      datasetId: 'anxin-labor-eval-v1', schemaVersion: 1, tasksFile: 'tasks.jsonl', tasksSha256: 'frozen-hash',
      annotationStatus: 'agent_curated_not_legal_expert_reviewed', sourceDataFingerprint: corpus.fingerprint,
      counts: { tasks: 1, groups: 1, byTaskType: { case_retrieval: 1 }, bySplit: { dev: 1 } },
      caseTestGroups: [], provisionTestGroups: [], noAnswerTestGroups: [],
    };
    expect(() => validateEvaluationManifest(manifest, [task()], corpus.fingerprint, 'frozen-hash')).not.toThrow();
    expect(() => validateEvaluationManifest(manifest, [task()], corpus.fingerprint, 'changed-tasks')).toThrow(/hash mismatch/);
    expect(() => validateEvaluationManifest(manifest, [task()], 'changed-corpus', 'frozen-hash')).toThrow(/fingerprint mismatch/);
    expect(() => validateEvaluationManifest({ ...manifest, counts: { ...manifest.counts, tasks: 2 } }, [task()], corpus.fingerprint, 'frozen-hash')).toThrow(/counts mismatch/);
    expect(() => validateEvaluationManifest({ ...manifest, caseTestGroups: ['case-group-a'] }, [task()], corpus.fingerprint, 'frozen-hash')).toThrow(/caseTestGroups/);
  });
});
