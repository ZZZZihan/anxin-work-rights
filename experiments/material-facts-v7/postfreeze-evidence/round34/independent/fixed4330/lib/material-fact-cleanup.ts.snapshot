import { getDatabase } from './server';
import { callMaterialService } from './material-service-client';

const cleanupBatchLimit = 5;
const validJobId = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !value.startsWith('starting_');

// Used for a remote job returned after a failed CAS, which never entered a fact
// row. Callers supply the authenticated owner/case of that dispatch, never IDs
// from request-owned state. Normal state replacements are journalled by D1.
export async function enqueueMaterialFactCleanup(userId: string, caseId: string, jobId: string): Promise<void> {
  if (!validJobId(jobId)) return;
  await getDatabase().prepare(`INSERT OR IGNORE INTO case_material_fact_cleanup(user_id,case_id,job_id,queued_at)
    VALUES (?,?,?,?)`).bind(userId, caseId, jobId, new Date().toISOString()).run();
}

// Call only after the route has checked ownership. Every read/delete remains
// scoped to that owner and case; failures preserve the ID without private text.
// Stop on the first failure so an unavailable service costs one timeout, and
// cap successful work so a backlog cannot monopolise an interactive request.
export async function retryMaterialFactCleanup(userId: string, caseId: string): Promise<boolean> {
  const db = getDatabase();
  const queued = await db.prepare(`SELECT job_id FROM case_material_fact_cleanup
    WHERE user_id=? AND case_id=? ORDER BY queued_at,job_id LIMIT ?`)
    .bind(userId, caseId, cleanupBatchLimit).all<{ job_id: string }>();
  for (const { job_id: jobId } of queued.results) {
    if (!validJobId(jobId)) return true;
    try {
      await callMaterialService(`/fact-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    } catch {
      return true;
    }
    await db.prepare('DELETE FROM case_material_fact_cleanup WHERE user_id=? AND case_id=? AND job_id=?')
      .bind(userId, caseId, jobId).run();
  }
  return Boolean(await db.prepare('SELECT 1 FROM case_material_fact_cleanup WHERE user_id=? AND case_id=? LIMIT 1')
    .bind(userId, caseId).first());
}
