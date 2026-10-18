# PR #40 运行时去重与保存接入：独立只读技术复核

日期：2026-10-18。复核者：`currency_fix` 子 Agent，按主 Agent 的 `gpt-6.1-sol / ultra` 配置要求执行。本复核者未参与 `material-fact-runtime-ingest.ts` 的实现。

## 结论与范围

在本次静态检查、已有测试及 12 个补充动态场景的范围内，未发现新的阻塞性 P1/P2 问题。该结论是局部技术复核，不表示业务验收、真实模型提取质量验收、合并或部署完成。

复核对象是主工作树中当时未提交的 `lib/material-fact-runtime-ingest.ts`、`lib/material-fact-store.ts` 的 polling 接入，以及它们与现有 source review、coverage review 的关系。为隔离执行，从主工作树复制 runtime helper、store、store 测试及当时 46 项独立测试到 `/Users/xuzihan/Documents/Projects/国创/anxin-pr40-currency`。隔离树基线为 `b6419b2c36444171356a2c22fe8107bbfe1da411`，覆盖率位置修复的两个文件也参与了测试。未修改主工作树或产品实现；未复核另一位 Agent 负责的取消补丁。

## 已核对的实现约束

- `material-fact-runtime-ingest.ts:9` 先对原始整包调用冻结 validator，再逐项验证。因此原始 40 项限制、200000 字符 raw 限制、schemaVersion 3、顶层精确字段和 source 校验没有因拆分单项而被绕过。
- `material-fact-runtime-ingest.ts:15` 使用原数组索引生成候选 ID，并将单项拒绝理由映射回原索引；原始 `raw`、`rawCount`、围栏格式及候选 representation 保留。逐项 JSON 序列化只用于校验，不代替保存原回答。
- `material-fact-runtime-ingest.ts:23` 使用源文复核后的规范化状态、金额、问题类型和非精确观察的位置构造去重身份。正常精确重复仍折叠；非精确状态与精确状态分别保留；同一源文位置的完整引文和裁剪引文可以折叠，裁剪本身不能升级最终金额。
- `material-fact-runtime-ingest.ts:55` 沿用冻结 ingest 的状态转移及历史记录，然后只替换本次新 material 的候选、拒绝记录及派生覆盖率。作用域、金额确认、旧计算和任务的失效行为仍沿用既有转移；旧材料的 raw 不被重写。
- `material-fact-store.ts:145` 的生产调用顺序仍为 `ingestRuntimeCandidates` 后立即 `reviewFactsAgainstSources`，后者执行源文守护及当前来源覆盖率。异常进入 failed job 分支，保留已取得的原回答，再经过既有 revision/generation CAS 保存；不存在校验失败后跳过复核、仍保存成功候选的新增路径。
- `snapshot`/读取旧记录不会调用运行时 ingest 重解析历史 raw。已有 source review 的覆盖率读取只解析历史 raw 的候选数量，不重新接受被历史规则拒绝的候选。
- 依赖方向为 `runtime-ingest → source-review → coverage-review → frozen facts`，冻结 facts 不反向导入运行时模块，因此未发现循环。覆盖率按真实 value span 收紧 `covered`，不会据此增加金额可用性；响应派生的 `sourceCoverage` 仍由 store 序列化排除。

接口边界：运行时 validator 内的 `reviewCandidateAgainstSource` 用于去重判等，返回的 candidate 仍保留冻结 validator 的投影；生产展示和保存前的金额下调由 store 后续 `reviewFactsAgainstSources` 完成。本复核确认了当前生产路径的这一步，没有把单独调用 validator 等同于已完成源文金额守护。

## 实际测试版本与结果

实际执行：

```text
npx vitest run lib/material-fact-pr40-final-review.test.ts lib/material-fact-store.test.ts lib/material-fact-coverage-review.test.ts
```

结果：**111/111 通过**，构成为独立 final-review **46** 项、store **35** 项、coverage **30** 项。真实 D1 store 测试包括“概数观察之后的精确观察仍保留、候选原索引保留、历史记录 GET 不重解析、不重写历史拒绝记录”。

另外实际执行 `npm run typecheck`、对 runtime helper/store/独立 final-review 测试的 ESLint，以及 `git diff --check`，均通过，无 ESLint 警告。

**版本说明：111 项这一组使用的是独立测试仍为 46 项时的拷贝。主 Agent 随后将 final-review 扩展为最终 50 项，并由另一位 Agent 负责最终版本的整合验证。本报告不把最终 50 项或另一位 Agent 的整合测试计为本人已运行的检查。主 Agent 另报的完整 848 项结果也不作为本复核者亲自执行的证据。**

46 项独立测试覆盖了概数前后缀、上下界、范围和不确定修饰的正反顺序与完整/裁剪引文、不同边界、精确重复、同位置完整/裁剪非精确重复、拒绝索引与围栏 raw、41 项拒绝、错误 schema、多余顶层键、非法 JSON、未就绪 source、不同 assertion、歧义引用和历史不重解析。

## 12 个补充动态场景

全部使用以下精确对照作为第二个 source block：

```text
王甲2024年7月完整应付工资8000元。
```

每个场景分别以“待核项在前”和“精确项在前”运行一次，共 **12 次**。两项候选统一使用 value `8000`、主体 `王甲`、个人范围、`due_total`、完整性 complete、期间 `2024年7月`；待核项 quote 裁为 `8000`，精确项 quote 取完整对照句。raw 使用完整 JSON 围栏。

