#!/usr/bin/env node
/** Loads the actual production TS search module with the already-installed Vite runtime. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const evalDir = resolve(root, 'data/labor-eval-v1');
const release = resolve(root, 'data/labor-public-v1/release');
const mode = process.argv[2];
if (!['build', 'check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/eval-public-retrieval.mjs build|check');
}
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const jsonl = (text) => text.trim().split('\n').map((line) => JSON.parse(line));
const read = (path) => readFile(path, 'utf8');
const [tasksBytes, cases, provisions, sources, manifest, indexBytes, evalManifestBytes, lockBytes] = await Promise.all([
  read(resolve(evalDir, 'tasks.jsonl')),
  read(resolve(release, 'cases.jsonl')).then(jsonl),
  read(resolve(release, 'provisions.jsonl')).then(jsonl),
  read(resolve(release, 'sources.jsonl')).then(jsonl),
  read(resolve(release, 'manifest.json')).then(JSON.parse),
  read(resolve(root, 'lib/generated/public-knowledge.json')),
  read(resolve(evalDir, 'manifest.json')),
  readFile(resolve(root, 'package-lock.json')),
]);
const taskSet = jsonl(tasksBytes);
const corpus = {
  fingerprint: manifest.data_fingerprint,
  records: [
    ...cases.map((row) => ({ id: row.id, kind: 'case', groupId: row.case_group_id, sourceId: row.source_id, refs: row.source_refs })),
    ...provisions.map((row) => ({ id: row.id, kind: 'provision', groupId: row.law_id, sourceId: row.source_id, refs: row.refs })),
  ],
  sources,
};
const trackedInputs = ['lib/public-retrieval.ts', 'lib/public-retrieval-types.ts', 'lib/retrieval-evaluation.ts',
  'scripts/eval-public-retrieval.mjs', 'scripts/build-public-index.py', 'data/labor-public-v1/curation/cases/coverage.json'];
const implementationHashes = Object.fromEntries(await Promise.all(trackedInputs.map(async (path) =>
  [path, sha256(await readFile(resolve(root, path)))])));
const server = await createServer({
  root, configFile: false, appType: 'custom', logLevel: 'error',
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});
try {
  const { evaluateRetrieval, validateEvaluationTasks, validateEvaluationManifest } = await server.ssrLoadModule('/lib/retrieval-evaluation.ts');
  validateEvaluationTasks(taskSet, corpus);
  validateEvaluationManifest(JSON.parse(evalManifestBytes), taskSet, corpus.fingerprint, sha256(tasksBytes));
  const report = {
    schemaVersion: 1, evaluationId: 'anxin-labor-retrieval-v1', inputProtocol: 'production_query_only_top6',
    annotationStatus: 'agent_curated_not_legal_expert_reviewed',
    datasetFingerprint: corpus.fingerprint, tasksSha256: sha256(tasksBytes), indexSha256: sha256(indexBytes),
    evaluationManifestSha256: sha256(evalManifestBytes), dependencyLockSha256: sha256(lockBytes),
    implementationHashes,
    limitations: [
      'Agent-authored questions and partial relevance labels; not real-user traffic or legal-expert-reviewed gold.',
      'Case groups and law groups are split together. All referenced documents remain in the searchable corpus.',
      'This measures retrieval of annotated targets, not legal reasoning, answer correctness, or end-to-end agent success.',
      'Only query and limit=6 are passed to search, matching current HTTP entry points. Annotation topic is used only for reporting.',
      'No precision metric: unannotated returned documents are not established irrelevant.',
      'Citation coverage checks exact paragraph inclusion, not whether a generated answer is supported.',
      'No-answer tasks cover explicitly out-of-domain scenarios; they do not establish safe abstention on difficult legal questions.',
      'Low scores are recorded, not optimized or gated away. Validity and reproducibility are hard gates.',
    ],
    ...evaluateRetrieval(taskSet, corpus),
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  const format = (metric) => metric.value === null ? '—' : `${metric.numerator}/${metric.denominator} (${(100 * metric.value).toFixed(1)}%)`;
  const groups = [['全部', report.overall], ...Object.entries(report.bySplit), ...Object.entries(report.byTaskType)];
  const markdown = [
    '# 公开数据检索基线', '',
    '由 `npm run eval:retrieval` 生成；`npm run eval:check` 重新运行产品检索器并逐字核对报告。', '',
    `数据指纹：\`${report.datasetFingerprint}\``, '',
    `题集 SHA-256：\`${report.tasksSha256}\``, '',
    '人工题面由 Agent 根据公开原文编写，尚未经过法律专业人员复核。所有分数都是初始检索观测，不能视为法律准确率。', '',
    '检索只接收 query 和统一的 limit=6，与当前 HTTP 入口一致；人工标注 topic 仅用于分组统计，不用于过滤或排序。', '',
    '| 范围 | 题数 | Hit@6 | MRR@6 | 已标注记录召回@6 | 域外空返回 |',
    '| --- | ---: | --- | ---: | --- | --- |',
    ...groups.map(([name, summary]) => `| ${name} | ${summary.tasks} | ${format(summary.hitAt6)} | ${summary.mrrAt6.value ?? '—'} | ${format(summary.annotatedRecordRecallAt6)} | ${format(summary.noAnswerAccuracy)} |`), '',
    'Hit@6 和 MRR@6 的分母只包含有相关记录标注的题；域外题单独统计。召回率是对有限已标注目标的微平均，不是对全部相关文档的召回率。', '',
    `原始引用结构校验通过 ${report.overall.returnedCitationsValidated} 次（按每题每条返回引用计，包含重复使用的段落）。它只验证来源与原文一致，不代表论证正确。`, '',
    '每题完整结果、分母、数据与实现哈希见 `baseline.json`。案例和法规整组划分可防止同组改写题跨集合，但语料仍可被检索，不能称为对未见法律知识的泛化评测。', '',
    '## 待改进样本', '',
    '以下样本保留失败事实。没有穷尽标注的其他返回记录可能同样相关，不能一律视为误检。', '',
    ...report.results.filter((row) => row.failure).map((row) => `- ${row.taskId} (${row.split}): ${row.failure}; 首个标注目标名次 ${row.firstRelevantRank ?? '未进入前6'}`), '',
  ].join('\n');
  for (const [name, expected] of [['baseline.json', json], ['baseline.md', markdown]]) {
    const path = resolve(evalDir, name);
    if (mode === 'build') await writeFile(path, expected);
    else if (await read(path) !== expected) throw new Error(`${name} is stale or changed; inspect inputs and regenerate with npm run eval:retrieval`);
  }
  console.log(JSON.stringify({ mode, tasks: taskSet.length, datasetFingerprint: corpus.fingerprint, overall: report.overall, bySplit: report.bySplit }, null, 2));
} finally {
  await server.close();
}
