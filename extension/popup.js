const api = globalThis.browser ?? globalThis.chrome;
const DEFAULT_APP_URL = 'http://localhost:5173';
let capture;

async function init() {
  const settings = await api.storage.local.get({ appUrl: DEFAULT_APP_URL });
  document.querySelector('#app-url').value = settings.appUrl;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    showStatus('This page cannot be captured.', true);
    return;
  }
  const result = await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.getSelection()?.toString() ?? '' });
  capture = { title: tab.title || new URL(tab.url).hostname, url: tab.url, text: result?.[0]?.result?.trim() || undefined };
  document.querySelector('#preview').innerHTML = `<h1>${escapeHtml(capture.title)}</h1>${capture.text ? `<p>${escapeHtml(capture.text)}</p>` : '<p>No text selected. The page title and URL will be saved.</p>'}<span class="url">${escapeHtml(capture.url)}</span>`;
  document.querySelector('#capture').disabled = false;
}

document.querySelector('#capture').addEventListener('click', async () => {
  const appUrl = document.querySelector('#app-url').value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/localhost(?::\d+)?$/i.test(appUrl)) {
    showStatus('Use a local Traceback URL, e.g. http://localhost:5173.', true);
    return;
  }
  await api.storage.local.set({ appUrl });
  const target = `${appUrl}/#traceback_capture=${encodeURIComponent(JSON.stringify(capture))}`;
  await api.tabs.create({ url: target });
  showStatus('Opened Traceback with the source queued.');
  setTimeout(() => window.close(), 500);
});

document.querySelector('#settings').addEventListener('click', (event) => { event.preventDefault(); api.runtime.openOptionsPage(); });
init().catch(() => showStatus('Could not read the active tab.', true));

function showStatus(message, error = false) { const status = document.querySelector('#status'); status.textContent = message; status.className = `status${error ? ' error' : ''}`; }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character); }
