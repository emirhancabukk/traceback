const api = globalThis.browser ?? globalThis.chrome;
const DEFAULT_APP_URL = 'http://localhost:5173';
const input = document.querySelector('#app-url');
const status = document.querySelector('#status');
api.storage.local.get({ appUrl: DEFAULT_APP_URL }).then(({ appUrl }) => { input.value = appUrl; });
document.querySelector('#save').addEventListener('click', async () => {
  const appUrl = input.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/localhost(?::\d+)?$/i.test(appUrl)) { status.textContent = 'Use a local Traceback URL, e.g. http://localhost:5173.'; return; }
  await api.storage.local.set({ appUrl }); status.textContent = 'Saved locally.';
});
