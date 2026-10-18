import type { DocumentDraft } from './types';
import { templateFields } from './validation';

export type WorkingCopy = { fields: Record<string, string>; revision: number; saved: boolean };

export function normalizeDraftFields(type: string, fields: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(templateFields[type].map((key) => [key, fields[key] ?? '']));
}

export function resolveDraftCopy(type: string, copy: WorkingCopy | undefined, remote: DocumentDraft | undefined, defaults: Record<string, string>) {
  // Saved copies are only a legacy cache. The bootstrap document is authoritative.
  const dirty = copy && !copy.saved ? copy : undefined;
  const remoteRevision = remote?.revision ?? 0;
  return {
    fields: normalizeDraftFields(type, dirty?.fields ?? remote?.fields ?? defaults),
    revision: dirty?.revision ?? remoteRevision,
    saved: !dirty && Boolean(remote),
    conflict: Boolean(dirty && dirty.revision !== remoteRevision),
  };
}

export function finishDraftSave(type: string, copy: WorkingCopy | undefined, submittedFields: Record<string, string>, submittedRevision: number, remote: DocumentDraft): WorkingCopy | undefined {
  const dirty = copy && !copy.saved ? copy : undefined;
  const fields = normalizeDraftFields(type, dirty?.fields ?? submittedFields);
  const remoteFields = normalizeDraftFields(type, remote.fields);
  if (JSON.stringify(fields) === JSON.stringify(remoteFields)) return undefined;
  // Edits made while this save was in flight build on our saved version. A response
  // containing someone else's text must remain a conflict, not silently rebase.
  const savedOurText = JSON.stringify(normalizeDraftFields(type, submittedFields)) === JSON.stringify(remoteFields);
  return { fields, revision: savedOurText ? remote.revision : dirty?.revision ?? submittedRevision, saved: false };
}

export function mergeRemoteDrafts(current: DocumentDraft[], incoming: DocumentDraft[]): DocumentDraft[] {
  const drafts = new Map(current.map((draft) => [`${draft.caseId}:${draft.type}`, draft]));
  for (const draft of incoming) {
    const key = `${draft.caseId}:${draft.type}`;
    if ((drafts.get(key)?.revision ?? -1) <= draft.revision) drafts.set(key, draft);
  }
  return [...drafts.values()];
}
