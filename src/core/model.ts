/**
 * Traceback's domain model. Pure TypeScript: no DOM, no storage, no UI.
 *
 * A workspace is a list of entries plus links between them. A link always
 * connects one decision to one piece of evidence and says whether that
 * evidence supports or challenges the decision.
 */

export const SCHEMA_VERSION = 2 as const;

export const ENTRY_TYPES = ['source', 'note', 'decision', 'command', 'file-change'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export type EvidenceType = Exclude<EntryType, 'decision'>;
export const EVIDENCE_TYPES: readonly EvidenceType[] = ENTRY_TYPES.filter(
  (type): type is EvidenceType => type !== 'decision',
);

export const DECISION_STATUSES = ['proposed', 'accepted', 'superseded', 'rejected'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const LINK_KINDS = ['supports', 'challenges'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Where an entry came from. `example` entries can be removed in one step. */
export const ENTRY_ORIGINS = ['manual', 'browser', 'import', 'example'] as const;
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

export const LIMITS = {
  id: 128,
  title: 300,
  body: 50_000,
  quote: 20_000,
  url: 2_048,
  tagLength: 40,
  tagsPerEntry: 20,
} as const;

export interface Entry {
  id: string;
  type: EntryType;
  title: string;
  /** Free text written by the user (rationale, notes, command output…). */
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  origin: EntryOrigin;
  /** Page, document, commit or log the entry refers to. http(s) only. */
  url?: string;
  /** Verbatim text selected on a page when it was captured. */
  quote?: string;
  /** Decisions only. */
  status?: DecisionStatus;
  /** Decisions only: id of the decision that replaced this one. */
  supersededBy?: string;
}

export interface Link {
  decisionId: string;
  evidenceId: string;
  kind: LinkKind;
  createdAt: string;
}

export interface Workspace {
  schema: typeof SCHEMA_VERSION;
  /** Incremented on every committed change; lets tabs detect newer copies. */
  revision: number;
  entries: Entry[];
  links: Link[];
}

export interface EntryInput {
  type: EntryType;
  title: string;
  body?: string;
  tags?: string | readonly string[];
  url?: string;
  quote?: string;
  status?: DecisionStatus;
  origin?: EntryOrigin;
  id?: string;
  createdAt?: string;
}

export interface EntryPatch {
  type?: EntryType;
  title?: string;
  body?: string;
  tags?: string | readonly string[];
  /** Empty string removes the URL. */
  url?: string;
  /** Empty string removes the quote. */
  quote?: string;
  status?: DecisionStatus;
  /** Empty string clears the reference. */
  supersededBy?: string;
}

/** Raised for input the user can fix (empty title, bad URL…). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const TYPE_LABELS: Record<EntryType, { one: string; many: string }> = {
  source: { one: 'Source', many: 'Sources' },
  note: { one: 'Note', many: 'Notes' },
  decision: { one: 'Decision', many: 'Decisions' },
  command: { one: 'Command', many: 'Commands' },
  'file-change': { one: 'File change', many: 'File changes' },
};

export const STATUS_LABELS: Record<DecisionStatus, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  superseded: 'Superseded',
  rejected: 'Rejected',
};

export const LINK_LABELS: Record<LinkKind, string> = {
  supports: 'Supports',
  challenges: 'Challenges',
};

export function typeLabel(type: EntryType, plural = false): string {
  return plural ? TYPE_LABELS[type].many : TYPE_LABELS[type].one;
}

export const isEntryType = (value: unknown): value is EntryType =>
  (ENTRY_TYPES as readonly unknown[]).includes(value);
export const isDecisionStatus = (value: unknown): value is DecisionStatus =>
  (DECISION_STATUSES as readonly unknown[]).includes(value);
export const isLinkKind = (value: unknown): value is LinkKind => (LINK_KINDS as readonly unknown[]).includes(value);
export const isEntryOrigin = (value: unknown): value is EntryOrigin =>
  (ENTRY_ORIGINS as readonly unknown[]).includes(value);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LIMITS.id && ID_PATTERN.test(value);
}

/**
 * UUID v4. `crypto.randomUUID` only exists in secure contexts, so fall back
 * to `getRandomValues` when the app is served from a plain-http LAN address.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyWorkspace(): Workspace {
  return { schema: SCHEMA_VERSION, revision: 0, entries: [], links: [] };
}

/** Trims to `max` UTF-16 units without splitting a surrogate pair. */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return value.slice(0, end);
}

/** Returns a canonical ISO timestamp, or undefined for anything unparseable. */
export function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Accepts http(s) URLs only and strips embedded credentials, so a captured
 * `https://user:secret@host/` never lands in the trail.
 */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > LIMITS.url) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Normalises tags from a comma-separated string or a list: trims, drops a
 * leading `#`, turns inner whitespace into `-`, and removes duplicates
 * case-insensitively while keeping the first spelling.
 */
export function normalizeTags(input: string | readonly unknown[] | undefined): string[] {
  const raw = typeof input === 'string' ? input.split(',') : input ?? [];
  const seen = new Map<string, string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const tag = clampText(value.trim().replace(/^#+/, '').replace(/\s+/g, '-'), LIMITS.tagLength);
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) seen.set(key, tag);
    if (seen.size >= LIMITS.tagsPerEntry) break;
  }
  return [...seen.values()];
}

export function linkKey(decisionId: string, evidenceId: string): string {
  return `${decisionId}>${evidenceId}`;
}

export function cloneWorkspace(workspace: Workspace): Workspace {
  return {
    schema: SCHEMA_VERSION,
    revision: workspace.revision,
    entries: workspace.entries.map((entry) => ({ ...entry, tags: [...entry.tags] })),
    links: workspace.links.map((link) => ({ ...link })),
  };
}
