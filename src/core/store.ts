import { createsReplacementLoop } from './decisions';
import { EXAMPLE_WORKSPACE } from './example';
import {
  LIMITS,
  ValidationError,
  clampText,
  cloneWorkspace,
  emptyWorkspace,
  isDecisionStatus,
  isEntryOrigin,
  isEntryType,
  isValidId,
  linkKey,
  normalizeTags,
  randomId,
  safeHttpUrl,
  toIsoDate,
  typeLabel,
  type Entry,
  type EntryInput,
  type EntryPatch,
  type Link,
  type LinkKind,
  type Workspace,
} from './model';
import { indexWorkspace, type WorkspaceIndex } from './query';
import { WorkspaceFormatError, parseWorkspace, parseWorkspaceJson } from './schema';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEY = 'traceback.workspace.v2';
export const LEGACY_STORAGE_KEY = 'traceback.timeline.v1';

export class StorageFullError extends Error {
  constructor(cause?: unknown) {
    super('Browser storage is full. Export a backup, then delete large entries to free space.', { cause });
    this.name = 'StorageFullError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} no longer exists. It may have been deleted in another tab.`);
    this.name = 'NotFoundError';
  }
}

export type ChangeReason = 'local' | 'external';
export type Listener = (reason: ChangeReason) => void;

export interface LoadReport {
  issues: string[];
  migratedFromV1: boolean;
  /** Set when the stored document was unreadable and copied aside before starting fresh. */
  backupKey?: string;
  /** False when the browser refused access to localStorage (changes stay in memory). */
  persistent: boolean;
}

export interface DeletedEntry {
  entry: Entry;
  links: Link[];
  /** Decisions that named the deleted entry as their replacement. */
  supersededRefs: string[];
}

export interface ImportReport {
  added: number;
  updated: number;
  unchanged: number;
  links: number;
  issues: string[];
}

export interface StoreOptions {
  storage?: StorageLike;
  key?: string;
  legacyKey?: string;
  now?: () => Date;
  createId?: () => string;
}

/**
 * Owns the workspace and its persistence.
 *
 * Every change goes through `commit()`, which re-reads the stored document
 * first, applies the change to a copy of that latest version and only
 * replaces the in-memory state after the write succeeds. Two open tabs
 * therefore never overwrite each other's work, and a full disk never leaves
 * memory and storage disagreeing.
 */
export class TimelineStore {
  readonly loadReport: LoadReport;
  private state: Workspace;
  private cachedIndex: WorkspaceIndex | undefined;
  private lastRaw: string | null = null;
  private readonly storage: StorageLike;
  private readonly key: string;
  private readonly legacyKey: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly listeners = new Set<Listener>();

