import { describe, expect, it, vi } from 'vitest';
import { LEGACY_STORAGE_KEY, STORAGE_KEY, StorageFullError, TimelineStore } from '../src/core/store';
import { ValidationError } from '../src/core/model';
import { workspaceToJson } from '../src/core/export';
import { MemoryStorage, makeStore, sequentialIds, testClock } from './helpers';

describe('TimelineStore entries', () => {
  it('creates, normalises and persists entries', () => {
    const { store, storage } = makeStore();
    const entry = store.createEntry({
      type: 'source',
      title: '  Pricing   page ',
      body: ' Details ',
      tags: 'Research, #research, pricing page',
      url: 'https://user:secret@example.com/pricing',
    });
    expect(entry).toMatchObject({
      id: 'id-1',
      title: 'Pricing page',
      body: 'Details',
      tags: ['Research', 'pricing-page'],
      url: 'https://example.com/pricing',
      origin: 'manual',
      createdAt: '2026-10-15T12:00:00.000Z',
    });
    const reopened = new TimelineStore({ storage });
    expect(reopened.get('id-1')?.title).toBe('Pricing page');
  });

  it('gives decisions a status and rejects bad input', () => {
    const { store } = makeStore();
    expect(store.createEntry({ type: 'decision', title: 'Ship it' }).status).toBe('accepted');
    expect(() => store.createEntry({ type: 'note', title: '   ' })).toThrow(ValidationError);
    expect(() => store.createEntry({ type: 'note', title: 'x', url: 'javascript:alert(1)' })).toThrow(ValidationError);
    expect(() => store.createEntry({ type: 'nope' as never, title: 'x' })).toThrow(ValidationError);
  });

  it('returns copies so callers cannot mutate stored state', () => {
    const { store } = makeStore();
    const entry = store.createEntry({ type: 'note', title: 'Original', tags: ['a'] });
    entry.title = 'Changed';
    entry.tags.push('b');
    expect(store.get(entry.id)).toMatchObject({ title: 'Original', tags: ['a'] });
  });

  it('updates fields and bumps updatedAt', () => {
    const { store, clock } = makeStore();
    const note = store.createEntry({ type: 'note', title: 'Draft', url: 'https://example.com' });
    clock.advance(5);
    const updated = store.updateEntry(note.id, { title: 'Final', url: '', tags: 'done' });
    expect(updated).toMatchObject({ title: 'Final', tags: ['done'], updatedAt: '2026-10-15T12:05:00.000Z' });
    expect(updated.url).toBeUndefined();
  });

  it('refuses to turn a linked decision into evidence', () => {
    const { store } = makeStore();
    const decision = store.createEntry({ type: 'decision', title: 'Decide' });
    const source = store.createEntry({ type: 'source', title: 'Source' });
    store.linkEvidence(decision.id, source.id);
    expect(() => store.updateEntry(decision.id, { type: 'note' })).toThrow(/Remove this entry's links/);
    store.unlinkEvidence(decision.id, source.id);
    const note = store.updateEntry(decision.id, { type: 'note' });
    expect(note.status).toBeUndefined();
  });

  it('tracks supersession between decisions', () => {
    const { store } = makeStore();
    const old = store.createEntry({ type: 'decision', title: 'Old' });
    const replacement = store.createEntry({ type: 'decision', title: 'New' });
    expect(store.updateEntry(old.id, { supersededBy: replacement.id })).toMatchObject({ status: 'superseded', supersededBy: replacement.id });
    expect(() => store.updateEntry(old.id, { supersededBy: old.id })).toThrow(ValidationError);
    expect(store.updateEntry(old.id, { status: 'accepted' }).supersededBy).toBeUndefined();
  });

  it('deletes an entry with its links and restores both', () => {
    const { store } = makeStore();
    const decision = store.createEntry({ type: 'decision', title: 'Decide' });
    const later = store.createEntry({ type: 'decision', title: 'Later' });
    const source = store.createEntry({ type: 'source', title: 'Source' });
    store.linkEvidence(decision.id, source.id, 'challenges');
    store.updateEntry(decision.id, { supersededBy: later.id });

    const deletedSource = store.deleteEntry(source.id);
    expect(store.workspace.links).toHaveLength(0);
    const deletedLater = store.deleteEntry(later.id);
    expect(store.get(decision.id)?.supersededBy).toBeUndefined();

    store.restoreDeleted(deletedLater);
    store.restoreDeleted(deletedSource);
    expect(store.workspace.links).toEqual([expect.objectContaining({ evidenceId: source.id, kind: 'challenges' })]);
    expect(store.get(decision.id)?.supersededBy).toBe(later.id);
  });
});

describe('TimelineStore links', () => {
  it('links evidence once and lets the relation change', () => {
    const { store } = makeStore();
    const decision = store.createEntry({ type: 'decision', title: 'Decide' });
    const note = store.createEntry({ type: 'note', title: 'Note' });
    store.linkEvidence(decision.id, note.id);
    store.linkEvidence(decision.id, note.id, 'challenges');
    expect(store.workspace.links).toEqual([expect.objectContaining({ kind: 'challenges' })]);
    expect(store.unlinkEvidence(decision.id, note.id)).toBe(true);
    expect(store.unlinkEvidence(decision.id, note.id)).toBe(false);
  });

  it('only connects decisions to evidence', () => {
    const { store } = makeStore();
    const a = store.createEntry({ type: 'decision', title: 'A' });
    const b = store.createEntry({ type: 'decision', title: 'B' });
    const note = store.createEntry({ type: 'note', title: 'Note' });
    expect(() => store.linkEvidence(note.id, a.id)).toThrow(ValidationError);
    expect(() => store.linkEvidence(a.id, b.id)).toThrow(ValidationError);
    expect(() => store.linkEvidence(a.id, 'missing')).toThrow(/no longer exists/);
  });
});

describe('TimelineStore across tabs', () => {
  it('never loses a write made by another tab (0.1 regression)', () => {
    const storage = new MemoryStorage();
    const clock = testClock();
    const olderTab = new TimelineStore({ storage, now: clock.now, createId: sequentialIds('a') });
    const newerTab = new TimelineStore({ storage, now: clock.now, createId: sequentialIds('b') });

    const capture = newerTab.createEntry({ type: 'source', title: 'Captured page' });
    olderTab.createEntry({ type: 'note', title: 'Note typed in the older tab' });

    const reloaded = new TimelineStore({ storage });
    expect(reloaded.get(capture.id)?.title).toBe('Captured page');
    expect(reloaded.workspace.entries.map((entry) => entry.title).sort()).toEqual(['Captured page', 'Note typed in the older tab']);
    expect(reloaded.revision).toBe(2);
  });

  it('applies links against the latest stored copy', () => {
    const storage = new MemoryStorage();
    const tabA = new TimelineStore({ storage, createId: sequentialIds('a') });
    const tabB = new TimelineStore({ storage, createId: sequentialIds('b') });
    const decision = tabA.createEntry({ type: 'decision', title: 'Decide' });
    const source = tabB.createEntry({ type: 'source', title: 'Found in tab B' });
    // Tab A has never seen the source, but the link still lands.
    tabA.linkEvidence(decision.id, source.id);
    expect(new TimelineStore({ storage }).workspace.links).toHaveLength(1);
  });

  it('notifies listeners when another tab changes storage', () => {
    const storage = new MemoryStorage();
    const tabA = new TimelineStore({ storage, createId: sequentialIds('a') });
    const tabB = new TimelineStore({ storage, createId: sequentialIds('b') });
    const listener = vi.fn();
    tabA.subscribe(listener);
    tabB.createEntry({ type: 'note', title: 'From B' });
    expect(tabA.syncFromStorage()).toBe(true);
    expect(listener).toHaveBeenCalledWith('external');
    expect(tabA.workspace.entries).toHaveLength(1);
    expect(tabA.syncFromStorage()).toBe(false);
  });

  it('syncs on window storage events', () => {
    const tabA = new TimelineStore();
    const tabB = new TimelineStore();
    const stop = tabA.connect(window);
    tabB.createEntry({ type: 'note', title: 'Hello' });
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(tabA.workspace.entries).toHaveLength(1);
    stop();
  });
});

describe('TimelineStore failure handling', () => {
  it('leaves memory and storage untouched when the disk is full', () => {
    const { store, storage } = makeStore();
    store.createEntry({ type: 'note', title: 'Saved' });
    const before = storage.getItem(STORAGE_KEY);
    storage.quota = before!.length;
    expect(() => store.createEntry({ type: 'note', title: 'Too much', body: 'x'.repeat(500) })).toThrow(StorageFullError);
    expect(store.workspace.entries.map((entry) => entry.title)).toEqual(['Saved']);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('keeps a copy of an unreadable document instead of overwriting it', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const store = new TimelineStore({ storage });
    expect(store.workspace.entries).toEqual([]);
    expect(store.loadReport.backupKey).toMatch(/^traceback\.workspace\.v2\.unreadable-/);
    expect(storage.getItem(store.loadReport.backupKey!)).toBe('{not json');
  });

  it('works in memory when localStorage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const store = new TimelineStore();
    spy.mockRestore();
    expect(store.loadReport.persistent).toBe(false);
    expect(store.createEntry({ type: 'note', title: 'Still works' }).title).toBe('Still works');
  });
});

describe('TimelineStore migration and import', () => {
  it('upgrades a 0.1 trail and leaves the original untouched', () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({
      entries: [
        { id: 'd1', type: 'decision', title: 'Use local-first storage for the MVP', body: 'Keep project evidence on-device first. A repository boundary leaves room for SQLite when the Tauri shell lands.', tags: ['architecture'], createdAt: '2026-10-15T13:08:00.000Z' },
        { id: 's1', type: 'source', title: 'Docs', body: 'Selected text:\n\nQuoted words\n\nURL: https://example.com/docs', tags: ['browser', 'example.com'], createdAt: '2026-10-15T13:09:00.000Z' },
      ],
      links: [{ decisionId: 'd1', evidenceId: 's1', createdAt: '2026-10-15T13:10:00.000Z' }],
    });
    storage.setItem(LEGACY_STORAGE_KEY, legacy);
    const store = new TimelineStore({ storage });
    expect(store.loadReport.migratedFromV1).toBe(true);
    expect(store.get('d1')).toMatchObject({ status: 'accepted', origin: 'example' });
    expect(store.get('s1')).toMatchObject({ origin: 'browser', quote: 'Quoted words', url: 'https://example.com/docs', body: '' });
    expect(store.workspace.links[0].kind).toBe('supports');
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(legacy);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('merges a backup: new entries added, newer versions win, older ones ignored', () => {
    const { store, clock } = makeStore();
    const local = store.createEntry({ type: 'note', title: 'Local' });
    const backup = JSON.parse(workspaceToJson(store.workspace));
    backup.entries[0] = { ...backup.entries[0], title: 'Newer remote', updatedAt: '2026-10-16T00:00:00.000Z' };
    backup.entries.push({ ...backup.entries[0], id: 'remote-2', title: 'Remote only' });
    clock.advance();
    const report = store.importWorkspace(JSON.stringify(backup), 'merge');
    expect(report).toMatchObject({ added: 1, updated: 1 });
    expect(store.get(local.id)?.title).toBe('Newer remote');
    expect(store.importWorkspace(JSON.stringify(backup), 'merge')).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
  });

  it('replaces the workspace and rejects files that are not backups', () => {
    const { store } = makeStore();
    store.createEntry({ type: 'note', title: 'Will disappear' });
    store.importWorkspace({ schema: 2, entries: [], links: [] }, 'replace');
    expect(store.workspace.entries).toEqual([]);
    expect(() => store.importWorkspace('nope', 'merge')).toThrow(/not valid JSON/);
    expect(() => store.importWorkspace({ format: 'traceback.decision-bundle' }, 'merge')).toThrow(/single-decision/);
    expect(() => store.importWorkspace({ schema: 9, entries: [] }, 'merge')).toThrow(/newer version/);
  });

  it('loads the example once and removes it in one step', () => {
    const { store } = makeStore();
    const mine = store.createEntry({ type: 'note', title: 'Mine' });
    const added = store.loadExample();
    expect(added).toBeGreaterThan(10);
    expect(store.loadExample()).toBe(0);
    expect(store.removeExamples()).toBe(added);
    expect(store.workspace.entries.map((entry) => entry.id)).toEqual([mine.id]);
    expect(store.workspace.links).toEqual([]);
  });
});
