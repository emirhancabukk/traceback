import type { Entry } from './model';
import type { WorkspaceIndex } from './query';

/** A decision that is still in force: proposed or accepted, not replaced or rejected. */
export function isLiveDecision(entry: Entry): boolean {
  return entry.type === 'decision' && entry.status !== 'superseded' && entry.status !== 'rejected';
}

/**
 * True when making `replacementId` the replacement of `decisionId` would
 * create a loop (A replaced by B, B replaced by … A). Also true for the
 * decision itself.
 */
export function createsReplacementLoop(
  lookup: (id: string) => Entry | undefined,
  decisionId: string,
  replacementId: string,
): boolean {
  const seen = new Set<string>();
  let cursor: string | undefined = replacementId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === decisionId) return true;
    seen.add(cursor);
    cursor = lookup(cursor)?.supersededBy;
  }
  return false;
}

/** Decisions that can replace `decisionId`: live ones first, newest first. */
export function replacementCandidates(index: WorkspaceIndex, decisionId: string): Entry[] {
  const lookup = (id: string) => index.byId.get(id);
  return index.workspace.entries
    .filter((entry) => entry.type === 'decision' && !createsReplacementLoop(lookup, decisionId, entry.id))
    .sort(
      (a, b) =>
        Number(isLiveDecision(b)) - Number(isLiveDecision(a)) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.title.localeCompare(b.title),
    );
}
