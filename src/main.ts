import './styles.css';
import { parseBrowserCapture, saveBrowserCapture } from './capture';
import { ENTRY_TYPES, formatDate, typeLabel, type EntryType, type TimelineEntry } from './domain';
import { decisionBundle, exportDecisionJson, exportDecisionMarkdown } from './export';
import { LocalStorageTimelineRepository } from './repository';

const repository = new LocalStorageTimelineRepository();
const app = document.querySelector<HTMLDivElement>('#app')!;
let activeType: EntryType | 'all' = 'all';
let search = '';
let selectedDecisionId: string | undefined;
let captureNotice: string | undefined;

const sampleEntries = [
  { type: 'decision' as const, title: 'Use local-first storage for the MVP', body: 'Keep project evidence on-device first. A repository boundary leaves room for SQLite when the Tauri shell lands.', tags: ['architecture', 'mvp'] },
  { type: 'source' as const, title: 'Product brief', body: 'Traceback connects the evidence behind digital work to the decisions that came out of it.', tags: ['brief'] },
  { type: 'command' as const, title: 'npm run build', body: 'Validated the first production build of the vertical slice.', tags: ['validation'] },
];

if (!repository.list().length) sampleEntries.forEach((entry) => repository.create(entry));

const browserCapture = parseBrowserCapture(new URLSearchParams(window.location.hash.slice(1)).get('traceback_capture'));
if (browserCapture) {
  const captured = saveBrowserCapture(repository, browserCapture);
  captureNotice = `Saved “${captured.title}” as source evidence.`;
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
}

