const { api, CAPTURE_PREFIX, HOST_PERMISSIONS, LIMITS, clamp, getAppOrigin, newId, pendingCaptures } = globalThis.TracebackExtension;

const form = document.querySelector('#capture-form');
const titleInput = document.querySelector('#title');
const noteInput = document.querySelector('#note');
const tagsInput = document.querySelector('#tags');
const captureButton = document.querySelector('#capture');
let page;

function showStatus(message, error = false) {
  const status = document.querySelector('#status');
  status.textContent = message;
  status.className = `status${error ? ' error' : ''}`;
}

function renderPreview({ title, url, text, selectionReadable }) {
  const preview = document.querySelector('#preview');
  preview.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = text
    ? text
    : selectionReadable
      ? 'No text selected. The page title and address will be saved.'
      : 'This page does not let extensions read the selection. The page title and address will be saved.';
  if (!text) body.className = 'muted';
  const address = document.createElement('span');
  address.className = 'url';
  address.textContent = url;
  preview.append(heading, body, address);
}

async function updateQueue() {
  const [captures, origin] = await Promise.all([pendingCaptures(), getAppOrigin()]);
  const queue = document.querySelector('#queue');
  queue.textContent = captures.length
    ? `${captures.length} waiting for ${origin.replace(/^https?:\/\//, '')}`
    : `Sends to ${origin.replace(/^https?:\/\//, '')}`;
}

async function readSelection(tabId) {
  try {
    const [result] = await api.scripting.executeScript({ target: { tabId }, func: () => window.getSelection()?.toString() ?? '' });
    return { text: clamp(String(result?.result ?? '').trim(), LIMITS.text), readable: true };
  } catch {
    return { text: '', readable: false };
  }
}

async function init() {
  await updateQueue();
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    document.querySelector('#preview').textContent = 'Only web pages (http and https) can be captured.';
    return;
  }
  const selection = await readSelection(tab.id);
  page = {
    title: clamp((tab.title || new URL(tab.url).hostname).replace(/\s+/g, ' ').trim(), LIMITS.title),
    url: tab.url,
    text: selection.text,
  };
  renderPreview({ ...page, selectionReadable: selection.readable });
  titleInput.value = page.title;
  captureButton.disabled = false;
  titleInput.focus();
  titleInput.select();
}

async function openApp(origin) {
  const tabs = await api.tabs.query({ url: HOST_PERMISSIONS });
  const appTab = tabs.find((tab) => {
    try {
      return new URL(tab.url).origin === origin;
    } catch {
      return false;
    }
  });
  if (!appTab) {
    await api.tabs.create({ url: `${origin}/` });
    return 'opened';
  }
  // The tab may predate the extension (or the permission grant): make sure the bridge runs there.
  await api.scripting.executeScript({ target: { tabId: appTab.id }, files: ['shared.js', 'bridge.js'] }).catch(() => {});
  await api.tabs.update(appTab.id, { active: true });
  await api.windows.update(appTab.windowId, { focused: true }).catch(() => {});
  return 'focused';
}

async function capture(granted) {
  const item = {
    id: newId(),
    title: clamp(titleInput.value.replace(/\s+/g, ' ').trim() || page.title, LIMITS.title),
    url: page.url,
    text: page.text || undefined,
    note: clamp(noteInput.value.trim(), LIMITS.note) || undefined,
    tags: tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
    capturedAt: new Date().toISOString(),
  };
  const waiting = await pendingCaptures();
  if (waiting.length >= LIMITS.queue) {
    showStatus(`${waiting.length} captures are already waiting. Open Traceback so it can receive them first.`, true);
    return;
  }
  await api.storage.local.set({ [CAPTURE_PREFIX + item.id]: item });
  if (!granted) {
    showStatus('Saved in the extension. Allow access to localhost so Traceback can receive it.', true);
    await updateQueue();
    return;
  }
  const result = await openApp(await getAppOrigin());
  showStatus(result === 'opened' ? 'Opening Traceback…' : 'Sent to Traceback.');
  setTimeout(() => window.close(), 600);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!page) return;
  captureButton.disabled = true;
  // permissions.request must run synchronously inside the user's click (Firefox).
  // It resolves immediately, without a prompt, when access is already granted.
  api.permissions
    .request({ origins: HOST_PERMISSIONS })
    .catch(() => false)
    .then((granted) => capture(granted))
    .catch((error) => showStatus(`Could not capture: ${error?.message ?? error}`, true))
    .finally(() => {
      captureButton.disabled = false;
    });
});

form.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelector('#settings').addEventListener('click', (event) => {
  event.preventDefault();
  api.runtime.openOptionsPage();
});

init().catch(() => showStatus('Could not read the active tab.', true));
