import type { MaterialBlock, MaterialField, MaterialResult } from './material-types';
import { searchPublicKnowledge } from './public-retrieval';

export const fieldLabels: Record<string, string> = {
  employer: '单位 / 付款方', worker: '劳动者 / 收款方', job: '岗位',
  employment_start: '入职 / 合同起始日', employment_end: '离职 / 合同截止日',
  wage_standard: '工资约定', payment_date: '付款日期', payment_amount: '付款金额',
  arrears_statement: '工资支付相关表述', management_statement: '工作管理相关表述',
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('识别服务返回的数据格式不正确。');
  return value as Record<string, unknown>;
};
function string(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('识别服务返回的文字格式不正确。');
  return value;
}

/** Treat model output as data. Neither its labels nor its invented citations are trusted. */
export function validateMaterialResult(raw: unknown, source: MaterialResult['source']): MaterialResult {
  const data = object(raw);
  const engine = object(data.engine);
  const ocr = string(engine.ocr, 120);
  if (!['local_vision_model', 'local_text_model', 'ocr_rules'].includes(String(engine.structuring))) throw new Error('无法确认识别处理方式。');
  const structuring = engine.structuring as MaterialResult['engine']['structuring'];
  const model = engine.model == null ? null : string(engine.model, 160);
  if (structuring !== 'ocr_rules' && !model) throw new Error('缺少实际模型标识。');
  const pageCount = data.pageCount;
  if (!Number.isInteger(pageCount) || (pageCount as number) < 1 || (pageCount as number) > 5) throw new Error('识别页数超出支持范围。');
  if (!Array.isArray(data.blocks) || !data.blocks.length || data.blocks.length > 1000) throw new Error('未得到可定位的识别文字，请换一份清晰材料后重试。');
  const ids = new Set<string>();
  let textLength = 0;
  const blocks: MaterialBlock[] = data.blocks.map((rawBlock) => {
    const block = object(rawBlock);
    const id = string(block.id, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('识别文字位置编号重复或格式错误。');
    ids.add(id);
    const text = string(block.text, 3000); textLength += text.length;
    if (!Number.isInteger(block.page) || (block.page as number) < 1 || (block.page as number) > (pageCount as number)) throw new Error('识别文字页码无效。');
    const bbox = block.bbox;
    if (bbox !== null && (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) || bbox[2] <= 0 || bbox[3] <= 0 || bbox[0] + bbox[2] > 1.001 || bbox[1] + bbox[3] > 1.001)) throw new Error('识别文字区域无效。');
    if (block.confidence !== null && (typeof block.confidence !== 'number' || !Number.isFinite(block.confidence) || block.confidence < 0 || block.confidence > 1)) throw new Error('识别置信度无效。');
    return { id, page: block.page as number, text, bbox: bbox as MaterialBlock['bbox'], confidence: block.confidence as number | null };
  });
  if (textLength > 32000) throw new Error('识别文字过长，请拆分材料后重试。');
  if (!Array.isArray(data.fields) || data.fields.length > 60) throw new Error('识别字段数量或格式不正确。');
  const warnings = Array.isArray(data.warnings) ? data.warnings.slice(0, 12).filter((w): w is string => typeof w === 'string').map((w) => w.slice(0, 500)) : [];
  const fields: MaterialField[] = [];
  let rejected = 0;
  for (const item of data.fields) {
    try {
      const field = object(item);
      const key = string(field.key, 60);
      if (!Object.hasOwn(fieldLabels, key)) throw new Error('unknown key');
      const value = string(field.value, 300).trim();
      const quote = string(field.quote, 1000).trim();
      if (!Array.isArray(field.blockIds) || !field.blockIds.length || field.blockIds.length > 8 || field.blockIds.some((id) => typeof id !== 'string' || !ids.has(id))) throw new Error('unknown reference');
      const blockIds = field.blockIds as string[];
      const cited = blockIds.map((id) => blocks.find((b) => b.id === id)!);
      const positions = blockIds.map((id) => blocks.findIndex((b) => b.id === id));
      if (positions.some((p, i) => i > 0 && p <= positions[i - 1]) || cited.some((b) => b.page !== cited[0].page)) throw new Error('unordered reference');
      if (!cited.map((b) => b.text).join('\n').includes(quote) || !quote.includes(value)) throw new Error('ungrounded value');
      if (field.origin !== 'model' && field.origin !== 'rule') throw new Error('unknown origin');
      if ((field.origin === 'model') !== (structuring !== 'ocr_rules')) throw new Error('mislabelled model');
      if (fields.some((f) => f.key === key && f.quote === quote && f.value === value)) continue;
      fields.push({ id: `field-${fields.length + 1}`, key, label: fieldLabels[key], value, extractedValue: value, quote, blockIds, origin: field.origin, review: 'pending', confirmed: false });
    } catch { rejected++; }
  }
  if (rejected) warnings.push(`${rejected} 个候选字段因缺少可靠原文引用或格式不符而未采纳。`);
  if (!fields.length) warnings.push('未提取出有可靠引用的关键信息；可以查看识别原文并手动检索。');
  return {
    engine: { ocr, structuring, model,
      ...(typeof engine.modelDigest === 'string' && engine.modelDigest.length <= 200 ? { modelDigest: engine.modelDigest } : {}),
      ...(Number.isInteger(engine.imageCount) && (engine.imageCount as number) >= 0 && (engine.imageCount as number) <= 5 ? { imageCount: engine.imageCount as number } : {}),
    }, pageCount: pageCount as number, blocks, fields, warnings,
    source, knowledge: searchPublicKnowledge(blocks.map((b) => b.text).join('\n')),
  };
}

export function applyFieldReview(result: MaterialResult, raw: unknown): MaterialResult {
  if (!Array.isArray(raw) || raw.length > result.fields.length) throw new Error('字段核对内容格式不正确。');
  const seen = new Set<string>();
  const edits = new Map<string, { value: string; confirmed: boolean }>();
  for (const item of raw) {
    const entry = object(item);
    const id = string(entry.id, 80);
    if (seen.has(id) || !result.fields.some((field) => field.id === id)) throw new Error('字段已变化，请重新加载。');
    seen.add(id);
    const value = string(entry.value, 300).trim();
    if (typeof entry.confirmed !== 'boolean') throw new Error('请选择是否已核对原件。');
    edits.set(id, { value, confirmed: entry.confirmed });
  }
  const fields = result.fields.map((field): MaterialField => {
    const edit = edits.get(field.id);
    if (!edit) return field;
    return { ...field, value: edit.value, confirmed: edit.confirmed, review: edit.value !== field.extractedValue ? 'corrected' : edit.confirmed ? 'confirmed' : 'pending' };
  });
  return { ...result, fields, knowledge: searchPublicKnowledge([...result.blocks.map((b) => b.text), ...fields.map((f) => f.value)].join('\n')) };
}
