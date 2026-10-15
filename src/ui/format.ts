import { clampText } from '../core/model';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };

/** Every piece of user text goes through this before it reaches innerHTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dayMonth = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** `Oct 15, 2026, 7:42 PM` in the reader's locale. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** `Oct 15 · 19:42`, used on compact cards. */
export function formatShort(iso: string): string {
  const date = new Date(iso);
  return `${dayMonth.format(date)} · ${clock.format(date)}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${clampText(text, max - 1).trimEnd()}…` : text;
}
