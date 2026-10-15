import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url)));
const required = ['manifest_version', 'name', 'version', 'action', 'permissions'];
for (const field of required) if (!(field in manifest)) throw new Error(`Missing manifest field: ${field}`);
if (manifest.manifest_version !== 3) throw new Error('Traceback requires Manifest V3.');
for (const file of ['popup.html', 'popup.js', 'popup.css', 'options.html', 'options.js', 'options.css', 'icon.svg']) {
  readFileSync(new URL(`../extension/${file}`, import.meta.url));
}
console.log(`Extension manifest valid (${manifest.name} ${manifest.version})`);
