export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validAmount(value: unknown): boolean {
  if (value === '') return true;
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1_000_000_000;
}

export function validDate(value: unknown): boolean {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function statusForStep(step: number) {
  return step === 4 ? 'completed' : step === 3 ? 'arbitration' : step === 2 ? 'negotiating' : 'collecting';
}

export const templateFields: Record<string, string[]> = {
  'arbitration-application': ['applicantName', 'contact', 'respondent', 'respondentAddress', 'requests', 'facts', 'evidenceList'],
  'wage-demand-letter': ['sender', 'contact', 'recipient', 'amount', 'dueDate', 'facts', 'paymentMethod'],
  'injury-material-checklist': ['worker', 'contact', 'employer', 'injuryDate', 'injuryPlace', 'injuryFacts', 'medicalInstitution', 'materials'],
  'fact-timeline': ['title', 'participants', 'events', 'gaps', 'notes'],
};
