import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = process.argv[2];
if (!root) throw new Error('Expected a read-only implementation root');
const { normalizeMoneyValueV4: money, normalizeCandidateValueV4: normalize } = await import(pathToFileURL(resolve(root, 'lib/material-money-v4.ts')));
let failures = 0;
for (const expression of ['不满三个月工资共四万元', '低于三个月的工资合计四万元', '高于三个月的工资合计四万元']) {
 const candidate = { kind: 'money', value: '四万元', quote: expression, blockId: 'b1', subject: '王甲', scope: 'individual', meaning: 'due_total', completeness: 'complete', period: null, rateUnit: null, assertion: 'narrated' };
 const whole = money(expression), crop = normalize(candidate);
 const passed = whole.amount === '40000.00' && crop.amount === '40000.00';
 console.log(JSON.stringify({ expression, whole: whole.amount, whole_status: whole.status, crop: crop.amount, expected: '40000.00', passed }));
 if (!passed) failures++;
}
console.log(JSON.stringify({ tests: 3, passed: 3-failures, failed: failures, scope: 'qualifier applied to a duration; exact stated money stays exact', model_requests: 0 }));
process.exitCode = failures ? 1 : 0;
