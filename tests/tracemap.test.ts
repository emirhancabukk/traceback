import { describe, expect, it } from 'vitest';
import { isLiveDecision } from '../src/core/decisions';
import { indexWorkspace } from '../src/core/query';
import { buildTraceMap } from '../src/core/tracemap';
import { EXAMPLE_WORKSPACE } from '../src/core/example';
import { makeStore } from './helpers';

const example = () => indexWorkspace({ ...EXAMPLE_WORKSPACE, entries: [...EXAMPLE_WORKSPACE.entries], links: [...EXAMPLE_WORKSPACE.links] });

describe('buildTraceMap', () => {
  it('has one row per live decision, newest first', () => {
    const index = example();
    const map = buildTraceMap(index);
    const live = EXAMPLE_WORKSPACE.entries.filter(isLiveDecision);
    expect(map.rows).toHaveLength(live.length);
    const created = map.rows.map((row) => row.decision.createdAt);
    expect(created).toEqual([...created].sort().reverse());
    expect(map.rows.every((row) => row.live)).toBe(true);
  });

  it('splits evidence by relation and records replaced decisions', () => {
    const row = buildTraceMap(example()).rows.find((candidate) => candidate.decision.id === 'example-d-reread')!;
    expect(row.supports.map(({ entry }) => entry.id).sort()).toEqual(['example-c-multitab', 'example-f-store', 'example-n-newtab']);
    expect(row.challenges.map(({ entry }) => entry.id)).toEqual(['example-n-race']);
    expect(row.replaces).toEqual([{ entry: expect.objectContaining({ id: 'example-d-snapshot' }), against: 2 }]);
  });

  it('filters and counts with the same candidate set', () => {
    const index = example();
    const map = buildTraceMap(index, { filter: 'proposed' });
    expect(map.rows.map((row) => row.decision.id)).toEqual(['example-d-replay']);
    expect(map.counts.proposed).toBe(1);
    expect(map.counts.live).toBe(buildTraceMap(index).rows.length);
    expect(buildTraceMap(index, { filter: 'challenged' }).rows.every((row) => row.challenges.length > 0)).toBe(true);
    expect(buildTraceMap(index, { filter: 'unsupported' }).rows).toEqual([]);
  });

  it('appends replaced and rejected decisions after the live ones when asked', () => {
    const map = buildTraceMap(example(), { showClosed: true });
    const closed = map.rows.filter((row) => !row.live);
    expect(closed.map((row) => row.decision.id).sort()).toEqual(['example-d-fragment', 'example-d-snapshot']);
    expect(map.rows.slice(-2).every((row) => !row.live)).toBe(true);
    expect(closed[0].replacedBy?.type).toBe('decision');
  });

  it('finds decisions through the evidence that matches the search', () => {
    const map = buildTraceMap(example(), { search: 'MDN' });
    expect(map.rows.map((row) => row.decision.id)).toEqual(['example-d-bridge']);
    expect(map.matches?.has('example-s-mdn')).toBe(true);
    expect(buildTraceMap(example(), { search: 'Keep the trail in memory' }).rows.map((row) => row.decision.id)).toEqual(['example-d-reread']);
  });

  it('summarises live decisions and counts shared evidence', () => {
    const index = example();
    const map = buildTraceMap(index);
    const liveIds = new Set(EXAMPLE_WORKSPACE.entries.filter(isLiveDecision).map((entry) => entry.id));
    const linksOnLive = EXAMPLE_WORKSPACE.links.filter((link) => liveIds.has(link.decisionId));
    expect(map.summary.liveDecisions).toBe(liveIds.size);
    expect(map.summary.supportingLinks).toBe(linksOnLive.filter((link) => link.kind === 'supports').length);
    expect(map.summary.openChallenges).toBe(linksOnLive.filter((link) => link.kind === 'challenges').length);
    expect(map.summary.superseded).toBe(2);
    expect(map.linkCounts.get('example-c-multitab')).toBe(2);
    expect(Object.values(map.summary.evidenceByType).reduce((sum, count) => sum + count, 0)).toBe(
      EXAMPLE_WORKSPACE.entries.filter((entry) => entry.type !== 'decision').length,
    );
  });

  it('lists unconnected evidence and decisions without support', () => {
    const { store } = makeStore();
    store.createEntry({ type: 'decision', title: 'Lonely decision' });
    store.createEntry({ type: 'note', title: 'Loose note' });
    const map = buildTraceMap(store.index());
    expect(map.unlinked.map((entry) => entry.title)).toEqual(['Loose note']);
    expect(map.summary.unsupported).toBe(1);
    expect(buildTraceMap(store.index(), { filter: 'unsupported' }).rows).toHaveLength(1);
    expect(buildTraceMap(store.index(), { search: 'nothing like this' }).unlinked).toEqual([]);
  });
});
