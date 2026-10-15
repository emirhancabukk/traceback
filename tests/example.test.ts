import { describe, expect, it } from 'vitest';
import { EXAMPLE_WORKSPACE } from '../src/core/example';
import { parseWorkspace } from '../src/core/schema';

describe('example workspace', () => {
  it('is a valid workspace with no repairs needed', () => {
    const { workspace, issues } = parseWorkspace(EXAMPLE_WORKSPACE);
    expect(issues).toEqual([]);
    expect(workspace.entries).toHaveLength(EXAMPLE_WORKSPACE.entries.length);
    expect(workspace.links).toHaveLength(EXAMPLE_WORKSPACE.links.length);
  });

  it('marks every entry as example data and uses https sources', () => {
    for (const entry of EXAMPLE_WORKSPACE.entries) {
      expect(entry.origin).toBe('example');
      expect(entry.id.startsWith('example-')).toBe(true);
      if (entry.url) expect(entry.url.startsWith('https://')).toBe(true);
    }
  });

  it('shows both relations and supersession', () => {
    const kinds = new Set(EXAMPLE_WORKSPACE.links.map((link) => link.kind));
    expect(kinds).toEqual(new Set(['supports', 'challenges']));
    expect(EXAMPLE_WORKSPACE.entries.filter((entry) => entry.supersededBy)).toHaveLength(2);
  });
});
