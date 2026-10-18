import type { RequestUser } from './auth';
import { getDatabase, getFilesBucket } from './server';
import type { DocumentKind, MaterialAnalysis, MaterialResult } from './material-types';
import { callMaterialService } from './material-service-client';
import { applyFieldReview, validateMaterialResult } from './material-validation';

type Evidence = { id: string; name: string; mime_type: string; content_hash: string; object_key: string; size: number };
type AnalysisRow = {
  evidence_id: string; user_id: string; content_hash: string; document_kind: DocumentKind;
  status: MaterialAnalysis['status']; revision: number; run_id: string; job_id: string | null;
  result_json: string | null; error: string | null; started_at: string; updated_at: string;
};
const supported = new Set(['image/png', 'image/jpeg', 'application/pdf', 'text/plain']);
const MAX_AGE = 8 * 60_000;
export class AnalysisError extends Error { constructor(message: string, public status = 400) { super(message); } }

export async function ownedEvidence(user: RequestUser, id: string): Promise<Evidence> {
  const evidence = await getDatabase().prepare(`SELECT e.* FROM evidence_files e JOIN cases c ON c.id=e.case_id AND c.user_id=e.user_id
    WHERE e.id=? AND e.user_id=? AND e.status IN ('uploaded','needs_review') AND c.status != 'archived'`)
    .bind(id, user.userId).first<Evidence>();
  if (!evidence?.object_key) throw new AnalysisError('未找到可识别的材料；请确认上传已完成且案件未归档。', 404);
  return evidence;
}
async function row(user: RequestUser, id: string) {
  return getDatabase().prepare('SELECT * FROM evidence_analyses WHERE evidence_id=? AND user_id=?').bind(id, user.userId).first<AnalysisRow>();
}
function present(item: AnalysisRow | null): MaterialAnalysis | null {
  if (!item) return null;
  return { evidenceId: item.evidence_id, documentKind: item.document_kind, status: item.status, revision: item.revision,
    result: item.result_json ? JSON.parse(item.result_json) as MaterialResult : null, error: item.error, updatedAt: item.updated_at };
}
async function fail(item: AnalysisRow, message: string) {
  await getDatabase().prepare(`UPDATE evidence_analyses SET status='failed', error=?, updated_at=?
    WHERE evidence_id=? AND user_id=? AND run_id=? AND status='running'`)
    .bind(message.slice(0, 500), new Date().toISOString(), item.evidence_id, item.user_id, item.run_id).run();
}

export async function readAnalysis(user: RequestUser, id: string): Promise<MaterialAnalysis | null> {
  const evidence = await ownedEvidence(user, id);
  const current = await row(user, id);
  if (!current || current.status !== 'running') return present(current);
  if (Date.now() - Date.parse(current.started_at) > MAX_AGE) {
    await fail(current, '识别等待超时，请重试。原文件已保留。');
  } else if (current.job_id) {
    try {
      const job = await callMaterialService(`/jobs/${encodeURIComponent(current.job_id)}`);
      if (job.status === 'failed') {
        const error = job.error as { message?: unknown } | undefined;
        await fail(current, typeof error?.message === 'string' ? error.message : '识别未完成，请重试。');
      } else if (job.status === 'ready') {
        const result = validateMaterialResult(job.result, { evidenceId: id, name: evidence.name, sha256: current.content_hash, mimeType: evidence.mime_type });
        // UPDATE only: deletion, archival, replacement and a newer attempt all
        // prevent a late result from re-creating private derived data.
        await getDatabase().prepare(`UPDATE evidence_analyses SET status='ready',result_json=?,error=NULL,updated_at=?
          WHERE evidence_id=? AND user_id=? AND run_id=? AND status='running'
          AND EXISTS (SELECT 1 FROM evidence_files e JOIN cases c ON c.id=e.case_id AND c.user_id=e.user_id
            WHERE e.id=evidence_analyses.evidence_id AND e.user_id=evidence_analyses.user_id
            AND e.content_hash=evidence_analyses.content_hash AND e.status IN ('uploaded','needs_review') AND c.status!='archived')`)
          .bind(JSON.stringify(result), new Date().toISOString(), id, user.userId, current.run_id).run();
      } else if (job.status !== 'running') throw new Error('识别服务返回了无法确认的任务状态。');
    } catch (error) {
      await fail(current, error instanceof Error ? error.message : '识别服务暂时不可用。');
    }
  }
  await ownedEvidence(user, id);
  return present(await row(user, id));
}

