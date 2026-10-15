#!/usr/bin/env node
/**
 * Static checks for the browser extension. Fails the build when:
 *   - the manifest is not MV3 or its version differs from package.json
 *   - a referenced file (popup, options, scripts, styles, icons) is missing
 *   - an icon is not a PNG of the size it is declared as
 *   - the extension asks for anything beyond the permissions it needs today
 */
import { existsSync, readFileSync } from 'node:fs';

const extension = new URL('../extension/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', extension), 'utf8'));

const ALLOWED_PERMISSIONS = new Set(['activeTab', 'scripting', 'storage']);
const ALLOWED_HOSTS = new Set(['*://localhost/*', '*://127.0.0.1/*']);
const errors = [];
const fail = (message) => errors.push(message);
const exists = (file) => existsSync(new URL(file, extension));

if (manifest.manifest_version !== 3) fail('manifest_version must be 3.');
for (const field of ['name', 'version', 'description', 'action', 'icons']) {
  if (!(field in manifest)) fail(`Missing manifest field: ${field}`);
}
if (manifest.version !== pkg.version) fail(`Manifest version ${manifest.version} does not match package.json ${pkg.version}.`);

for (const permission of manifest.permissions ?? []) {
  if (!ALLOWED_PERMISSIONS.has(permission)) fail(`Unexpected permission "${permission}". Update scripts/validate-extension.mjs deliberately if it is really needed.`);
}
for (const host of [...(manifest.host_permissions ?? []), ...(manifest.optional_host_permissions ?? [])]) {
  if (!ALLOWED_HOSTS.has(host)) fail(`Unexpected host permission "${host}".`);
}
for (const script of manifest.content_scripts ?? []) {
  for (const match of script.matches ?? []) if (!ALLOWED_HOSTS.has(match)) fail(`Content script matches "${match}", outside localhost.`);
  for (const file of [...(script.js ?? []), ...(script.css ?? [])]) if (!exists(file)) fail(`Content script file missing: ${file}`);
}

const pages = [manifest.action?.default_popup, manifest.options_ui?.page].filter(Boolean);
for (const page of pages) {
  if (!exists(page)) {
    fail(`Page missing: ${page}`);
    continue;
  }
  const html = readFileSync(new URL(page, extension), 'utf8');
  for (const [, reference] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (!exists(reference)) fail(`${page} references a missing file: ${reference}`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(`${page} contains an inline script, which MV3 blocks.`);
}

function pngSize(file) {
  const bytes = readFileSync(new URL(file, extension));
  const signature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== signature || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const iconSets = [
  ['icons', manifest.icons ?? {}],
  ['action.default_icon', manifest.action?.default_icon ?? {}],
];
for (const [where, icons] of iconSets) {
  for (const [declared, file] of Object.entries(icons)) {
    if (!exists(file)) {
      fail(`${where}: missing ${file}`);
      continue;
    }
    const size = pngSize(file);
    if (!size) fail(`${where}: ${file} is not a PNG (Chrome rejects SVG and WebP icons).`);
    else if (size.width !== Number(declared) || size.height !== Number(declared)) {
      fail(`${where}: ${file} is ${size.width}×${size.height}, declared as ${declared}.`);
    }
  }
}

if (errors.length) {
  console.error(`Extension check failed:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`Extension OK: ${manifest.name} ${manifest.version}`);
