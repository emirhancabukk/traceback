import { isLiveDecision } from './decisions';
import { EVIDENCE_TYPES, type Entry, type EvidenceType } from './model';
import { entryMatches, evidenceFor, hasFilters, parseQuery, type Connected, type WorkspaceIndex } from './query';

/**
 * The trace map shows one row per decision: the evidence that supports it on
 * one side, the evidence that challenges it on the other, and the decisions
 * it replaced. This module builds that view model; it has no DOM access.
 */

export const TRACE_FILTERS = ['live', 'accepted', 'proposed', 'challenged', 'unsupported'] as const;
export type TraceFilter = (typeof TRACE_FILTERS)[number];

export interface ReplacedDecision {
  entry: Entry;
  /** How much evidence challenged the replaced decision. */
  against: number;
}

export interface TraceRow {
  decision: Entry;
  live: boolean;
  supports: Connected[];
  challenges: Connected[];
  /** Older decisions this one replaced, oldest first. */
  replaces: ReplacedDecision[];
  replacedBy?: Entry;
}

export interface TraceSummary {
  liveDecisions: number;
  /** Supporting links on live decisions. */
  supportingLinks: number;
  /** Challenging links on live decisions. */
  openChallenges: number;
  /** Live decisions without any supporting evidence. */
  unsupported: number;
  evidenceByType: Record<EvidenceType, number>;
  superseded: number;
  rejected: number;
}

export interface TraceMapOptions {
  filter?: TraceFilter;
  /** Also show replaced and rejected decisions. */
  showClosed?: boolean;
  search?: string;
}

export interface TraceMap {
  rows: TraceRow[];
  /** Rows each filter would show with the current search and closed setting. */
  counts: Record<TraceFilter, number>;
  /** Evidence not connected to any decision, newest first (search applies). */
  unlinked: Entry[];
  /** How many decisions each evidence entry is connected to. */
  linkCounts: ReadonlyMap<string, number>;
  /** Entries matching the search; undefined when there is no search. */
  matches?: ReadonlySet<string>;
  summary: TraceSummary;
}

const PREDICATES: Record<TraceFilter, (row: TraceRow) => boolean> = {
  live: () => true,
  accepted: (row) => row.decision.status === 'accepted',
  proposed: (row) => row.decision.status === 'proposed',
  challenged: (row) => row.challenges.length > 0,
  unsupported: (row) => row.supports.length === 0,
};

export function buildTraceMap(index: WorkspaceIndex, options: TraceMapOptions = {}): TraceMap {
  const { filter = 'live', showClosed = false, search = '' } = options;
  const query = parseQuery(search);
  const matches = hasFilters(query)
    ? new Set(index.workspace.entries.filter((entry) => entryMatches(index, entry, query)).map((entry) => entry.id))
    : undefined;

  const decisions = index.workspace.entries.filter((entry) => entry.type === 'decision');
  const replacedBy = new Map<string, Entry[]>();
  for (const decision of decisions) {
    if (!decision.supersededBy) continue;
    const list = replacedBy.get(decision.supersededBy);
    if (list) list.push(decision);
    else replacedBy.set(decision.supersededBy, [decision]);
  }
  const challengeCount = (decisionId: string) =>
    index.linksByDecision.get(decisionId)?.filter((link) => link.kind === 'challenges').length ?? 0;

  const all: TraceRow[] = decisions.map((decision) => {
    const evidence = evidenceFor(index, decision.id);
    const replacement = decision.supersededBy ? index.byId.get(decision.supersededBy) : undefined;
    return {
      decision,
      live: isLiveDecision(decision),
      supports: evidence.filter(({ link }) => link.kind === 'supports'),
      challenges: evidence.filter(({ link }) => link.kind === 'challenges'),
      replaces: (replacedBy.get(decision.id) ?? [])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((entry) => ({ entry, against: challengeCount(entry.id) })),
      ...(replacement ? { replacedBy: replacement } : {}),
    };
  });

  const evidenceByType = Object.fromEntries(EVIDENCE_TYPES.map((type) => [type, 0])) as Record<EvidenceType, number>;
  const linkCounts = new Map<string, number>();
  for (const entry of index.workspace.entries) {
    if (entry.type === 'decision') continue;
    evidenceByType[entry.type] += 1;
    const count = index.linksByEvidence.get(entry.id)?.length ?? 0;
    if (count) linkCounts.set(entry.id, count);
  }

  const live = all.filter((row) => row.live);
  const summary: TraceSummary = {
    liveDecisions: live.length,
    supportingLinks: live.reduce((sum, row) => sum + row.supports.length, 0),
    openChallenges: live.reduce((sum, row) => sum + row.challenges.length, 0),
    unsupported: live.filter((row) => !row.supports.length).length,
    evidenceByType,
    superseded: decisions.filter((decision) => decision.status === 'superseded').length,
    rejected: decisions.filter((decision) => decision.status === 'rejected').length,
  };

  const rowMatches = (row: TraceRow) =>
    !matches ||
    matches.has(row.decision.id) ||
    row.supports.some(({ entry }) => matches.has(entry.id)) ||
    row.challenges.some(({ entry }) => matches.has(entry.id)) ||
    row.replaces.some(({ entry }) => matches.has(entry.id));
  const candidates = all.filter((row) => (row.live || showClosed) && rowMatches(row));
  const counts = Object.fromEntries(
    TRACE_FILTERS.map((name) => [name, candidates.filter(PREDICATES[name]).length]),
  ) as Record<TraceFilter, number>;
  const rows = candidates
    .filter(PREDICATES[filter])
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) ||
        b.decision.createdAt.localeCompare(a.decision.createdAt) ||
        a.decision.title.localeCompare(b.decision.title),
    );

  const unlinked = index.workspace.entries
    .filter((entry) => entry.type !== 'decision' && !linkCounts.has(entry.id) && (!matches || matches.has(entry.id)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { rows, counts, unlinked, linkCounts, ...(matches ? { matches } : {}), summary };
}
