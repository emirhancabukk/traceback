import { describe, expect, it } from 'vitest';
import { clampText, normalizeTags, randomId, safeHttpUrl } from '../src/core/model';
import { WorkspaceFormatError, parseWorkspace } from '../src/core/schema';

const at = '2026-10-15T12:00:00.000Z';

describe('normalisers', () => {
  it('accepts only http(s) URLs and strips credentials', () => {
    expect(safeHttpUrl('https://a:b@example.com/x?y=1#z')).toBe('https://example.com/x?y=1#z');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('file:///etc/passwd')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
    expect(safeHttpUrl(`https://example.com/${'a'.repeat(3000)}`)).toBeUndefined();
  });

  it('deduplicates tags case-insensitively and keeps the first spelling', () => {
    expect(normalizeTags(' #Research, research ,  big   idea,,')).toEqual(['Research', 'big-idea']);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
    expect(normalizeTags(['İstanbul', 'istanbul'])).toHaveLength(2);
  });

  it('never splits a surrogate pair when clamping', () => {
    expect(clampText('ab😀', 3)).toBe('ab');
    expect(clampText('abc', 5)).toBe('abc');
  });

  it('creates RFC 4122 v4 ids', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('parseWorkspace', () => {
  it('round-trips a valid document without issues', () => {
    const doc = {
      schema: 2,
      revision: 4,
      entries: [
        { id: 'd', type: 'decision', title: 'D', body: '', tags: [], createdAt: at, updatedAt: at, origin: 'manual', status: 'proposed' },
        { id: 'n', type: 'note', title: 'N', body: 'b', tags: ['x'], createdAt: at, updatedAt: at, origin: 'manual' },
      ],
      links: [{ decisionId: 'd', evidenceId: 'n', kind: 'challenges', createdAt: at }],
    };
    const { workspace, issues } = parseWorkspace(doc);
    expect(issues).toEqual([]);
    expect(workspace).toEqual(doc);
  });

  it('skips broken records and explains why', () => {
    const { workspace, issues } = parseWorkspace({
      schema: 2,
      entries: [
        { id: 'ok', type: 'note', title: 'Fine', createdAt: at },
        { id: 'ok', type: 'note', title: 'Duplicate', createdAt: at },
        { id: 'bad id!', type: 'note', title: 'x', createdAt: at },
        { id: 't', type: 'mystery', title: 'x', createdAt: at },
        { id: 'u', type: 'note', title: '  ', createdAt: at },
        { id: 'v', type: 'note', title: 'x', createdAt: 'yesterday-ish' },
        'not an object',
      ],
      links: [{ decisionId: 'ok', evidenceId: 'ok' }, { decisionId: 'missing', evidenceId: 'ok' }],
    });
    expect(workspace.entries.map((entry) => entry.id)).toEqual(['ok']);
    expect(workspace.links).toEqual([]);
    expect(issues).toHaveLength(8);
    expect(issues.join(' ')).toMatch(/repeats id ok/);
  });

  it('defaults link kinds, drops dangling replacements and marks replaced decisions', () => {
    const { workspace, issues } = parseWorkspace({
      schema: 2,
      entries: [
        { id: 'a', type: 'decision', title: 'A', createdAt: at, supersededBy: 'b' },
        { id: 'b', type: 'decision', title: 'B', createdAt: at, supersededBy: 'ghost' },
        { id: 'n', type: 'note', title: 'N', createdAt: at, url: 'javascript:void(0)' },
      ],
      links: [{ decisionId: 'a', evidenceId: 'n' }],
    });
    expect(workspace.entries[0]).toMatchObject({ status: 'superseded', supersededBy: 'b' });
    expect(workspace.entries[1].supersededBy).toBeUndefined();
    expect(workspace.entries[2].url).toBeUndefined();
    expect(workspace.links[0]).toMatchObject({ kind: 'supports', createdAt: at });
    expect(issues).toHaveLength(1);
  });

  it('refuses documents it cannot use', () => {
    expect(() => parseWorkspace([])).toThrow(WorkspaceFormatError);
    expect(() => parseWorkspace({ schema: 2 })).toThrow(/no "entries"/);
    expect(() => parseWorkspace({ schema: 3, entries: [] })).toThrow(/newer version/);
  });
});
