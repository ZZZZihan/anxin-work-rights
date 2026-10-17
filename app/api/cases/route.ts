import { getRequestUser, unauthorized } from '@/lib/auth';
import { cleanText, ensureUserSeed, getDatabase, jsonError, rowToCase } from '@/lib/server';
import { retryMaterialFactCleanup } from '@/lib/material-fact-cleanup';

import { isRecord, statusForStep, validAmount, validDate } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isRecord(body)) return jsonError('提交内容格式不正确。');
  const invalid = validateFields(body);
  if (invalid) return jsonError(invalid);

  const company = cleanText(body.company, 100);
  const type = cleanText(body.type, 50);
  if (!company || !type) return jsonError('请填写单位名称和争议类型。');

  const amount = Math.max(0, Math.round(Number(body.amount) || 0));
  const deadline = cleanText(body.deadline, 10) || null;
  const location = cleanText(body.location, 100);
  const description = cleanText(body.description, 1200);
  const nextAction = cleanText(body.nextAction, 160) || '补充案件事实与证据';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getDatabase();

  await db
    .prepare(
      `INSERT INTO cases
        (id, user_id, type, company, amount, status, current_step, next_action, deadline, location, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'collecting', 0, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      user.userId,
      type,
      company,
      amount,
      nextAction,
      deadline,
      location,
      description,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare('SELECT * FROM cases WHERE id = ? AND user_id = ?')
    .bind(id, user.userId)
    .first<Record<string, unknown>>();
  if (!row) return jsonError('案件创建后未能读取，请刷新重试。', 500);
  return Response.json({ case: rowToCase(row) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = getRequestUser(request);
  if (!user) return unauthorized();
  await ensureUserSeed(user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isRecord(body)) return jsonError('提交内容格式不正确。');
  const invalid = validateFields(body);
  if (invalid) return jsonError(invalid);
  const id = cleanText(body.id, 80);
  if (!id) return jsonError('缺少案件编号。');

  const allowedStatus = ['collecting', 'negotiating', 'arbitration', 'completed', 'archived'];
  const existing = await getDatabase().prepare('SELECT * FROM cases WHERE id = ? AND user_id = ?')
    .bind(id, user.userId).first<Record<string, unknown>>();
  if (!existing) return jsonError('未找到这个案件。', 404);
  const step = 'currentStep' in body ? Number(body.currentStep) : Number(existing.current_step);
  if ('currentStep' in body && (!Number.isInteger(step) || step < 0 || step > 4)) return jsonError('案件阶段必须是 0 至 4 的整数。');
  if ('status' in body && !allowedStatus.includes(String(body.status))) return jsonError('案件状态不正确。');
  if ('status' in body && body.status !== 'archived' && body.status !== statusForStep(step)) return jsonError('案件状态与阶段不一致。');
  if ('currentStep' in body && existing.status === 'archived') return jsonError('请先恢复归档案件。', 409);
  if ('currentStep' in body) body.status = statusForStep(step);

  const updates: Array<{ column: string; value: string | number | null }> = [];
  if (body && 'company' in body) updates.push({ column: 'company', value: cleanText(body.company, 100) });
  if (body && 'type' in body) updates.push({ column: 'type', value: cleanText(body.type, 50) });
  if (body && 'amount' in body) updates.push({ column: 'amount', value: Math.max(0, Math.round(Number(body.amount) || 0)) });
  if (body && 'nextAction' in body) updates.push({ column: 'next_action', value: cleanText(body.nextAction, 160) });
  if (body && 'deadline' in body) updates.push({ column: 'deadline', value: cleanText(body.deadline, 10) || null });
  if (body && 'location' in body) updates.push({ column: 'location', value: cleanText(body.location, 100) });
  if (body && 'description' in body) updates.push({ column: 'description', value: cleanText(body.description, 1200) });
  if (body && 'currentStep' in body) updates.push({ column: 'current_step', value: Math.max(0, Math.min(4, Math.round(Number(body.currentStep) || 0))) });
  if (body && 'status' in body && allowedStatus.includes(String(body.status))) updates.push({ column: 'status', value: String(body.status) });
  if (!updates.length) return jsonError('没有可更新的字段。');

  updates.push({ column: 'updated_at', value: new Date().toISOString() });
  const sql = `UPDATE cases SET ${updates.map((item) => `${item.column} = ?`).join(', ')} WHERE id = ? AND user_id = ?`;
  // D1 triggers journal an old remote job before invalidation deletes its fact
  // state, in the same transaction as this owner-scoped case update.
  const result = await getDatabase().prepare(sql).bind(...updates.map((item) => item.value), id, user.userId).run();
  if ((result.meta.changes ?? 0) === 0) return jsonError('未找到这个案件。', 404);
  const processingCleanupPending = await retryMaterialFactCleanup(user.userId, id);

  const row = await getDatabase()
    .prepare('SELECT * FROM cases WHERE id = ? AND user_id = ?')
    .bind(id, user.userId)
    .first<Record<string, unknown>>();
  if (!row) return jsonError('案件更新后未能读取。', 500);
  return Response.json({ case: rowToCase(row), processingCleanupPending });
}

function validateFields(body: Record<string, unknown>): string | null {
  const textLimits: Record<string, number> = { company: 100, type: 50, location: 100, description: 1200, nextAction: 160 };
  for (const [key, limit] of Object.entries(textLimits)) {
    if (key in body && (typeof body[key] !== 'string' || String(body[key]).length > limit)) return `${key} 内容格式或长度不正确。`;
  }
  if ('company' in body && !String(body.company).trim()) return '单位名称不能为空。';
  if ('type' in body && !String(body.type).trim()) return '争议类型不能为空。';
  if ('amount' in body && !validAmount(body.amount)) return '金额必须是 0 至 10 亿元的整数。';
  if ('deadline' in body && !validDate(body.deadline)) return '目标日期必须是真实的 YYYY-MM-DD 日期。';
  return null;
}
