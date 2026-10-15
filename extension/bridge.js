/*
 * Content script for localhost pages. It stays silent unless the page is the
 * Traceback app at the configured address. There it waits for the app to
 * announce itself, hands over queued captures with window.postMessage, and
 * removes each capture only after the app acknowledges that it was saved.
 */
(() => {
  if (globalThis.__tracebackBridgeInstalled) return;
  globalThis.__tracebackBridgeInstalled = true;

  const { api, CAPTURE_PREFIX, getAppOrigin, pendingCaptures } = globalThis.TracebackExtension;
  const CHANNEL = 'traceback';
  let configured = false;
  let appReady = false;
  let delivering = false;
  let deliverAgain = false;

  const post = (message) => window.postMessage({ channel: CHANNEL, ...message }, location.origin);

  async function refreshConfigured() {
    configured = (await getAppOrigin()) === location.origin;
    return configured;
  }

  async function deliver() {
    if (!configured || !appReady) return;
    if (delivering) {
      deliverAgain = true;
      return;
    }
    delivering = true;
    try {
      const captures = await pendingCaptures();
      if (captures.length) post({ type: 'captures', captures });
    } finally {
      delivering = false;
      if (deliverAgain) {
        deliverAgain = false;
        void deliver();
      }
    }
  }

  window.addEventListener('message', (event) => {
    if (!configured || event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) return;
    if (data.type === 'app-ready') {
      appReady = true;
      void deliver();
    } else if (data.type === 'ack' && Array.isArray(data.ids)) {
      const keys = data.ids.filter((id) => typeof id === 'string').map((id) => CAPTURE_PREFIX + id);
      if (keys.length) void api.storage.local.remove(keys);
    }
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.appUrl) {
      void refreshConfigured().then((isApp) => isApp && post({ type: 'extension-ready' }));
      return;
    }
    const added = Object.entries(changes).some(([key, change]) => key.startsWith(CAPTURE_PREFIX) && change.newValue);
    if (added) void deliver();
  });

  // The app may have loaded before this script ran, so ask it to announce itself.
  // Other localhost pages never hear from the extension.
  void refreshConfigured().then((isApp) => isApp && post({ type: 'extension-ready' }));
})();
