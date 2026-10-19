import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import generated from './generated/public-knowledge.json';
import { getPublicKnowledgeRecord, searchPublicKnowledge } from './public-retrieval';

const release = resolve('data/labor-public-v1/release');
const rows = (name: string) => readFileSync(resolve(release, name), 'utf8').trim().split('\n')
  .map((line) => JSON.parse(line));
const frozenSources = rows('sources.jsonl') as {
  id: string; title: string; url: string; paragraphs: { id: string; text: string }[];
}[];
const sourceMap = new Map(frozenSources.map((source) => [source.id, source]));

describe('public labor knowledge retrieval on frozen official records', () => {
  it('expands actual worker phrases into traceable cases and provisions', () => {
    const result = searchPublicKnowledge('张某在某某公司工作，没签劳动合同，公司欠薪，工资通过银行转账，有微信聊天和打卡。');
    expect(result.method).toBe('deterministic_keyword_topic_v1');
    expect(result.fingerprint).toBe('e599f7f44e0350378c8369a0bf98932ffb15c111bd7d2d867402584104d8ad7a');
    expect(result.expandedTerms).toContain('支付凭证');
    expect(result.expandedTerms).toContain('书面劳动合同');
    expect(result.hits.some((hit) => hit.kind === 'case')).toBe(true);
    expect(result.hits.some((hit) => hit.kind === 'provision')).toBe(true);
    expect(result.hits.every((hit) => hit.matchedTerms.length > 0 && hit.citations.length > 0)).toBe(true);
    expect(result.query).not.toMatch(/张某|某某公司/);
  });

  it('does not expose uploaded text, identities, amounts, or URLs in the displayed query', () => {
    const result = searchPublicKnowledge('李四 身份证110101200001019999 银行账号6222001234567890 月薪8888元 联系 lisi@example.com https://example.com/工资 工资流水');
    expect(result.query).toBe('工资 工资支付记录');
    expect(result.expandedTerms.join(' ')).not.toMatch(/李四|110101|622200|8888|example/);
  });

  it('searches legal facts at the tail of long materials and explicitly rejects oversized input', () => {
    const result = searchPublicKnowledge('中'.repeat(59000) + '公司拖欠工资，有银行转账记录 lisi@example.com');
    expect(result.query).toContain('欠薪');
    expect(result.expandedTerms).toContain('支付凭证');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(() => searchPublicKnowledge('中'.repeat(60001))).toThrow(/60000/);
  });

  it.each([
    '王某 李四 足球比分 123456',
    '买房合同 如何装修 买菜',
    'https://example.invalid/工资/劳动合同 李四',
    "' OR 1=1 --",
    '',
  ])('returns no full-library fallback for unrelated input: %s', (query) => {
    const result = searchPublicKnowledge(query, { topic: 'wage_arrears' });
    expect(result.hits).toEqual([]);
    expect(result.query).toBe('');
  });

  it('requires a specified article to occur in the selected records', () => {
    expect(searchPublicKnowledge('劳动合同法 第九百九十九条').hits).toEqual([]);
    const result = searchPublicKnowledge('劳动合同法 第三十条');
    expect(result.hits.some((hit) => hit.id === 'labor-contract-law-2012:a005')).toBe(true);
    expect(searchPublicKnowledge('劳动争议调解仲裁法 第六条').hits.some((hit) => hit.articleLabel === '第六条')).toBe(true);
  });

  it('retains the real negative employment-relationship outcome', () => {
    const result = searchPublicKnowledge('众包骑手自主接单，不要求上线时间', { topic: 'employment_relationship', limit: 20 });
    const hit = result.hits.find((record) => record.id === 'case-third-02-crowdsourced-courier');
    expect(hit).toBeDefined();
    expect(hit!.summary).toContain('驳回徐某的仲裁请求');
    expect(hit!.region).toBeNull();
    expect(hit!.decisionDate).toBeNull();
  });

  it('enforces explicit topic and bounded limits without inventing hits', () => {
    const result = searchPublicKnowledge('工资举证', { topic: 'wage_arrears', limit: 3 });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.length).toBeLessThanOrEqual(3);
    expect(result.hits.every((hit) => hit.topics.includes('wage_arrears'))).toBe(true);
    expect(searchPublicKnowledge('工资', { limit: 0 }).hits).toHaveLength(1);
    expect(searchPublicKnowledge('工资', { limit: Number.NaN }).hits.length).toBeLessThanOrEqual(6);
  });

  it('every public record resolves exact frozen source paragraphs, never another case body', () => {
    for (const document of generated.documents) {
      const hit = getPublicKnowledgeRecord(document.id);
      expect(hit).not.toBeNull();
      expect(hit!.annotationStatus).toBe('agent_curated_not_legal_expert_reviewed');
      expect(hit!.citations.map((citation) => citation.paragraphId)).toEqual(document.refs);
      const source = sourceMap.get(document.sourceId)!;
      const paragraphs = new Map(source.paragraphs.map((paragraph) => [paragraph.id, paragraph.text]));
      for (const citation of hit!.citations) {
        expect(citation.text).toBe(paragraphs.get(citation.paragraphId));
        expect(citation.sourceUrl).toBe(source.url);
        expect(citation.sourceTitle).toBe(source.title);
        expect(citation.sourceUrl).toMatch(/^https:\/\//);
      }
    }
    expect(getPublicKnowledgeRecord('../sources.jsonl')).toBeNull();
    expect(getPublicKnowledgeRecord('unknown-record')).toBeNull();
  });

  it('indexes exactly the released provisions and preserves their version boundaries', () => {
    const provisions = rows('provisions.jsonl') as {
      id: string; text: string; status_note: string; version_label: string;
      effective_on: string | null; expires_on: string | null;
    }[];
    expect(generated.documents.filter((document) => document.kind === 'provision').map((document) => document.id).sort())
      .toEqual(provisions.map((provision) => provision.id).sort());
    for (const provision of provisions) {
      const hit = getPublicKnowledgeRecord(provision.id)!;
      expect(hit.citations.map((citation) => citation.text).join('\n')).toBe(provision.text);
      expect(hit.versionNote).toBe(provision.status_note);
      expect(hit.versionLabel).toBe(provision.version_label);
      expect(hit.effectiveOn).toBe(provision.effective_on);
      expect(hit.expiresOn).toBe(provision.expires_on);
    }
    const contract = getPublicKnowledgeRecord('labor-contract-law-2012:a005')!;
    expect(contract.effectiveOn).toBeNull();
    expect(contract.versionNote).toContain('effective_on留空');
    const historic = getPublicKnowledgeRecord('labor-dispute-interpretation-i-2020:a003')!;
    expect(historic.versionNote).toContain('第三十二条第一款自2025-09-01同时废止');
    expect(generated.documents.filter((document) => document.id.startsWith('labor-dispute-interpretation-i-2020:'))
      .some((document) => document.title.includes('第三十二条'))).toBe(false);
  });

  it('rebuild verification matches the committed index without writing', () => {
    const result = spawnSync('python3', ['-B', 'scripts/build-public-index.py', '--check'], { encoding: 'utf8', timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).fingerprint).toBe(generated.fingerprint);
  });

  it('rejects altered paragraph references and invented provision text before index output', () => {
    const script = `import copy, importlib.util
spec=importlib.util.spec_from_file_location('builder','scripts/build-public-index.py')
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
m,data=b.load_verified_release()
bad=copy.deepcopy(data)
c=bad['cases.jsonl'][0]
s=next(s for s in bad['sources.jsonl'] if s['id']==c['source_id'])
c['facts'][0]['refs']=[next(p['id'] for p in s['paragraphs'] if p['id'] not in c['source_refs'])]
try: b.build_index(m,bad)
except ValueError: pass
else: raise AssertionError('cross-case reference accepted')
bad=copy.deepcopy(data); bad['provisions.jsonl'][0]['text']='伪造条款'
try: b.build_index(m,bad)
except ValueError: pass
else: raise AssertionError('invented provision accepted')
print('PASS')`;
    const result = spawnSync('python3', ['-B', '-c', script], { encoding: 'utf8', timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('PASS');
  });
});
