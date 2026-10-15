import { LocalStorageTimelineRepository } from '../src/repository';

describe('LocalStorageTimelineRepository', () => {
  it('persists entries across repository instances', () => {
    const first = new LocalStorageTimelineRepository();
    const created = first.create({ type: 'note', title: 'A note', body: 'Useful context', tags: ['work'] });
    const second = new LocalStorageTimelineRepository();
    expect(second.get(created.id)).toMatchObject({ title: 'A note', tags: ['work'] });
  });

  it('links evidence to decisions without duplicate links', () => {
    const repository = new LocalStorageTimelineRepository();
    const decision = repository.create({ type: 'decision', title: 'Choose A', body: 'Because.' });
    const source = repository.create({ type: 'source', title: 'Research', body: 'Evidence.' });
    repository.linkEvidence(decision.id, source.id);
    repository.linkEvidence(decision.id, source.id);
    expect(repository.evidenceFor(decision.id).map(({ id }) => id)).toEqual([source.id]);
  });

  it('searches text, tags, and filters by entry type', () => {
    const repository = new LocalStorageTimelineRepository();
    repository.create({ type: 'command', title: 'Build app', body: 'Passes', tags: ['release'] });
    repository.create({ type: 'note', title: 'Unrelated', body: 'Other' });
    expect(repository.list({ search: 'release' })).toHaveLength(1);
    expect(repository.list({ type: 'note' })).toHaveLength(1);
  });
});