function render(): void {
  const entries = repository.list({ search, type: activeType });
  const decisions = repository.list({ type: 'decision' });
  const selected = selectedDecisionId ? repository.get(selectedDecisionId) : decisions[0];
  selectedDecisionId = selected?.id;
  const linked = selected ? repository.evidenceFor(selected.id) : [];
  const allEntries = repository.list();
  const evidenceCount = allEntries.filter((entry) => entry.type !== 'decision').length;
  const linkedCount = allEntries.filter((entry) => repository.decisionsFor(entry.id).length > 0).length;

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">↯</span><span>traceback</span></div>
        <div class="sidebar-copy">Your work, with the<br /><strong>why</strong> still attached.</div>
        <nav class="filters" aria-label="Entry filters">
          <button class="filter ${activeType === 'all' ? 'active' : ''}" data-type="all"><span>◈</span> All activity <b>${repository.list().length}</b></button>
          ${ENTRY_TYPES.map((type) => `<button class="filter ${activeType === type ? 'active' : ''}" data-type="${type}"><span>${iconFor(type)}</span> ${type === 'file-change' ? 'File changes' : `${type[0].toUpperCase()}${type.slice(1)}s`} <b>${repository.list({ type }).length}</b></button>`).join('')}
        </nav>
        <div class="sidebar-footer"><span class="status-dot"></span> Stored locally <small>· private by default</small></div>
      </aside>
      <main class="main">
        <header class="topbar"><div><p class="eyebrow">WORKSPACE / PERSONAL</p><h1>Timeline</h1><p class="page-subtitle">A clear trail of what you found, changed, and chose.</p></div><button class="primary" id="new-entry">＋ Capture entry</button></header>
        ${captureNotice ? `<div class="capture-notice"><span class="notice-icon">✓</span><div><strong>${escapeHtml(captureNotice)}</strong><small>The browser extension captured the page title, URL, and selected text so you can connect it to a decision.</small></div><button class="notice-close" id="dismiss-notice" aria-label="Dismiss">×</button></div>` : ''}
        <section class="how-it-works"><div class="how-heading"><span class="eyebrow">THE TRACEBACK LOOP</span><button class="how-toggle" id="toggle-how">How does this work? <span>⌄</span></button></div><div class="how-steps" id="how-steps"><div><b>1</b><strong>Capture evidence</strong><p>Save a source, note, command, or file change while you work.</p></div><div><b>2</b><strong>Make a decision</strong><p>Record what you chose and why it mattered.</p></div><div><b>3</b><strong>Connect the why</strong><p>Link evidence to the decision, then export the bundle later.</p></div></div></section>
        <section class="stats" aria-label="Workspace summary"><div><span class="stat-icon">◈</span><span><b>${allEntries.length}</b><small>total entries</small></span></div><div><span class="stat-icon stat-decision">◎</span><span><b>${decisions.length}</b><small>decisions</small></span></div><div><span class="stat-icon stat-linked">↗</span><span><b>${linkedCount}/${evidenceCount || 0}</b><small>evidence connected</small></span></div></section>
        <section class="toolbar"><label class="search"><span>⌕</span><input id="search" value="${escapeHtml(search)}" placeholder="Search your trail..." /></label><span class="result-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span></section>
        <section class="content-grid">
          <div class="timeline">${entries.length ? entries.map((entry) => entryCard(entry, selected?.id === entry.id)).join('') : emptyState()}</div>
          <aside class="inspector">${selected ? inspector(selected, linked) : '<div class="empty-inspector">Create a decision to build an evidence bundle.</div>'}</aside>
        </section>
      </main>
    </div>
    <dialog id="entry-dialog"><form method="dialog" id="entry-form"><div class="dialog-head"><div><p class="eyebrow">NEW CAPTURE</p><h2>Add to your trail</h2><p class="dialog-help">This is a piece of evidence you may want to use later.</p></div><button class="icon-button" value="cancel" aria-label="Close">×</button></div><label>Type<select name="type">${ENTRY_TYPES.map((type) => `<option value="${type}">${typeLabel(type)}</option>`).join('')}</select></label><label>Title<input name="title" required placeholder="What happened?" /></label><label>Details<textarea name="body" required rows="5" placeholder="Capture the useful context..."></textarea></label><label>Tags<input name="tags" placeholder="e.g. release, research" /></label><button class="primary full" value="default">Save entry</button></form></dialog>
    <dialog id="link-dialog"><form method="dialog" id="link-form"><div class="dialog-head"><div><p class="eyebrow">CONNECT EVIDENCE</p><h2>What supports this decision?</h2><p class="dialog-help">Select the sources, notes, commands, or file changes that explain why you chose this.</p></div><button class="icon-button" value="cancel" aria-label="Close">×</button></div><div class="candidate-list">${linkCandidates().map((entry) => `<label class="candidate"><input type="checkbox" name="evidence" value="${entry.id}" /><span class="mini-icon type-${entry.type}">${iconFor(entry.type)}</span><span><strong>${escapeHtml(entry.title)}</strong><small>${typeLabel(entry.type)} · ${formatDate(entry.createdAt)}</small></span></label>`).join('')}</div><button class="primary full" value="default">Link selected evidence</button></form></dialog>
  `;
  bindEvents();
}

function entryCard(entry: TimelineEntry, selected: boolean): string {
  const links = repository.decisionsFor(entry.id);
  const isDecision = entry.type === 'decision';
  return `<article class="entry ${selected ? 'selected' : ''} ${isDecision ? 'is-decision' : ''}" data-entry-id="${entry.id}" ${isDecision ? 'tabindex="0" role="button"' : ''}><div class="entry-rail"><span class="type-icon type-${entry.type}">${iconFor(entry.type)}</span><span class="line"></span></div><div class="entry-main"><div class="entry-meta"><span class="pill pill-${entry.type}">${entry.type === 'file-change' ? 'File change' : entry.type}</span><time>${formatDate(entry.createdAt)}</time>${links.length ? `<span class="linked">↳ supports ${links.length} decision${links.length === 1 ? '' : 's'}</span>` : ''}</div><h3>${escapeHtml(entry.title)}${isDecision ? '<span class="open-arrow">↗</span>' : ''}</h3><p>${escapeHtml(entry.body)}</p>${entry.tags.length ? `<div class="tags">${entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}</div></article>`;
}

function inspector(decision: TimelineEntry, evidence: TimelineEntry[]): string {
  return `<div class="inspector-head"><div><p class="eyebrow">DECISION FOCUS</p><h2>${escapeHtml(decision.title)}</h2></div><span class="decision-badge">◎</span></div><p class="inspector-body">${escapeHtml(decision.body)}</p><div class="bundle-label"><span>Evidence supporting this choice</span><b>${evidence.length}</b></div><div class="evidence-list">${evidence.length ? evidence.map((entry) => `<div class="evidence-item"><span class="mini-icon type-${entry.type}">${iconFor(entry.type)}</span><div><strong>${escapeHtml(entry.title)}</strong><small>${typeLabel(entry.type)} · ${formatDate(entry.createdAt)}</small></div></div>`).join('') : '<p class="muted">Nothing connected yet. Add the sources that helped you decide.</p>'}</div><button class="secondary full" id="link-evidence">＋ Connect supporting evidence</button><div class="export-actions"><button class="export" data-format="md">Export Markdown</button><button class="export" data-format="json">Export JSON</button></div>`;
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((button) => button.addEventListener('click', () => { activeType = button.dataset.type as EntryType | 'all'; render(); }));
  document.querySelector<HTMLInputElement>('#search')?.addEventListener('input', (event) => { search = (event.target as HTMLInputElement).value; render(); document.querySelector<HTMLInputElement>('#search')?.focus(); });
  document.querySelectorAll<HTMLElement>('[data-entry-id]').forEach((card) => {
    const select = () => { const entry = repository.get(card.dataset.entryId!); if (entry?.type === 'decision') { selectedDecisionId = entry.id; render(); } };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });
  const dialog = document.querySelector<HTMLDialogElement>('#entry-dialog');
  document.querySelector('#new-entry')?.addEventListener('click', () => dialog?.showModal());
  document.querySelector<HTMLFormElement>('#entry-form')?.addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); repository.create({ type: form.get('type') as EntryType, title: String(form.get('title')), body: String(form.get('body')), tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean) }); dialog?.close(); render(); });
  document.querySelector('#link-evidence')?.addEventListener('click', linkEvidence);
  document.querySelector('#dismiss-notice')?.addEventListener('click', () => { captureNotice = undefined; render(); });
  document.querySelector('#toggle-how')?.addEventListener('click', () => document.querySelector('#how-steps')?.classList.toggle('collapsed'));
  document.querySelector<HTMLFormElement>('#link-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!selectedDecisionId) return;
    new FormData(event.currentTarget as HTMLFormElement).getAll('evidence').forEach((id) => repository.linkEvidence(selectedDecisionId!, String(id)));
    document.querySelector<HTMLDialogElement>('#link-dialog')?.close();
    render();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((button) => button.addEventListener('click', () => downloadBundle(button.dataset.format as 'md' | 'json')));
}

