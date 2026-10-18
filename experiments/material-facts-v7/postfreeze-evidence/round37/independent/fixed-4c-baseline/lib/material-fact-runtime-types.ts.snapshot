// Runtime transport metadata is separate from the frozen experimental types.
import type { FactJob, FactState, MaterialFactsResponse } from './material-fact-types';

export type RuntimeFactJob = FactJob & { startedAt?: string; submissionPending?: boolean; pollFailureSince?: string };
export type RuntimeFactState = Omit<FactState, 'job'> & { job: RuntimeFactJob | null };
export type RuntimeMaterialFactsResponse = Omit<MaterialFactsResponse, 'state'> & { state: RuntimeFactState };