| 待核 block 原文 | 复核后待核状态 | 两种顺序结果 |
| --- | --- | --- |
| 王甲2024年7月完整应付工资8000HK$。 | unsupported，amount=null | 两候选均保留，精确对照为 8000.00 |
| 王甲2024年7月完整应付工资负8000元。 | unsupported，amount=null | 两候选均保留，精确对照为 8000.00 |
| 王甲2024年7月完整应付工资18000元。 | unsupported，amount=null | 两候选均保留，精确对照为 8000.00 |
| 王甲2024年7月完整应付工资8000元/月。 | rate_unit_mismatch，amount=null | 两候选均保留，精确对照为 8000.00 |
| 王甲2024年7月完整应付工资8000元且另付8000元。 | uncertain，amount=null，local_context_ambiguous | 两候选均保留，精确对照为 8000.00 |
| 李乙2024年7月完整应付工资8000元。 | 金额状态 exact，但有 source_relation_unresolved | 两候选均保留，精确对照为 8000.00 |

每次动态运行均断言：运行时接受数量为 2；冻结 validator 对同一 raw 仅接受 1 项；原 raw 字节内容、rawCount=2、outputFormat=outer_fence、候选按原数组顺序的 representation 均保留；原输入 state 不变。对非 exact 待核项断言 amount=null；对错主体待核项断言存在归属告警。没有把保留一个金额字符串解释为该候选已经通过归属核对或获得计算授权。

可重现脚本如下，可在含该补丁及依赖的项目根目录运行：

```js
import assert from 'node:assert/strict';
import { validateRuntimeCandidateOutput, ingestRuntimeCandidates } from './lib/material-fact-runtime-ingest.ts';
import { emptyFactState, validateCandidateOutput } from './lib/material-facts-v3.ts';
import { reviewFactsAgainstSources } from './lib/material-fact-source-review.ts';
const good = '王甲2024年7月完整应付工资8000元。';
const cases = [
  ['foreign suffix', '王甲2024年7月完整应付工资8000HK$。', 'unsupported'],
  ['negative prefix', '王甲2024年7月完整应付工资负8000元。', 'unsupported'],
  ['cropped token', '王甲2024年7月完整应付工资18000元。', 'unsupported'],
  ['rate suffix', '王甲2024年7月完整应付工资8000元/月。', 'rate_unit_mismatch'],
  ['ambiguous source quote', '王甲2024年7月完整应付工资8000元且另付8000元。', 'uncertain'],
  ['wrong source owner', '李乙2024年7月完整应付工资8000元。', 'exact'],
];
for (const [name, text, status] of cases) for (const reverse of [false, true]) {
  const source = { id: 's', name: 'runtime read-only review', sha256: 'a'.repeat(64), analysisRevision: 3, ready: true,
    blocks: [text, good].map((text, index) => ({ id: 'b' + index, page: 1, text, bbox: null, confidence: null })) };
  const base = { kind: 'money', value: '8000', quote: '8000', blockId: 'b0', subject: '王甲', scope: 'individual',
    meaning: 'due_total', completeness: 'complete', period: '2024年7月', rateUnit: null, assertion: 'narrated' };
  const entries = [base, { ...base, quote: good, blockId: 'b1' }];
  if (reverse) entries.reverse();
  const raw = '```json\n' + JSON.stringify({ schemaVersion: 3, candidates: entries }) + '\n```';
  const original = emptyFactState(3), snapshot = structuredClone(original);
  const frozen = validateCandidateOutput(raw, source), batch = validateRuntimeCandidateOutput(raw, source);
  assert.equal(batch.candidates.length, 2, name);
  assert.equal(frozen.candidates.length, 1, name);
  assert.equal(batch.raw, raw);
  assert.equal(batch.format, 'outer_fence');
  assert.equal(batch.rawCount, 2);
  assert.equal(batch.rejected.length, 0);
  assert.deepEqual(batch.candidates.map(candidate => candidate.representation), entries);
  const reviewed = reviewFactsAgainstSources(ingestRuntimeCandidates(original, source, { raw }, 'synthetic', 'owner', '2026-10-18T10:00:00Z'), [source]);
  const bad = reviewed.materials[0].candidates.find(candidate => candidate.blockId === 'b0');
  const safe = reviewed.materials[0].candidates.find(candidate => candidate.blockId === 'b1');
  assert.equal(bad.normalization.status, status, name);
  assert.equal(safe.normalization.status, 'exact');
  assert.equal(safe.amount, '8000.00');
  if (status === 'exact') assert(bad.reviewIssues.some(issue => issue.code === 'source_relation_unresolved'));
  else assert.equal(bad.amount, null, name);
  assert.equal(reviewed.materials[0].raw, raw);
  assert.deepEqual(original, snapshot);
  console.log(JSON.stringify({ name, reverse, accepted: batch.candidates.length, badStatus: bad.normalization.status, goodAmount: safe.amount, rawUnchanged: true }));
}
```

## 验证边界

本轮不运行新的真实模型推理，不对历史实验重算，不把冻结 validator 的既有输出改为新结果。局部测试及动态输入没有替代最终 50 项版本的整合测试、完整项目检查、HTTP、浏览器或用户人工验收。覆盖率仍是启发式提示，原文多处语义重复被去重拒绝后，位置覆盖可能保守提示遗漏；不会据此补写事实或自动确认金额。
