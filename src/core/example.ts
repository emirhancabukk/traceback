import { SCHEMA_VERSION, type Entry, type EntryType, type Link, type LinkKind, type Workspace } from './model';

/**
 * The example workspace is the actual decision log behind Traceback 0.2 and
 * 0.3 (15 October 2026): every command output, quote and URL below is
 * real. It is only added when the user asks for it, and every entry carries
 * `origin: "example"` so it can be removed again in one step.
 */

const at = (time: string) => `2026-10-15T${time}:00.000Z`;

type Draft = Omit<Entry, 'createdAt' | 'updatedAt' | 'origin' | 'tags' | 'body'> & {
  time: string;
  body?: string;
  tags?: string[];
};

const drafts: Draft[] = [
  // Decisions ────────────────────────────────────────────────────────────
  {
    id: 'example-d-bridge',
    type: 'decision',
    status: 'accepted',
    time: '16:42',
    title: 'Deliver browser captures through a content-script bridge',
    body:
      'The extension keeps each capture in its own storage. A content script on the Traceback page hands it over with window.postMessage once the app says it is ready, and deletes it after the app confirms it was saved.\n\n' +
      'The app only accepts messages whose source is its own window and whose origin is its own origin, so other sites cannot write into the trail and the selected text never travels in a URL.',
    tags: ['extension', 'security'],
  },
  {
    id: 'example-d-fragment',
    type: 'decision',
    status: 'superseded',
    supersededBy: 'example-d-bridge',
    time: '13:08',
    title: 'Pass captures to the app in the URL fragment',
    body: 'Version 0.1 opened http://localhost:5173/#traceback_capture=… in a new tab and saved the payload as soon as the page loaded.',
    tags: ['extension'],
  },
  {
    id: 'example-d-reread',
    type: 'decision',
    status: 'accepted',
    time: '16:44',
    title: 'Re-read storage before every write',
    body: 'Every change re-reads the stored workspace, applies the edit to that copy and writes it back. Other tabs refresh when the browser fires a storage event. If the write fails, memory and storage both stay as they were.',
    tags: ['storage', 'data-safety'],
  },
  {
    id: 'example-d-snapshot',
    type: 'decision',
    status: 'superseded',
    supersededBy: 'example-d-reread',
    time: '13:08',
    title: 'Keep the trail in memory and write it out on every change',
    body: 'Version 0.1 read localStorage once at startup and wrote its in-memory copy back after each change.',
    tags: ['storage'],
  },
  {
    id: 'example-d-fonts',
    type: 'decision',
    status: 'accepted',
    time: '16:46',
    title: 'Bundle the fonts instead of loading Google Fonts',
    body: "Manrope and DM Mono ship with the app as woff2 files, and the page's Content-Security-Policy only allows fonts from the app itself.",
    tags: ['privacy'],
  },
  {
    id: 'example-d-icons',
    type: 'decision',
    status: 'accepted',
    time: '16:48',
    title: 'Ship PNG toolbar icons',
    body: 'Chrome and Brave do not accept SVG extension icons, so the extension ships 16, 32, 48 and 128 px PNGs generated from the SVG artwork.',
    tags: ['extension'],
  },
  {
    id: 'example-d-port',
    type: 'decision',
    status: 'accepted',
    time: '16:50',
    title: 'Refuse to start when port 5173 is taken',
    body: 'The dev server and the preview server both use port 5173 with strictPort, so Traceback never comes up on a different origin with an empty trail.',
    tags: ['storage', 'developer-experience'],
  },
  {
    id: 'example-d-graph',
    type: 'decision',
    status: 'accepted',
    time: '16:34',
    title: 'Add a graph view of decisions and evidence',
    body: 'Show at a glance which evidence holds a decision up, what pushes against it, and which decisions replaced which.',
    tags: ['ui'],
  },

  // Evidence ─────────────────────────────────────────────────────────────
  {
    id: 'example-c-multitab',
    type: 'command',
    time: '16:26',
    title: 'Simulate two app tabs writing to the same storage',
    body: 'node --experimental-transform-types with two 0.1 repositories on one shared storage. The newer tab saved a capture, then the older tab added a note.\n\ncapture survived: false',
    tags: ['repro', 'storage'],
  },
  {
    id: 'example-n-newtab',
    type: 'note',
    time: '16:27',
    title: 'Every capture opened a new Traceback tab',
    body: 'With the 0.1 extension, two Traceback tabs on the same storage were the normal case, not an edge case.',
    tags: ['storage'],
  },
  {
    id: 'example-n-race',
    type: 'note',
    time: '16:56',
    title: 'Re-reading does not make writes atomic across tabs',
    body: "Browsers deliver localStorage changes to other tabs asynchronously, so two tabs writing at the same instant can still lose one edit. Fine for one person's trail; an IndexedDB or SQLite backend would close the gap.",
    tags: ['storage', 'limitation'],
  },
  {
    id: 'example-f-store',
    type: 'file-change',
    time: '16:58',
    title: 'src/core/store.ts: commit() re-reads, applies, then writes',
    body: 'Mutations run against a fresh copy of the stored document. In-memory state is replaced only after setItem succeeds; QuotaExceededError surfaces as StorageFullError.',
    tags: ['storage'],
  },
  {
    id: 'example-c-hash',
    type: 'command',
    time: '16:29',
    title: 'Open the 0.1 app with a capture in the URL, no extension involved',
    body: 'Ran the built bundle in jsdom at http://localhost:5173/#traceback_capture=… with a made-up page.\n\nplain URL with hash payload saved without asking: true',
    tags: ['repro', 'security'],
  },
  {
    id: 'example-n-history',
    type: 'note',
    time: '16:30',
    title: 'The selected text rode inside the URL',
    body: 'The capture was part of the address the extension opened, so the text could end up in browser history and in synced history. Not checked in a real browser.',
    tags: ['privacy'],
  },
  {
    id: 'example-s-mdn',
    type: 'source',
    time: '16:40',
    title: 'MDN: Match patterns',
    url: 'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns',
    quote: "Firefox doesn't support the inclusion of a port number",
    body: 'So the content script is declared for localhost and 127.0.0.1 without a port, which covers every port, and it checks the configured app address itself.',
    tags: ['extension', 'firefox'],
  },
  {
    id: 'example-s-chrome-mp',
    type: 'source',
    time: '16:40',
    title: 'Chrome for Developers: Match patterns',
    url: 'https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns',
    quote: 'Match patterns match all ports unless an explicit port is specified.',
    tags: ['extension', 'chrome'],
  },
  {
    id: 'example-n-permission',
    type: 'note',
    time: '16:57',
    title: 'The bridge needs access to localhost',
    body: 'The extension now asks for http(s) access to localhost and 127.0.0.1. Firefox can hold that permission back until the user grants it, so the first capture may show a prompt.',
    tags: ['extension', 'trade-off'],
  },
  {
    id: 'example-n-private',
    type: 'note',
    time: '16:31',
    title: 'The sidebar promised “Stored locally · private by default”',
    body: 'Yet every page load fetched fonts from fonts.googleapis.com, which tells Google when the app is used, and the fonts fell back when offline.',
    tags: ['privacy'],
  },
  {
    id: 'example-s-ofl',
    type: 'source',
    time: '16:45',
    title: 'SIL Open Font License 1.1',
    url: 'https://openfontlicense.org/',
    body: 'Manrope and DM Mono are OFL-1.1 fonts, so they can be bundled and redistributed together with their licence text.',
    tags: ['licensing'],
  },
  {
    id: 'example-f-fonts',
    type: 'file-change',
    time: '16:47',
    title: 'src/styles.css: removed the fonts.googleapis.com import',
    body: 'The latin and latin-ext subsets now live in src/assets/fonts next to OFL-Manrope.txt and OFL-DM-Mono.txt.',
    tags: ['privacy'],
  },
  {
    id: 'example-s-chrome-icons',
    type: 'source',
    time: '16:31',
    title: 'Chrome for Developers: Manifest icons',
    url: 'https://developer.chrome.com/docs/extensions/reference/manifest/icons',
    quote: 'WebP and SVG files are not supported.',
    tags: ['extension', 'chrome'],
  },
  {
    id: 'example-f-icons',
    type: 'file-change',
    time: '16:59',
    title: 'scripts/build-icons.mjs: rasterise the icon without dependencies',
    body: 'Draws the rounded square and the bolt with 4×4 supersampling and writes the PNGs with node:zlib.',
    tags: ['extension'],
  },
  {
    id: 'example-n-origin',
    type: 'note',
    time: '16:32',
    title: 'The port is part of the storage origin',
    body: 'localStorage belongs to an origin, and the origin includes the port. When 5173 was busy, Vite quietly moved to 5174, where the trail looked empty while the extension still pointed at 5173.',
    tags: ['storage'],
  },
  {
    id: 'example-f-port',
    type: 'file-change',
    time: '17:00',
    title: 'vite.config.ts: strictPort on 5173 for dev and preview',
    tags: ['developer-experience'],
  },
  {
    id: 'example-n-graph',
    type: 'note',
    time: '16:33',
    title: 'Wanted for the open-source release: a graph view',
    body: 'Seeing how sources, notes, commands and file changes hang off each decision should not require reading the whole timeline.',
    tags: ['ui'],
  },
  {
    id: 'example-d-tracemap',
    type: 'decision',
    status: 'accepted',
    time: '18:48',
    title: 'Make the trace map the main view',
    body: 'Each live decision gets one row: evidence that supports it on the left, evidence that challenges it on the right, and the decisions it replaced inside its card. The graph and the timeline stay one key away (G and T).',
    tags: ['ui'],
  },
  {
    id: 'example-d-replay',
    type: 'decision',
    status: 'proposed',
    time: '17:12',
    title: 'Replay how the trail formed with a time slider',
    body: 'Drag a slider, or press play, to watch entries and links appear in the order they were recorded.',
    tags: ['ui'],
  },
  {
    id: 'example-n-mockups',
    type: 'note',
    time: '17:09',
    title: 'Compared three layouts on the example data',
    body: 'A: the workspace with a graph tab. B: a full-screen canvas with a replay slider. C: a trace map with one row per decision.',
    tags: ['ui'],
  },
  {
    id: 'example-n-canvas',
    type: 'note',
    time: '17:12',
    title: 'A full-screen canvas is harder to use every day',
    body: 'Option B looked the most striking, but capturing and reading entries day to day happens in lists, not on a canvas.',
    tags: ['ui'],
  },
  {
    id: 'example-n-replay',
    type: 'note',
    time: '17:09',
    title: 'The replay slider in option B ran on the example data',
    body: 'Dragging it to 16:40 showed the 13 entries recorded by then.',
    tags: ['ui'],
  },
  {
    id: 'example-n-choice',
    type: 'note',
    time: '18:48',
    title: 'The trace map was picked without the slider',
    body: 'Of the four choices offered, the plain trace map was picked. The slider stays open for later.',
    tags: ['ui'],
  },
  {
    id: 'example-n-narrow',
    type: 'note',
    time: '19:10',
    title: 'The trace map needs a wide window',
    body: 'Below 1180 px the three columns no longer fit, so each row stacks: the decision first, then its evidence.',
    tags: ['ui', 'limitation'],
  },
  {
    id: 'example-f-tracemap',
    type: 'file-change',
    time: '19:02',
    title: 'src/ui/tracemap-view.ts: one row per decision',
    body: 'Supporting evidence on the left, challenging evidence on the right, connectors drawn from the chip positions, and replaced decisions inside the card.',
    tags: ['ui'],
  },
  {
    id: 'example-f-layout',
    type: 'file-change',
    time: '19:00',
    title: 'src/core/layout.ts: deterministic force layout',
    body: 'Every node starts at a position derived from its id, so the same trail is always drawn the same way.',
    tags: ['ui'],
  },
];

