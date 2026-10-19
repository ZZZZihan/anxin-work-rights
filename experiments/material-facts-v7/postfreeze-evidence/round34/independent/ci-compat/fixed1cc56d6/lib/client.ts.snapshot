import { validDate } from './validation';

export async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || '请求没有成功，请稍后重试。');
  return body;
}

export function formatDate(value: string | null, withYear = false): string {
  if (!value) return '未设置';
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(date);
}

export function daysUntil(value: string | null): number | null {
  if (!value || !validDate(value)) return null;
  const now = new Date();
  // Compare calendar dates in the user's timezone. Encoding both dates at UTC
  // midnight avoids the 23/25-hour days caused by daylight-saving transitions.
  const today = new Date(0);
  today.setUTCFullYear(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(`${value}T00:00:00Z`).getTime();
  return (target - today.getTime()) / 86_400_000;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '示例记录';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '安';
}
