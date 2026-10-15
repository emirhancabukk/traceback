/*
 * Shared by the popup, the options page and the content script.
 * Classic script: exposes globalThis.TracebackExtension.
 */
(() => {
  if (globalThis.TracebackExtension) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const DEFAULT_APP_URL = 'http://localhost:5173';
  const CAPTURE_PREFIX = 'capture:';
  const HOST_PERMISSIONS = ['*://localhost/*', '*://127.0.0.1/*'];
  const LIMITS = { title: 300, text: 20000, note: 5000, queue: 50 };

  /** Returns the origin for a local Traceback URL, or null for anything else. */
  function normalizeAppUrl(value) {
    try {
      const url = new URL(String(value).trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
      if (url.username || url.password) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  async function getAppOrigin() {
    const { appUrl } = await api.storage.local.get({ appUrl: DEFAULT_APP_URL });
    return normalizeAppUrl(appUrl) ?? DEFAULT_APP_URL;
  }

  /** Captures waiting for the app, oldest first. Each lives under its own key so writers never race. */
  async function pendingCaptures() {
    const items = await api.storage.local.get(null);
    return Object.entries(items)
      .filter(([key]) => key.startsWith(CAPTURE_PREFIX))
      .map(([, value]) => value)
      .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  }

  function clamp(text, max) {
    const value = String(text ?? '');
    if (value.length <= max) return value;
    const code = value.charCodeAt(max - 1);
    return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
  }

  function newId() {
    return crypto.randomUUID();
  }

  globalThis.TracebackExtension = Object.freeze({
    api,
    DEFAULT_APP_URL,
    CAPTURE_PREFIX,
    HOST_PERMISSIONS,
    LIMITS,
    normalizeAppUrl,
    getAppOrigin,
    pendingCaptures,
    clamp,
    newId,
  });
})();