const relations: Array<[decisionId: string, evidenceId: string, kind: LinkKind]> = [
  ['example-d-bridge', 'example-c-hash', 'supports'],
  ['example-d-bridge', 'example-n-history', 'supports'],
  ['example-d-bridge', 'example-s-mdn', 'supports'],
  ['example-d-bridge', 'example-s-chrome-mp', 'supports'],
  ['example-d-bridge', 'example-n-permission', 'challenges'],
  ['example-d-fragment', 'example-c-hash', 'challenges'],
  ['example-d-fragment', 'example-n-history', 'challenges'],
  ['example-d-reread', 'example-c-multitab', 'supports'],
  ['example-d-reread', 'example-n-newtab', 'supports'],
  ['example-d-reread', 'example-f-store', 'supports'],
  ['example-d-reread', 'example-n-race', 'challenges'],
  ['example-d-snapshot', 'example-c-multitab', 'challenges'],
  ['example-d-snapshot', 'example-n-newtab', 'challenges'],
  ['example-d-fonts', 'example-n-private', 'supports'],
  ['example-d-fonts', 'example-s-ofl', 'supports'],
  ['example-d-fonts', 'example-f-fonts', 'supports'],
  ['example-d-icons', 'example-s-chrome-icons', 'supports'],
  ['example-d-icons', 'example-f-icons', 'supports'],
  ['example-d-port', 'example-n-origin', 'supports'],
  ['example-d-port', 'example-f-port', 'supports'],
  ['example-d-graph', 'example-n-graph', 'supports'],
  ['example-d-graph', 'example-f-layout', 'supports'],
  ['example-d-tracemap', 'example-n-mockups', 'supports'],
  ['example-d-tracemap', 'example-n-canvas', 'supports'],
  ['example-d-tracemap', 'example-f-tracemap', 'supports'],
  ['example-d-tracemap', 'example-n-narrow', 'challenges'],
  ['example-d-replay', 'example-n-replay', 'supports'],
  ['example-d-replay', 'example-n-choice', 'challenges'],
];

const entries: Entry[] = drafts.map(({ time, body = '', tags = [], ...rest }) => ({
  ...rest,
  type: rest.type as EntryType,
  body,
  tags,
  createdAt: at(time),
  updatedAt: at(time),
  origin: 'example',
}));

const createdAt = new Map(entries.map((entry) => [entry.id, entry.createdAt]));

const links: Link[] = relations.map(([decisionId, evidenceId, kind]) => {
  const a = createdAt.get(decisionId) ?? '';
  const b = createdAt.get(evidenceId) ?? '';
  return { decisionId, evidenceId, kind, createdAt: a > b ? a : b };
});

export const EXAMPLE_WORKSPACE: Readonly<Workspace> = Object.freeze({
  schema: SCHEMA_VERSION,
  revision: 0,
  entries,
  links,
});
