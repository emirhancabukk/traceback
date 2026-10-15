const { api, CAPTURE_PREFIX, DEFAULT_APP_URL, HOST_PERMISSIONS, normalizeAppUrl, pendingCaptures } = globalThis.TracebackExtension;

const input = document.querySelector('#app-url');
const status = document.querySelector('#status');

function say(message) {
  status.textContent = message;
}

async function refreshAccess() {
  const granted = await api.permissions.contains({ origins: HOST_PERMISSIONS });
  document.querySelector('#access-status').textContent = granted
    ? 'Allowed. The extension can hand captures to the app.'
    : 'Not allowed yet. Captures wait in the extension until you allow it.';
  document.querySelector('#grant').hidden = granted;
}

async function refreshQueue() {
  const captures = await pendingCaptures();
  document.querySelector('#queue-status').textContent = captures.length
    ? `${captures.length} capture${captures.length === 1 ? '' : 's'} waiting. They are delivered the next time the app is open.`
    : 'Nothing waiting.';
  document.querySelector('#discard').hidden = captures.length === 0;
}

document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const origin = normalizeAppUrl(input.value);
  if (!origin) {
    say('Use a local address such as http://localhost:5173.');
    return;
  }
  input.value = origin;
  await api.storage.local.set({ appUrl: origin });
  say('Saved.');
});

document.querySelector('#grant').addEventListener('click', () => {
  api.permissions
    .request({ origins: HOST_PERMISSIONS })
    .then((granted) => say(granted ? 'Access allowed.' : 'Access was not allowed.'))
    .catch(() => say('The browser did not allow the request.'))
    .finally(refreshAccess);
});

document.querySelector('#discard').addEventListener('click', async () => {
  const captures = await pendingCaptures();
  if (!captures.length || !confirm(`Discard ${captures.length} waiting capture(s)? This cannot be undone.`)) return;
  await api.storage.local.remove(captures.map((capture) => CAPTURE_PREFIX + capture.id));
  say('Discarded.');
  await refreshQueue();
});

api.storage.local.get({ appUrl: DEFAULT_APP_URL }).then(({ appUrl }) => {
  input.value = normalizeAppUrl(appUrl) ?? DEFAULT_APP_URL;
});
api.storage.onChanged.addListener(() => void refreshQueue());
void refreshAccess();
void refreshQueue();
