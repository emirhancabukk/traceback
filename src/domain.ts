export const ENTRY_TYPES = ['source', 'note', 'decision', 'command', 'file-change'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export interface TimelineEntry {
  id: string;
  type: EntryType;
  title: string;
  body: string;
  createdAt: string;
  tags: string[];
}

export interface EvidenceLink {
  decisionId: string;
  evidenceId: string;
  createdAt: string;
}

export interface TimelineSnapshot {
  entries: TimelineEntry[];
  links: EvidenceLink[];
}

export interface TimelineQuery {
  search?: string;
  type?: EntryType | 'all';
}

export function typeLabel(type: EntryType): string {
  return type === 'file-change' ? 'File change' : type[0].toUpperCase() + type.slice(1);
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}
