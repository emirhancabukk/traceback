import {
  ENTRY_TYPES,
  STATUS_LABELS,
  isDecisionStatus,
  isEntryType,
  typeLabel,
  type DecisionStatus,
  type Entry,
  type EntryType,
  type Link,
  type Workspace,
} from './model';

/** Read-optimised view of a workspace. Built once per revision. */
export interface WorkspaceIndex {
  readonly workspace: Workspace;
  readonly byId: ReadonlyMap<string, Entry>;
  readonly linksByDecision: ReadonlyMap<string, readonly Link[]>;
  readonly linksByEvidence: ReadonlyMap<string, readonly Link[]>;
}

export function indexWorkspace(workspace: Workspace): WorkspaceIndex {
  const byId = new Map(workspace.entries.map((entry) => [entry.id, entry]));
  const linksByDecision = new Map<string, Link[]>();
  const linksByEvidence = new Map<string, Link[]>();
  for (const link of workspace.links) {
    push(linksByDecision, link.decisionId, link);
    push(linksByEvidence, link.evidenceId, link);
  }
  return { workspace, byId, linksByDecision, linksByEvidence };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export interface Connected {
  entry: Entry;
  link: Link;
}

export function evidenceFor(index: WorkspaceIndex, decisionId: string): Connected[] {
  return connected(index, index.linksByDecision.get(decisionId), 'evidenceId');
}

export function decisionsFor(index: WorkspaceIndex, evidenceId: string): Connected[] {
  return connected(index, index.linksByEvidence.get(evidenceId), 'decisionId');
}

function connected(index: WorkspaceIndex, links: readonly Link[] | undefined, side: 'evidenceId' | 'decisionId') {
  const result: Connected[] = [];
  for (const link of links ?? []) {
    const entry = index.byId.get(link[side]);
    if (entry) result.push({ entry, link });
  }
  return result.sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt));
}

export const SEARCH_FLAGS = ['unlinked', 'unsupported', 'challenged', 'example'] as const;
export type SearchFlag = (typeof SEARCH_FLAGS)[number];

export interface ParsedQuery {
  terms: string[];
  types: Set<EntryType>;
  tags: string[];
  statuses: Set<DecisionStatus>;
  flags: Set<SearchFlag>;
}

/**
 * Parses the search box. Plain words and "quoted phrases" must all match;
 * operators narrow the result:
 *   type:decision   tag:pricing (or #pricing)   status:proposed
 *   is:unlinked (evidence with no decision)   is:unsupported (decisions with
 *   no supporting evidence)   is:challenged   is:example
 */
export function parseQuery(text: string): ParsedQuery {
  const query: ParsedQuery = { terms: [], types: new Set(), tags: [], statuses: new Set(), flags: new Set() };
  const tokens = text.match(/"[^"]*"|\S+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('"')) {
      const phrase = token.slice(1, -1).trim().toLocaleLowerCase();
      if (phrase) query.terms.push(phrase);
      continue;
    }
    const [operator, ...rest] = token.split(':');
    const value = rest.join(':').toLocaleLowerCase();
    const op = operator.toLocaleLowerCase();
    if (rest.length && value) {
      if (op === 'type') {
        const type = value === 'file' || value === 'filechange' ? 'file-change' : value.replace(/s$/, '');
        if (isEntryType(type)) {
          query.types.add(type);
          continue;
        }
      }
      if (op === 'tag') {
        query.tags.push(value.replace(/^#/, ''));
        continue;
      }
      if (op === 'status' && isDecisionStatus(value)) {
        query.statuses.add(value);
        continue;
      }
      if (op === 'is' && (SEARCH_FLAGS as readonly string[]).includes(value)) {
        query.flags.add(value as SearchFlag);
        continue;
      }
    }
    if (token.length > 1 && token.startsWith('#')) {
      query.tags.push(token.slice(1).toLocaleLowerCase());
      continue;
    }
    query.terms.push(token.toLocaleLowerCase());
  }
  return query;
}

export function hasFilters(query: ParsedQuery): boolean {
  return Boolean(query.terms.length || query.types.size || query.tags.length || query.statuses.size || query.flags.size);
}

export function searchEntries(index: WorkspaceIndex, text: string, type: EntryType | 'all' = 'all'): Entry[] {
  const query = parseQuery(text);
  return index.workspace.entries
    .filter((entry) => (type === 'all' || entry.type === type) && matches(index, entry, query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title));
}

function matches(index: WorkspaceIndex, entry: Entry, query: ParsedQuery): boolean {
  if (query.types.size && !query.types.has(entry.type)) return false;
  if (query.statuses.size && !(entry.status && query.statuses.has(entry.status))) return false;
  const tags = entry.tags.map((tag) => tag.toLocaleLowerCase());
  if (!query.tags.every((tag) => tags.includes(tag))) return false;
  for (const flag of query.flags) if (!hasFlag(index, entry, flag)) return false;
  if (!query.terms.length) return true;
  const haystack = [
    entry.title,
    entry.body,
    entry.quote ?? '',
    entry.url ?? '',
    typeLabel(entry.type),
    entry.status ? STATUS_LABELS[entry.status] : '',
    ...entry.tags,
  ]
    .join('\n')
    .toLocaleLowerCase();
  return query.terms.every((term) => haystack.includes(term));
}

function hasFlag(index: WorkspaceIndex, entry: Entry, flag: SearchFlag): boolean {
  switch (flag) {
    case 'unlinked':
      return entry.type !== 'decision' && !index.linksByEvidence.get(entry.id)?.length;
    case 'unsupported':
      return entry.type === 'decision' && !index.linksByDecision.get(entry.id)?.some((link) => link.kind === 'supports');
    case 'challenged':
      return entry.type === 'decision' && Boolean(index.linksByDecision.get(entry.id)?.some((l) => l.kind === 'challenges'));
    case 'example':
      return entry.origin === 'example';
  }
}

export interface WorkspaceStats {
  total: number;
  byType: Record<EntryType, number>;
  decisions: number;
  /** Decisions with no supporting evidence (rejected/superseded ones excluded). */
  unsupported: Entry[];
  challenged: Entry[];
  evidence: number;
  linkedEvidence: number;
  /** Share of evidence connected to at least one decision, 0–1. */
  coverage: number;
  examples: number;
}

export function workspaceStats(index: WorkspaceIndex): WorkspaceStats {
  const byType = Object.fromEntries(ENTRY_TYPES.map((type) => [type, 0])) as Record<EntryType, number>;
  const unsupported: Entry[] = [];
  const challenged: Entry[] = [];
  let linkedEvidence = 0;
  let examples = 0;
  for (const entry of index.workspace.entries) {
    byType[entry.type] += 1;
    if (entry.origin === 'example') examples += 1;
    if (entry.type === 'decision') {
      const live = entry.status !== 'rejected' && entry.status !== 'superseded';
      if (live && hasFlag(index, entry, 'unsupported')) unsupported.push(entry);
      if (hasFlag(index, entry, 'challenged')) challenged.push(entry);
    } else if (index.linksByEvidence.get(entry.id)?.length) {
      linkedEvidence += 1;
    }
  }
  const evidence = index.workspace.entries.length - byType.decision;
  return {
    total: index.workspace.entries.length,
    byType,
    decisions: byType.decision,
    unsupported,
    challenged,
    evidence,
    linkedEvidence,
    coverage: evidence ? linkedEvidence / evidence : 0,
    examples,
  };
}

export function topTags(entries: readonly Entry[], limit = 12): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, limit);
}
