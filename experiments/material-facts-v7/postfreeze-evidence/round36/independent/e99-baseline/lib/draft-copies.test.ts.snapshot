import { describe, expect, it } from 'vitest';
import { finishDraftSave, mergeRemoteDrafts, resolveDraftCopy } from './draft-copies';
import type { DocumentDraft } from './types';

const type = 'arbitration-application';
const remote = (name: string, revision: number): DocumentDraft => ({
  id: 'draft', caseId: 'case', type, fields: { applicantName: name }, revision, updatedAt: '2026-10-08T00:00:00Z',
});

describe('draft recovery', () => {
  it('uses fresh server text instead of a stale saved session copy', () => {
    const state = resolveDraftCopy(type, { fields: { applicantName: 'old saved' }, revision: 1, saved: true }, remote('new server', 2), {});
    expect(state.fields.applicantName).toBe('new server');
    expect(state.revision).toBe(2);
    expect(state.saved).toBe(true);
    expect(state.conflict).toBe(false);
  });

  it('preserves dirty text and its old revision after a bootstrap refresh', () => {
    const state = resolveDraftCopy(type, { fields: { applicantName: 'unsaved local' }, revision: 0, saved: false }, remote('other tab', 1), {});
    expect(state.fields.applicantName).toBe('unsaved local');
    expect(state.revision).toBe(0);
    expect(state.saved).toBe(false);
    expect(state.conflict).toBe(true);
  });

  it('does not treat unchanged base revisions as a conflict', () => {
    expect(resolveDraftCopy(type, { fields: { applicantName: 'local edit' }, revision: 2, saved: false }, remote('server', 2), {}).conflict).toBe(false);
  });

  it('removes a saved working copy so future server updates are visible', () => {
    expect(finishDraftSave(type, undefined, { applicantName: 'submitted' }, 0, remote('submitted', 1))).toBeUndefined();
    expect(finishDraftSave(type, { fields: { applicantName: 'legacy saved' }, revision: 1, saved: true }, { applicantName: 'submitted' }, 2, remote('submitted', 3))).toBeUndefined();
  });

  it('preserves typing during a pending save and builds on that saved revision', () => {
    const copy = finishDraftSave(type, { fields: { applicantName: 'continued typing' }, revision: 0, saved: false }, { applicantName: 'submitted' }, 0, remote('submitted', 1));
    expect(copy?.fields.applicantName).toBe('continued typing');
    expect(copy?.revision).toBe(1);
    expect(copy?.saved).toBe(false);
  });

  it('does not silently adopt a revision if a response contains different remote text', () => {
    const copy = finishDraftSave(type, { fields: { applicantName: 'my text' }, revision: 1, saved: false }, { applicantName: 'my text' }, 1, remote('other text', 3));
    expect(copy?.fields.applicantName).toBe('my text');
    expect(copy?.revision).toBe(1);
    expect(resolveDraftCopy(type, copy, remote('other text', 3), {}).conflict).toBe(true);
  });

  it('does not downgrade a newer saved draft with a delayed bootstrap response', () => {
    expect(mergeRemoteDrafts([remote('newer', 3)], [remote('older', 2)])[0].fields.applicantName).toBe('newer');
  });
});
