import { describe, expect, it } from 'vitest';
import { indexWorkspace, parseQuery, searchEntries, topTags, workspaceStats } from '../src/core/query';
import { makeStore } from './helpers';

function sampleStore() {
  const { store, clock } = makeStore();
  const decision = store.createEntry({ type: 'decision', title: 'Adopt SQLite', tags: ['storage'] });
  clock.advance();
  const proposed = store.createEntry({ type: 'decision', title: 'Try sync', status: 'proposed' });
  clock.advance();
  const bench = store.createEntry({ type: 'command', title: 'Run benchmark', body: 'p95 went down', tags: ['perf', 'storage'] });
  clock.advance();
  const risk = store.createEntry({ type: 'note', title: 'Migration risk', body: 'Old data needs a converter' });
  clock.advance();
  const loose = store.createEntry({ type: 'source', title: 'Blog post', url: 'https://example.com/sqlite', quote: 'WAL mode helps' });
  store.linkEvidence(decision.id, bench.id);
  store.linkEvidence(decision.id, risk.id, 'challenges');
  return { store, decision, proposed, bench, risk, loose };
}

describe('parseQuery', () => {
  it('understands words, phrases and operators', () => {
    const query = parseQuery('sqlite "wal mode" type:decisions #Perf status:proposed is:unlinked tag:x:y');
    expect(query.terms).toEqual(['sqlite', 'wal mode']);
    expect([...query.types]).toEqual(['decision']);
    expect(query.tags).toEqual(['perf', 'x:y']);
    expect([...query.statuses]).toEqual(['proposed']);
    expect([...query.flags]).toEqual(['unlinked']);
  });

  it('treats unknown operators as plain words', () => {
    expect(parseQuery('type:banana is:nice').terms).toEqual(['type:banana', 'is:nice']);
  });
});

describe('searchEntries', () => {
  it('matches title, body, quote, url and tags, newest first', () => {
    const { store, loose, bench } = sampleStore();
    const index = store.index();
    expect(searchEntries(index, 'wal').map((entry) => entry.id)).toEqual([loose.id]);
    expect(searchEntries(index, 'example.com')).toHaveLength(1);
    expect(searchEntries(index, '#perf').map((entry) => entry.id)).toEqual([bench.id]);
    expect(searchEntries(index, '').map((entry) => entry.title)[0]).toBe('Blog post');
  });

  it('filters with is: flags and type', () => {
    const { store, proposed, loose, risk } = sampleStore();
    const index = store.index();
    expect(searchEntries(index, 'is:unsupported').map((entry) => entry.id)).toEqual([proposed.id]);
    expect(searchEntries(index, 'is:unlinked').map((entry) => entry.id)).toEqual([loose.id]);
    expect(searchEntries(index, 'is:challenged')).toHaveLength(1);
    expect(searchEntries(index, 'risk', 'note').map((entry) => entry.id)).toEqual([risk.id]);
    expect(searchEntries(index, 'risk', 'source')).toEqual([]);
  });
});

describe('workspaceStats', () => {
  it('counts coverage and unsupported decisions', () => {
    const { store, proposed } = sampleStore();
    const stats = workspaceStats(store.index());
    expect(stats).toMatchObject({ total: 5, decisions: 2, evidence: 3, linkedEvidence: 2 });
    expect(stats.coverage).toBeCloseTo(2 / 3);
    expect(stats.unsupported.map((entry) => entry.id)).toEqual([proposed.id]);
    expect(stats.challenged).toHaveLength(1);
  });

  it('handles an empty workspace', () => {
    const stats = workspaceStats(indexWorkspace({ schema: 2, revision: 0, entries: [], links: [] }));
    expect(stats.coverage).toBe(0);
    expect(stats.total).toBe(0);
  });
});

describe('topTags', () => {
  it('counts tags case-insensitively', () => {
    const { store } = sampleStore();
    expect(topTags(store.workspace.entries)).toEqual([
      { tag: 'storage', count: 2 },
      { tag: 'perf', count: 1 },
    ]);
  });
});