export async function startAnalysis(user: RequestUser, id: string, documentKind: DocumentKind, retry = false): Promise<MaterialAnalysis> {
  const evidence = await ownedEvidence(user, id);
  if (!supported.has(evidence.mime_type)) throw new AnalysisError('此格式可以保存，但暂不支持自动识别。请将 Word 转为 PDF、PNG 或 JPG 后上传。', 415);
  if (evidence.size > 10 * 1024 * 1024) throw new AnalysisError('识别文件不能超过 10MB。', 413);
  const existing = await row(user, id);
  if (existing?.status === 'ready' || existing?.status === 'running') return (await readAnalysis(user, id))!;
  if (existing && !retry) return present(existing)!;
  const object = await getFilesBucket().get(evidence.object_key);
  if (!object) throw new AnalysisError('原文件已不存在，请重新上传。', 404);
  const bytes = await object.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  if (evidence.content_hash && digest !== evidence.content_hash) throw new AnalysisError('原文件校验不一致，识别已停止。请重新上传。', 409);
  // Old runtime records may predate content_hash. Record the verified original
  // without changing file content or ownership; later commits still check it.
  if (!evidence.content_hash) {
    await getDatabase().prepare(`UPDATE evidence_files SET content_hash=? WHERE id=? AND user_id=? AND content_hash IS NULL AND status IN ('uploaded','needs_review')`).bind(digest, id, user.userId).run();
  }
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const claim = await getDatabase().prepare(`INSERT INTO evidence_analyses
    (evidence_id,user_id,content_hash,document_kind,status,revision,run_id,started_at,updated_at)
    SELECT ?,?,?,?,'running',1,?,?,? WHERE EXISTS
      (SELECT 1 FROM evidence_files e JOIN cases c ON c.id=e.case_id AND c.user_id=e.user_id WHERE e.id=? AND e.user_id=? AND e.content_hash=? AND e.status IN ('uploaded','needs_review') AND c.status!='archived')
    ON CONFLICT(evidence_id) DO UPDATE SET status='running',document_kind=excluded.document_kind,
      content_hash=excluded.content_hash,run_id=excluded.run_id,revision=evidence_analyses.revision+1,
      job_id=NULL,result_json=NULL,error=NULL,started_at=excluded.started_at,updated_at=excluded.updated_at
    WHERE evidence_analyses.user_id=excluded.user_id AND evidence_analyses.status='failed'`)
    .bind(id, user.userId, digest, documentKind, runId, now, now, id, user.userId, digest).run();
  const current = await row(user, id);
  if (!current) throw new AnalysisError('材料状态已变化，请刷新后重试。', 409);
  if (!claim.meta.changes || current.run_id !== runId) return present(current)!;
  try {
    const job = await callMaterialService('/jobs', { method: 'POST', headers: { 'Content-Type': evidence.mime_type, 'x-document-kind': documentKind }, body: bytes });
    if (typeof job.jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(job.jobId)) throw new Error('识别服务未返回有效任务编号。');
    const attached = await getDatabase().prepare(`UPDATE evidence_analyses SET job_id=? WHERE evidence_id=? AND user_id=? AND run_id=? AND status='running'
      AND EXISTS (SELECT 1 FROM evidence_files e JOIN cases c ON c.id=e.case_id AND c.user_id=e.user_id
        WHERE e.id=evidence_analyses.evidence_id AND e.user_id=evidence_analyses.user_id
        AND e.status IN ('uploaded','needs_review') AND c.status!='archived')`)
      .bind(job.jobId, id, user.userId, runId).run();
    if (!attached.meta.changes) {
      // A deletion/archival may finish before the service returns its job ID.
      // Clean up that orphan too; an offline service still has bounded expiry.
      await callMaterialService(`/jobs/${encodeURIComponent(job.jobId)}`, { method: 'DELETE' }).catch(() => undefined);
    }
  } catch (error) { await fail(current, error instanceof Error ? error.message : '识别服务暂时不可用，请重试。'); }
  await ownedEvidence(user, id);
  const latest = await row(user, id);
  if (!latest) throw new AnalysisError('材料状态已变化，请刷新后重试。', 409);
  return present(latest)!;
}

export async function reviewAnalysis(user: RequestUser, id: string, revision: number, fields: unknown) {
  await ownedEvidence(user, id);
  const current = await row(user, id);
  if (!current || current.status !== 'ready' || !current.result_json) throw new AnalysisError('请先完成材料识别。', 409);
  if (!Number.isInteger(revision) || current.revision !== revision) throw new AnalysisError('核对结果已被更新，请重新加载后再修改。', 409);
  let result: MaterialResult;
  try { result = applyFieldReview(JSON.parse(current.result_json), fields); }
  catch (error) { throw new AnalysisError(error instanceof Error ? error.message : '核对内容格式不正确。'); }
  const saved = await getDatabase().prepare(`UPDATE evidence_analyses SET result_json=?,revision=revision+1,updated_at=?
    WHERE evidence_id=? AND user_id=? AND revision=? AND status='ready'
    AND EXISTS (SELECT 1 FROM evidence_files e JOIN cases c ON c.id=e.case_id AND c.user_id=e.user_id
      WHERE e.id=evidence_analyses.evidence_id AND e.user_id=evidence_analyses.user_id AND e.status IN ('uploaded','needs_review') AND c.status!='archived')`)
    .bind(JSON.stringify(result), new Date().toISOString(), id, user.userId, revision).run();
  if (!saved.meta.changes) throw new AnalysisError('材料或核对结果已变化，请重新加载。', 409);
  return present(await row(user, id));
}
