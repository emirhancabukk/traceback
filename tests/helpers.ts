import { TimelineStore, type StorageLike, type StoreOptions } from '../src/core/store';

/** In-memory Storage that can simulate a full disk. */
export class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  quota = Number.POSITIVE_INFINITY;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (value.length > this.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.values.set(key, value);
  }
}

export function testClock(start = '2026-10-15T12:00:00.000Z') {
  let now = Date.parse(start);
  return {
    now: () => new Date(now),
    advance(minutes = 1) {
      now += minutes * 60_000;
    },
  };
}

export function sequentialIds(prefix = 'id') {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

/** A store on its own storage with a deterministic clock and ids. */
export function makeStore(options: Partial<StoreOptions> & { storage?: MemoryStorage } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const clock = testClock();
  const store = new TimelineStore({ storage, now: clock.now, createId: sequentialIds(), ...options });
  return { store, storage, clock };
}
