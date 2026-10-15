import type { EntryType, EvidenceLink, TimelineEntry, TimelineQuery, TimelineSnapshot } from './domain';

export interface TimelineRepository {
  list(query?: TimelineQuery): TimelineEntry[];
  get(id: string): TimelineEntry | undefined;
  create(input: { type: EntryType; title: string; body: string; tags?: string[] }): TimelineEntry;
  linkEvidence(decisionId: string, evidenceId: string): EvidenceLink;
  evidenceFor(decisionId: string): TimelineEntry[];
  decisionsFor(evidenceId: string): TimelineEntry[];
  snapshot(): TimelineSnapshot;
  replace(snapshot: TimelineSnapshot): void;
}

const STORAGE_KEY = 'traceback.timeline.v1';

export class LocalStorageTimelineRepository implements TimelineRepository {
  private state: TimelineSnapshot;

  constructor(private readonly storage: Storage = localStorage) {
    this.state = this.read();
  }

  list(query: TimelineQuery = {}): TimelineEntry[] {
    const search = query.search?.trim().toLowerCase();
    return [...this.state.entries]
      .filter((entry) => !query.type || query.type === 'all' || entry.type === query.type)
      .filter((entry) => {
        if (!search) return true;
        return [entry.title, entry.body, entry.type, ...entry.tags].some((value) =>
          value.toLowerCase().includes(search),
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): TimelineEntry | undefined {
    return this.state.entries.find((entry) => entry.id === id);
  }

  create(input: { type: EntryType; title: string; body: string; tags?: string[] }): TimelineEntry {
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      type: input.type,
      title: input.title.trim(),
      body: input.body.trim(),
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    };
    this.state.entries.push(entry);
    this.persist();
    return entry;
  }

  linkEvidence(decisionId: string, evidenceId: string): EvidenceLink {
    if (this.get(decisionId)?.type !== 'decision') throw new Error('Evidence can only be linked to a decision.');
    if (!this.get(evidenceId)) throw new Error('Evidence entry does not exist.');
    const existing = this.state.links.find((link) => link.decisionId === decisionId && link.evidenceId === evidenceId);
    if (existing) return existing;
    const link = { decisionId, evidenceId, createdAt: new Date().toISOString() };
    this.state.links.push(link);
    this.persist();
    return link;
  }

  evidenceFor(decisionId: string): TimelineEntry[] {
    return this.state.links
      .filter((link) => link.decisionId === decisionId)
      .map((link) => this.get(link.evidenceId))
      .filter((entry): entry is TimelineEntry => Boolean(entry));
  }

  decisionsFor(evidenceId: string): TimelineEntry[] {
    return this.state.links
      .filter((link) => link.evidenceId === evidenceId)
      .map((link) => this.get(link.decisionId))
      .filter((entry): entry is TimelineEntry => Boolean(entry));
  }

  snapshot(): TimelineSnapshot {
    return structuredClone(this.state);
  }

  replace(snapshot: TimelineSnapshot): void {
    this.state = structuredClone(snapshot);
    this.persist();
  }

  private read(): TimelineSnapshot {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return { entries: [], links: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<TimelineSnapshot>;
      return { entries: parsed.entries ?? [], links: parsed.links ?? [] };
    } catch {
      return { entries: [], links: [] };
    }
  }

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }
}
