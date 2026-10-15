import {
  LIMITS,
  SCHEMA_VERSION,
  clampText,
  isDecisionStatus,
  isEntryOrigin,
  isEntryType,
  isLinkKind,
  isRecord,
  isValidId,
  linkKey,
  normalizeTags,
  safeHttpUrl,
  toIsoDate,
  type Entry,
  type EntryOrigin,
  type Link,
  type Workspace,
} from './model';

/** The document could not be used at all (not JSON, wrong kind of file, newer schema). */
export class WorkspaceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceFormatError';
  }
}

export interface ParseResult {
  workspace: Workspace;
  /** Human-readable notes about records that were repaired or skipped. */
  issues: string[];
}

export function parseWorkspaceJson(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WorkspaceFormatError('The file is not valid JSON.');
  }
  return parseWorkspace(value);
}

/**
 * Validates and normalises a workspace. Accepts the stored document, a
 * workspace backup (`format: "traceback.workspace"`) and the legacy v1
 * snapshot (`{ entries, links }` without a schema field). Invalid records
 * are skipped and reported instead of failing the whole document.
 */
export function parseWorkspace(value: unknown): ParseResult {
  if (!isRecord(value)) throw new WorkspaceFormatError('Expected a Traceback workspace object.');
  if (value.format === 'traceback.decision-bundle') {
    throw new WorkspaceFormatError('This is a single-decision export, not a workspace backup.');
  }
  if (value.schema !== undefined && value.schema !== SCHEMA_VERSION) {
    throw new WorkspaceFormatError(
      typeof value.schema === 'number' && value.schema > SCHEMA_VERSION
        ? `This workspace was saved by a newer version of Traceback (schema ${value.schema}).`
        : `Unsupported workspace schema: ${String(value.schema)}.`,
    );
  }
  if (!Array.isArray(value.entries)) throw new WorkspaceFormatError('The workspace has no "entries" list.');

  const legacy = value.schema === undefined;
  const issues: string[] = [];
  const entries = parseEntries(value.entries, legacy, issues);
  const links = parseLinks(Array.isArray(value.links) ? value.links : [], entries, issues);
  resolveSupersededBy(entries, issues);
  const revision =
    typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0
      ? value.revision
      : 0;
  return { workspace: { schema: SCHEMA_VERSION, revision, entries, links }, issues };
}

/** The three entries the v0.1 MVP seeded on first launch. Migrated as example data. */
const LEGACY_SAMPLES = new Set([
  'decision|Use local-first storage for the MVP|Keep project evidence on-device first. A repository boundary leaves room for SQLite when the Tauri shell lands.',
  'source|Product brief|Traceback connects the evidence behind digital work to the decisions that came out of it.',
  'command|npm run build|Validated the first production build of the vertical slice.',
]);

const LEGACY_SELECTION = /^Selected text:\n\n([\s\S]*?)\n\nURL: (\S+)$/;
const LEGACY_PAGE_ONLY = /^Captured from the active browser tab\.\n\nURL: (\S+)$/;

function parseEntries(values: unknown[], legacy: boolean, issues: string[]): Entry[] {
  const entries: Entry[] = [];
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const where = `Entry ${index + 1}`;
    if (!isRecord(value)) return void issues.push(`${where} is not an object and was skipped.`);
    if (!isValidId(value.id)) return void issues.push(`${where} has an invalid id and was skipped.`);
    if (ids.has(value.id)) return void issues.push(`${where} repeats id ${value.id} and was skipped.`);
    if (!isEntryType(value.type)) {
      return void issues.push(`${where} has an unknown type "${String(value.type)}" and was skipped.`);
    }
    const title = typeof value.title === 'string' ? clampText(value.title.trim(), LIMITS.title) : '';
    if (!title) return void issues.push(`${where} has no title and was skipped.`);
    const createdAt = toIsoDate(value.createdAt);
    if (!createdAt) return void issues.push(`${where} has no valid creation date and was skipped.`);

    let body = typeof value.body === 'string' ? clampText(value.body, LIMITS.body) : '';
    const tags = normalizeTags(Array.isArray(value.tags) ? value.tags : []);
    let url = safeHttpUrl(value.url);
    let quote = typeof value.quote === 'string' ? clampText(value.quote, LIMITS.quote) : undefined;
    let origin: EntryOrigin = isEntryOrigin(value.origin) ? value.origin : 'manual';

    if (legacy) {
      if (LEGACY_SAMPLES.has(`${value.type}|${title}|${body}`)) origin = 'example';
      if (value.type === 'source' && tags.includes('browser')) {
        origin = 'browser';
        const selection = LEGACY_SELECTION.exec(body);
        const pageOnly = LEGACY_PAGE_ONLY.exec(body);
        if (selection) {
          quote = selection[1];
          url = safeHttpUrl(selection[2]) ?? url;
          body = '';
        } else if (pageOnly) {
          url = safeHttpUrl(pageOnly[1]) ?? url;
          body = '';
        }
      }
    }

    const entry: Entry = {
      id: value.id,
      type: value.type,
      title,
      body,
      tags,
      createdAt,
      updatedAt: toIsoDate(value.updatedAt) ?? createdAt,
      origin,
    };
    if (url) entry.url = url;
    if (quote?.trim()) entry.quote = quote;
    if (entry.type === 'decision') {
      entry.status = isDecisionStatus(value.status) ? value.status : 'accepted';
      if (isValidId(value.supersededBy)) entry.supersededBy = value.supersededBy;
    }
    ids.add(entry.id);
    entries.push(entry);
  });
  return entries;
}

function parseLinks(values: unknown[], entries: Entry[], issues: string[]): Link[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const links: Link[] = [];
  values.forEach((value, index) => {
    const where = `Link ${index + 1}`;
    if (!isRecord(value)) return void issues.push(`${where} is not an object and was skipped.`);
    const decision = typeof value.decisionId === 'string' ? byId.get(value.decisionId) : undefined;
    const evidence = typeof value.evidenceId === 'string' ? byId.get(value.evidenceId) : undefined;
    if (!decision || !evidence) return void issues.push(`${where} points to a missing entry and was skipped.`);
    if (decision.type !== 'decision' || evidence.type === 'decision') {
      return void issues.push(`${where} must connect a decision to evidence and was skipped.`);
    }
    const key = linkKey(decision.id, evidence.id);
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      decisionId: decision.id,
      evidenceId: evidence.id,
      kind: isLinkKind(value.kind) ? value.kind : 'supports',
      createdAt:
        toIsoDate(value.createdAt) ?? (decision.createdAt > evidence.createdAt ? decision.createdAt : evidence.createdAt),
    });
  });
  return links;
}

function resolveSupersededBy(entries: Entry[], issues: string[]): void {
  const decisions = new Set(entries.filter((entry) => entry.type === 'decision').map((entry) => entry.id));
  for (const entry of entries) {
    if (!entry.supersededBy) continue;
    if (entry.supersededBy === entry.id || !decisions.has(entry.supersededBy)) {
      issues.push(`“${entry.title}” referred to a replacement decision that does not exist; the reference was removed.`);
      delete entry.supersededBy;
    } else {
      entry.status = 'superseded';
    }
  }
}
