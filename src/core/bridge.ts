import {
  LIMITS,
  clampText,
  hostnameOf,
  isRecord,
  isValidId,
  normalizeTags,
  safeHttpUrl,
  toIsoDate,
  type EntryInput,
} from './model';

/**
 * Protocol between the Traceback page and the extension's content script
 * (extension/bridge.js). Both sides talk through window.postMessage on the
 * app's own window:
 *
 *   content script → app   { channel, type: 'extension-ready' }
 *   app → content script   { channel, type: 'app-ready', protocol }
 *   content script → app   { channel, type: 'captures', captures: [...] }
 *   app → content script   { channel, type: 'ack', ids: [...] }
 *
 * The app only trusts messages whose `source` is its own window and whose
 * `origin` is its own origin. Other sites cannot reach this channel: their
 * messages carry their own origin, and the content script only runs on
 * localhost pages.
 */
export const BRIDGE_CHANNEL = 'traceback';
export const BRIDGE_PROTOCOL = 1;
export const MAX_CAPTURES_PER_MESSAGE = 100;
export const CAPTURE_TEXT_LIMIT = 20_000;
export const CAPTURE_NOTE_LIMIT = 5_000;
/** Clock skew tolerated before a capture timestamp counts as "in the future". */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface BrowserCapture {
  id: string;
  title: string;
  url: string;
  text?: string;
  note?: string;
  tags: string[];
  capturedAt: string;
}

export function parseCapture(value: unknown, now: Date = new Date()): BrowserCapture | undefined {
  if (!isRecord(value) || !isValidId(value.id)) return undefined;
  const url = safeHttpUrl(value.url);
  if (!url) return undefined;
  const title = typeof value.title === 'string' ? clampText(value.title.replace(/\s+/g, ' ').trim(), LIMITS.title) : '';
  const text = typeof value.text === 'string' ? clampText(value.text.trim(), CAPTURE_TEXT_LIMIT) : '';
  const note = typeof value.note === 'string' ? clampText(value.note.trim(), CAPTURE_NOTE_LIMIT) : '';
  const tags = normalizeTags(Array.isArray(value.tags) ? value.tags : []);
  const stamped = toIsoDate(value.capturedAt);
  const capturedAt =
    stamped && Date.parse(stamped) <= now.getTime() + FUTURE_TOLERANCE_MS ? stamped : now.toISOString();
  return {
    id: value.id,
    title: title || hostnameOf(url) || url,
    url,
    ...(text ? { text } : {}),
    ...(note ? { note } : {}),
    tags,
    capturedAt,
  };
}

export function captureToEntry(capture: BrowserCapture): EntryInput {
  return {
    id: capture.id,
    type: 'source',
    title: capture.title,
    body: capture.note ?? '',
    quote: capture.text,
    url: capture.url,
    tags: ['browser', hostnameOf(capture.url), ...capture.tags],
    origin: 'browser',
    createdAt: capture.capturedAt,
  };
}

export interface BridgeOptions {
  target: Window;
  /**
   * Persist the captures. Return the ids that are safely stored (or were
   * already present); those are removed from the extension's queue. Ids that
   * are not returned stay queued and are offered again later.
   */
  onCaptures: (captures: BrowserCapture[]) => string[];
}

export function connectExtensionBridge({ target, onCaptures }: BridgeOptions): () => void {
  const origin = target.location.origin;
  const post = (message: Record<string, unknown>) => target.postMessage({ channel: BRIDGE_CHANNEL, ...message }, origin);
  const announce = () => post({ type: 'app-ready', protocol: BRIDGE_PROTOCOL });

  const onMessage = (event: MessageEvent) => {
    if (event.source !== target || event.origin !== origin) return;
    const data: unknown = event.data;
    if (!isRecord(data) || data.channel !== BRIDGE_CHANNEL) return;
    if (data.type === 'extension-ready') return announce();
    if (data.type !== 'captures' || !Array.isArray(data.captures)) return;

    const received = data.captures.slice(0, MAX_CAPTURES_PER_MESSAGE);
    const valid: BrowserCapture[] = [];
    const rejected: string[] = [];
    for (const item of received) {
      const capture = parseCapture(item);
      if (capture) valid.push(capture);
      // Malformed items would otherwise be re-sent forever; drop them from the queue.
      else if (isRecord(item) && isValidId(item.id)) rejected.push(item.id);
    }
    const stored = valid.length ? onCaptures(valid) : [];
    const ids = [...new Set([...stored, ...rejected])];
    if (ids.length) post({ type: 'ack', ids });
  };

  const onVisible = () => {
    if (target.document.visibilityState === 'visible') announce();
  };

  target.addEventListener('message', onMessage);
  target.document.addEventListener('visibilitychange', onVisible);
  announce();
  return () => {
    target.removeEventListener('message', onMessage);
    target.document.removeEventListener('visibilitychange', onVisible);
  };
}