  constructor(options: StoreOptions = {}) {
    const resolved = options.storage ? { storage: options.storage, persistent: true } : defaultStorage();
    this.storage = resolved.storage;
    this.key = options.key ?? STORAGE_KEY;
    this.legacyKey = options.legacyKey ?? LEGACY_STORAGE_KEY;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomId;
    const loaded = this.load();
    this.state = loaded.workspace;
    this.loadReport = { ...loaded.report, persistent: resolved.persistent };
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  get workspace(): Readonly<Workspace> {
    return this.state;
  }

  get revision(): number {
    return this.state.revision;
  }

  index(): WorkspaceIndex {
    if (!this.cachedIndex || this.cachedIndex.workspace !== this.state) this.cachedIndex = indexWorkspace(this.state);
    return this.cachedIndex;
  }

  get(id: string): Entry | undefined {
    return this.index().byId.get(id);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Entries ────────────────────────────────────────────────────────────

  createEntry(input: EntryInput): Entry {
    return this.commit((draft) => {
      const entry = this.prepareEntry(input);
      if (draft.entries.some((existing) => existing.id === entry.id)) {
        throw new ValidationError('An entry with this id already exists.');
      }
      draft.entries.push(entry);
      return { ...entry, tags: [...entry.tags] };
    });
  }

  updateEntry(id: string, patch: EntryPatch): Entry {
    return this.commit((draft) => {
      const entry = draft.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new NotFoundError('This entry');

      if (patch.type && patch.type !== entry.type) {
        const wasDecision = entry.type === 'decision';
        if (wasDecision !== (patch.type === 'decision')) {
          const linked = draft.links.some((link) => link.decisionId === id || link.evidenceId === id);
          if (linked) {
            throw new ValidationError(
              `Remove this entry's links before turning a ${typeLabel(entry.type).toLowerCase()} into a ${typeLabel(patch.type).toLowerCase()}.`,
            );
          }
          if (wasDecision) {
            delete entry.status;
            delete entry.supersededBy;
            for (const other of draft.entries) if (other.supersededBy === id) delete other.supersededBy;
          } else {
            entry.status = 'accepted';
          }
        }
        entry.type = patch.type;
      }
      if (patch.title !== undefined) entry.title = requireTitle(patch.title);
      if (patch.body !== undefined) entry.body = clampText(patch.body.trim(), LIMITS.body);
      if (patch.tags !== undefined) entry.tags = normalizeTags(patch.tags);
      if (patch.url !== undefined) {
        const url = optionalUrl(patch.url);
        if (url) entry.url = url;
        else delete entry.url;
      }
      if (patch.quote !== undefined) {
        const quote = clampText(patch.quote.trim(), LIMITS.quote);
        if (quote) entry.quote = quote;
        else delete entry.quote;
      }
      if (patch.status !== undefined) {
        if (entry.type !== 'decision') throw new ValidationError('Only decisions have a status.');
        entry.status = patch.status;
        if (patch.status !== 'superseded') delete entry.supersededBy;
      }
      if (patch.supersededBy !== undefined) {
        if (entry.type !== 'decision') throw new ValidationError('Only decisions can be superseded.');
        if (!patch.supersededBy) {
          delete entry.supersededBy;
        } else {
          const replacement = draft.entries.find((candidate) => candidate.id === patch.supersededBy);
          if (!replacement || replacement.type !== 'decision' || replacement.id === id) {
            throw new ValidationError('Choose another decision as the replacement.');
          }
          const lookup = (candidateId: string) => draft.entries.find((candidate) => candidate.id === candidateId);
          if (createsReplacementLoop(lookup, id, replacement.id)) {
            throw new ValidationError('That decision was itself replaced by this one. Choose a different replacement.');
          }
          entry.supersededBy = replacement.id;
          entry.status = 'superseded';
        }
      }
      entry.updatedAt = this.now().toISOString();
      return { ...entry, tags: [...entry.tags] };
    });
  }

  /** Deletes an entry with its links. Pass the result to `restoreDeleted` to undo. */
  deleteEntry(id: string): DeletedEntry {
    return this.commit((draft) => {
      const index = draft.entries.findIndex((entry) => entry.id === id);
      if (index === -1) throw new NotFoundError('This entry');
      const [entry] = draft.entries.splice(index, 1);
      const links = draft.links.filter((link) => link.decisionId === id || link.evidenceId === id);
      draft.links = draft.links.filter((link) => link.decisionId !== id && link.evidenceId !== id);
      const supersededRefs: string[] = [];
      for (const other of draft.entries) {
        if (other.supersededBy === id) {
          supersededRefs.push(other.id);
          delete other.supersededBy;
        }
      }
      return { entry, links, supersededRefs };
    });
  }

  restoreDeleted(deleted: DeletedEntry): void {
    this.commit((draft) => {
      if (!draft.entries.some((entry) => entry.id === deleted.entry.id)) draft.entries.push({ ...deleted.entry });
      const byId = new Map(draft.entries.map((entry) => [entry.id, entry]));
      const existing = new Set(draft.links.map((link) => linkKey(link.decisionId, link.evidenceId)));
      for (const link of deleted.links) {
        const valid = byId.get(link.decisionId)?.type === 'decision' && byId.has(link.evidenceId);
        if (valid && !existing.has(linkKey(link.decisionId, link.evidenceId))) draft.links.push({ ...link });
      }
      for (const id of deleted.supersededRefs) {
        const decision = byId.get(id);
        if (decision?.type === 'decision' && !decision.supersededBy) decision.supersededBy = deleted.entry.id;
      }
    });
  }

  // ── Links ──────────────────────────────────────────────────────────────

  /** Connects evidence to a decision, or changes the relation if they are already connected. */
  linkEvidence(decisionId: string, evidenceId: string, kind: LinkKind = 'supports'): Link {
    return this.commit((draft) => {
      const decision = draft.entries.find((entry) => entry.id === decisionId);
      const evidence = draft.entries.find((entry) => entry.id === evidenceId);
      if (!decision) throw new NotFoundError('This decision');
      if (!evidence) throw new NotFoundError('This evidence');
      if (decision.type !== 'decision') throw new ValidationError('Evidence can only be linked to a decision.');
      if (evidence.type === 'decision') throw new ValidationError('A decision cannot be evidence for another decision.');
      const existing = draft.links.find((link) => link.decisionId === decisionId && link.evidenceId === evidenceId);
      if (existing) {
        existing.kind = kind;
        return { ...existing };
      }
      const link: Link = { decisionId, evidenceId, kind, createdAt: this.now().toISOString() };
      draft.links.push(link);
      return { ...link };
    });
  }

  unlinkEvidence(decisionId: string, evidenceId: string): boolean {
    const exists = this.state.links.some((link) => link.decisionId === decisionId && link.evidenceId === evidenceId);
    if (!exists) return false;
    return this.commit((draft) => {
      const before = draft.links.length;
      draft.links = draft.links.filter((link) => !(link.decisionId === decisionId && link.evidenceId === evidenceId));
      return draft.links.length !== before;
    });
  }

  // ── Bulk operations ────────────────────────────────────────────────────

  /**
   * Imports a workspace backup (JSON string or parsed value).
   * `merge` keeps existing entries and takes incoming ones that are new or
   * more recently updated; `replace` swaps the whole workspace.
   */
  importWorkspace(input: string | unknown, mode: 'merge' | 'replace'): ImportReport {
    const parsed = typeof input === 'string' ? parseWorkspaceJson(input) : parseWorkspace(input);
    const incoming = parsed.workspace;
    return this.commit((draft) => {
      const report: ImportReport = { added: 0, updated: 0, unchanged: 0, links: 0, issues: [...parsed.issues] };
      if (mode === 'replace') {
        draft.entries = incoming.entries;
        draft.links = incoming.links;
        report.added = incoming.entries.length;
        report.links = incoming.links.length;
        return report;
      }
      const byId = new Map(draft.entries.map((entry, position) => [entry.id, position]));
      for (const entry of incoming.entries) {
        const position = byId.get(entry.id);
        if (position === undefined) {
          draft.entries.push(entry);
          byId.set(entry.id, draft.entries.length - 1);
          report.added += 1;
        } else if (entry.updatedAt > draft.entries[position].updatedAt) {
          const incomingIsDecision = entry.type === 'decision';
          const localIsDecision = draft.entries[position].type === 'decision';
          if (incomingIsDecision !== localIsDecision) {
            report.issues.push(`“${entry.title}” changed between decision and evidence; kept the local version.`);
            report.unchanged += 1;
            continue;
          }
          draft.entries[position] = entry;
          report.updated += 1;
        } else {
          report.unchanged += 1;
        }
      }
      const entries = new Map(draft.entries.map((entry) => [entry.id, entry]));
      const keys = new Set(draft.links.map((link) => linkKey(link.decisionId, link.evidenceId)));
      for (const link of incoming.links) {
        const key = linkKey(link.decisionId, link.evidenceId);
        const decision = entries.get(link.decisionId);
        const evidence = entries.get(link.evidenceId);
        const valid = decision?.type === 'decision' && evidence !== undefined && evidence.type !== 'decision';
        if (valid && !keys.has(key)) {
          draft.links.push(link);
          keys.add(key);
          report.links += 1;
        }
      }
      for (const entry of draft.entries) {
        if (entry.supersededBy && entries.get(entry.supersededBy)?.type !== 'decision') delete entry.supersededBy;
      }
      return report;
    });
  }

  /** Adds the bundled example workspace. Safe to call twice. Returns how many entries were added. */
  loadExample(): number {
    return this.commit((draft) => {
      const present = new Set(draft.entries.map((entry) => entry.id));
      const added = EXAMPLE_WORKSPACE.entries.filter((entry) => !present.has(entry.id));
      draft.entries.push(...added.map((entry) => ({ ...entry, tags: [...entry.tags] })));
      const ids = new Set(draft.entries.map((entry) => entry.id));
      const keys = new Set(draft.links.map((link) => linkKey(link.decisionId, link.evidenceId)));
      for (const link of EXAMPLE_WORKSPACE.links) {
        const key = linkKey(link.decisionId, link.evidenceId);
        if (ids.has(link.decisionId) && ids.has(link.evidenceId) && !keys.has(key)) {
          draft.links.push({ ...link });
          keys.add(key);
        }
      }
      return added.length;
    });
  }

  /** Removes every entry whose origin is `example`. Returns how many were removed. */
  removeExamples(): number {
    if (!this.state.entries.some((entry) => entry.origin === 'example')) return 0;
    return this.commit((draft) => {
      const removed = new Set(draft.entries.filter((entry) => entry.origin === 'example').map((entry) => entry.id));
      draft.entries = draft.entries.filter((entry) => !removed.has(entry.id));
      draft.links = draft.links.filter((link) => !removed.has(link.decisionId) && !removed.has(link.evidenceId));
      for (const entry of draft.entries) if (entry.supersededBy && removed.has(entry.supersededBy)) delete entry.supersededBy;
      return removed.size;
    });
  }

  // ── Cross-tab sync ─────────────────────────────────────────────────────

  /** Re-reads storage and notifies listeners if another tab changed the workspace. */
  syncFromStorage(): boolean {
    const raw = this.readRaw();
    if (raw === null || raw === this.lastRaw) return false;
    try {
      const { workspace } = parseWorkspaceJson(raw);
      this.lastRaw = raw;
      this.state = workspace;
      this.emit('external');
      return true;
    } catch {
      return false;
    }
  }

  /** Listens for changes made in other tabs. Returns a function that stops listening. */
  connect(target: Window): () => void {
    const onStorage = (event: StorageEvent) => {
      if (event.key === this.key || event.key === null) this.syncFromStorage();
    };
    const onVisible = () => {
      if (target.document.visibilityState === 'visible') this.syncFromStorage();
    };
    target.addEventListener('storage', onStorage);
    target.document.addEventListener('visibilitychange', onVisible);
    return () => {
      target.removeEventListener('storage', onStorage);
      target.document.removeEventListener('visibilitychange', onVisible);
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private commit<T>(mutate: (draft: Workspace) => T): T {
    const base = this.latest();
    const draft = cloneWorkspace(base);
    const result = mutate(draft);
    draft.revision = base.revision + 1;
    this.persist(draft);
    this.state = draft;
    this.emit('local');
    return result;
  }

  /** The newest committed workspace: another tab may have written since we last looked. */
  private latest(): Workspace {
    const raw = this.readRaw();
    if (raw === null || raw === this.lastRaw) return this.state;
    try {
      const { workspace } = parseWorkspaceJson(raw);
      this.lastRaw = raw;
      return workspace;
    } catch {
      this.backup(raw);
      return this.state;
    }
  }

  private persist(workspace: Workspace): void {
    const raw = JSON.stringify(workspace);
    try {
      this.storage.setItem(this.key, raw);
    } catch (error) {
      if (isQuotaError(error)) throw new StorageFullError(error);
      throw error;
    }
    this.lastRaw = raw;
  }

  private readRaw(): string | null {
    try {
      return this.storage.getItem(this.key);
    } catch {
      return null;
    }
  }

  private backup(raw: string): string | undefined {
    const backupKey = `${this.key}.unreadable-${this.now().toISOString()}`;
    try {
      this.storage.setItem(backupKey, raw);
      return backupKey;
    } catch {
      return undefined;
    }
  }

  private load(): { workspace: Workspace; report: Omit<LoadReport, 'persistent'> } {
    const raw = this.readRaw();
    if (raw !== null) {
      try {
        const { workspace, issues } = parseWorkspaceJson(raw);
        this.lastRaw = raw;
        return { workspace, report: { issues, migratedFromV1: false } };
      } catch (error) {
        const backupKey = this.backup(raw);
        const reason = error instanceof WorkspaceFormatError ? error.message : 'It could not be read.';
        const kept = backupKey ? ` A copy was kept in browser storage under “${backupKey}”.` : '';
        return { workspace: emptyWorkspace(), report: { issues: [`${reason}${kept}`], migratedFromV1: false, backupKey } };
      }
    }

    let legacy: string | null = null;
    try {
      legacy = this.storage.getItem(this.legacyKey);
    } catch {
      legacy = null;
    }
    if (legacy !== null) {
      try {
        const { workspace, issues } = parseWorkspaceJson(legacy);
        try {
          this.persist(workspace);
        } catch {
          issues.push('The migrated workspace could not be saved yet; your original data is untouched.');
        }
        return { workspace, report: { issues, migratedFromV1: true } };
      } catch {
        return {
          workspace: emptyWorkspace(),
          report: { issues: ['The data from Traceback 0.1 could not be read; it was left untouched.'], migratedFromV1: false },
        };
      }
    }
    return { workspace: emptyWorkspace(), report: { issues: [], migratedFromV1: false } };
  }

  private prepareEntry(input: EntryInput): Entry {
    if (!isEntryType(input.type)) throw new ValidationError('Choose what kind of entry this is.');
    if (input.status !== undefined && !isDecisionStatus(input.status)) throw new ValidationError('Unknown decision status.');
    const now = this.now().toISOString();
    const createdAt = input.createdAt ? toIsoDate(input.createdAt) : now;
    if (!createdAt) throw new ValidationError('The entry date is not valid.');
    if (input.id !== undefined && !isValidId(input.id)) throw new ValidationError('The entry id is not valid.');
    const entry: Entry = {
      id: input.id ?? this.createId(),
      type: input.type,
      title: requireTitle(input.title),
      body: clampText((input.body ?? '').trim(), LIMITS.body),
      tags: normalizeTags(input.tags),
      createdAt,
      updatedAt: createdAt,
      origin: isEntryOrigin(input.origin) ? input.origin : 'manual',
    };
    const url = optionalUrl(input.url ?? '');
    if (url) entry.url = url;
    const quote = clampText((input.quote ?? '').trim(), LIMITS.quote);
    if (quote) entry.quote = quote;
    if (entry.type === 'decision') entry.status = input.status ?? 'accepted';
    return entry;
  }

  private emit(reason: ChangeReason): void {
    for (const listener of [...this.listeners]) listener(reason);
  }
}

function requireTitle(value: string): string {
  const title = clampText(value.replace(/\s+/g, ' ').trim(), LIMITS.title);
  if (!title) throw new ValidationError('Give the entry a title.');
  return title;
}

function optionalUrl(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const url = safeHttpUrl(value);
  if (!url) throw new ValidationError('Links must start with http:// or https://.');
  return url;
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22;
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function defaultStorage(): { storage: StorageLike; persistent: boolean } {
  try {
    const storage = globalThis.localStorage;
    const probe = '__traceback_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return { storage, persistent: true };
  } catch {
    return { storage: new MemoryStorage(), persistent: false };
  }
}