function linkEvidence(): void {
  if (!selectedDecisionId) return;
  const candidates = linkCandidates();
  if (!candidates.length) return alert('Create an unlinked source, note, command, or file change first.');
  document.querySelector<HTMLDialogElement>('#link-dialog')?.showModal();
}

function linkCandidates(): TimelineEntry[] {
  if (!selectedDecisionId) return [];
  const linkedIds = new Set(repository.evidenceFor(selectedDecisionId).map((entry) => entry.id));
  return repository.list().filter((entry) => entry.id !== selectedDecisionId && entry.type !== 'decision' && !linkedIds.has(entry.id));
}

function downloadBundle(format: 'md' | 'json'): void {
  if (!selectedDecisionId) return;
  const bundle = decisionBundle(repository, selectedDecisionId);
  const content = format === 'md' ? exportDecisionMarkdown(bundle.decision, bundle.evidence) : exportDecisionJson(bundle.decision, bundle.evidence);
  const blob = new Blob([content], { type: format === 'md' ? 'text/markdown' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `traceback-${bundle.decision.id}.${format}`; link.click(); URL.revokeObjectURL(url);
}

function emptyState(): string { return '<div class="empty-state"><div class="empty-icon">⌁</div><h2>No matching entries</h2><p>Try a different search or capture something new.</p></div>'; }
function iconFor(type: EntryType): string { return ({ source: '◉', note: '✎', decision: '◎', command: '⌘', 'file-change': '⌁' })[type]; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character); }

render();
