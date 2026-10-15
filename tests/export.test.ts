import { describe, expect, it } from 'vitest';
import {
  buildDecisionBundle,
  bundleToJson,
  bundleToMarkdown,
  escapeMarkdown,
  exportFilename,
  workspaceToJson,
} from '../src/core/export';
import { parseWorkspaceJson } from '../src/core/schema';
import { makeStore } from './helpers';

const exportedAt = new Date('2026-10-15T18:00:00.000Z');

function bundleFixture() {
  const { store, clock } = makeStore();
  const old = store.createEntry({ type: 'decision', title: 'Old approach' });
  clock.advance(10);
  const decision = store.createEntry({ type: 'decision', title: 'Use <SQLite> *now*', body: 'Because it is boring.', tags: ['storage'] });
  store.updateEntry(old.id, { supersededBy: decision.id });
  const source = store.createEntry({ type: 'source', title: 'Docs', url: 'https://sqlite.org/wal.html', quote: 'WAL is faster\n<b>really</b>' });
  const risk = store.createEntry({ type: 'note', title: 'Risk', body: 'Needs a migration.' });
  store.linkEvidence(decision.id, source.id);
  store.linkEvidence(decision.id, risk.id, 'challenges');
  return { store, decision, old };
}

describe('decision bundles', () => {
  it('splits supporting and challenging evidence and records supersession', () => {
    const { store, decision, old } = bundleFixture();
    const bundle = buildDecisionBundle(store.index(), decision.id);
    expect(bundle.supports.map(({ entry }) => entry.title)).toEqual(['Docs']);
    expect(bundle.challenges.map(({ entry }) => entry.title)).toEqual(['Risk']);
    expect(bundle.supersedes.map((entry) => entry.id)).toEqual([old.id]);
    expect(() => buildDecisionBundle(store.index(), 'missing')).toThrow();
  });

  it('writes deterministic, escaped Markdown', () => {
    const { store, decision } = bundleFixture();
    const markdown = bundleToMarkdown(buildDecisionBundle(store.index(), decision.id), exportedAt);
    expect(markdown).toContain('# Use \\<SQLite\\> \\*now\\*');
    expect(markdown).toContain('**Status:** Accepted · **Recorded:** 2026-10-15 12:10 UTC');
    expect(markdown).toContain('## Supporting evidence (1)');
    expect(markdown).toContain('## Challenging evidence (1)');
    expect(markdown).toContain('<https://sqlite.org/wal.html>');
    expect(markdown).toContain('> WAL is faster\n> \\<b\\>really\\</b\\>');
    expect(markdown).toContain('## Replaces');
    expect(markdown).toContain('Exported from Traceback on 2026-10-15T18:00:00.000Z.');
  });

  it('exports structured JSON with relations', () => {
    const { store, decision } = bundleFixture();
    const json = JSON.parse(bundleToJson(buildDecisionBundle(store.index(), decision.id), exportedAt));
    expect(json).toMatchObject({ format: 'traceback.decision-bundle', version: 1, exportedAt: exportedAt.toISOString() });
    expect(json.evidence.map((item: { relation: string }) => item.relation)).toEqual(['supports', 'challenges']);
  });
});

describe('workspace backups', () => {
  it('round-trips through the importer without issues', () => {
    const { store } = bundleFixture();
    const { workspace, issues } = parseWorkspaceJson(workspaceToJson(store.workspace, exportedAt));
    expect(issues).toEqual([]);
    expect(workspace.entries).toEqual(store.workspace.entries);
    expect(workspace.links).toEqual(store.workspace.links);
  });
});

describe('helpers', () => {
  it('escapes inline Markdown and collapses newlines', () => {
    expect(escapeMarkdown('a_b\n[c]|`d`')).toBe('a\\_b \\[c\\]\\|\\`d\\`');
  });

  it('builds readable ASCII filenames', () => {
    expect(exportFilename('Kararı İstanbul’da verdik!', 'md', exportedAt)).toBe('traceback-karari-istanbul-da-verdik-2026-10-15.md');
    expect(exportFilename('???', 'json', exportedAt)).toBe('traceback-export-2026-10-15.json');
  });
});
