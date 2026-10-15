import { captureToEntry, connectExtensionBridge, type BrowserCapture } from './core/bridge';
import {
  buildDecisionBundle,
  bundleToJson,
  bundleToMarkdown,
  exportFilename,
  workspaceToJson,
} from './core/export';
import {
  DECISION_STATUSES,
  ENTRY_TYPES,
  LINK_LABELS,
  STATUS_LABELS,
  isLinkKind,
  typeLabel,
  type Entry,
  type EntryType,
  type LinkKind,
} from './core/model';
import { decisionsFor, evidenceFor, searchEntries, workspaceStats } from './core/query';
import { StorageFullError, TimelineStore } from './core/store';

export interface MountOptions {
  /** Defaults to a store backed by this browser's localStorage. */
  store?: TimelineStore;
  /** Window used for cross-tab sync and the extension bridge. */
  target?: Window;
}

/** Renders Traceback into `root`. Returns a function that disconnects every listener. */
export function mountApp(root: HTMLElement, options: MountOptions = {}): () => void {
  const store = options.store ?? new TimelineStore();
  const target = options.target ?? window;
  const app = root;


  let activeType: EntryType | 'all' = 'all';
  let search = '';
  let selectedDecisionId: string | undefined;
  let howCollapsed = false;
  const notices: Array<{ id: number; tone: 'ok' | 'warn'; title: string; detail?: string }> = [];
  let noticeId = 0;

  function notify(tone: 'ok' | 'warn', title: string, detail?: string): void {
    notices.unshift({ id: ++noticeId, tone, title, detail });
    notices.length = Math.min(notices.length, 3);
  }

  /** Runs a store mutation and turns failures into a visible notice instead of a silent console error. */
  function attempt<T>(action: () => T): T | undefined {
    try {
      return action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify('warn', error instanceof StorageFullError ? 'Could not save' : 'That did not work', message);
      render();
      return undefined;
    }
  }

  if (store.loadReport.migratedFromV1) {
    notify('ok', 'Your Traceback 0.1 trail was upgraded.', 'The original data is still in browser storage, untouched.');
  }
  if (!store.loadReport.persistent) {
    notify('warn', 'This browser blocks local storage.', 'Changes stay in this tab only and are lost when it closes. Export a backup before leaving.');
  }
  for (const issue of store.loadReport.issues.slice(0, 2)) notify('warn', 'Some saved data needed repair.', issue);

  function receiveCaptures(captures: BrowserCapture[]): string[] {
    const stored: string[] = [];
    for (const capture of captures) {
      if (store.get(capture.id)) {
        stored.push(capture.id);
        continue;
      }
      try {
        store.createEntry(captureToEntry(capture));
        stored.push(capture.id);
      } catch (error) {
        notify('warn', 'A capture could not be saved.', error instanceof Error ? error.message : String(error));
        break;
      }
    }
    if (stored.length) {
      const first = store.get(stored[0]);
      notify(
        'ok',
        stored.length === 1 && first ? `Saved “${first.title}” as source evidence.` : `Saved ${stored.length} captures from the browser.`,
        'Connect it to a decision with “Connect supporting evidence”.',
      );
    }
    render();
    return stored;
  }

  const unsubscribe = store.subscribe((reason) => {
    if (reason === 'external') render();
  });
  const stopSync = store.connect(target);
  const stopBridge = connectExtensionBridge({ target, onCaptures: receiveCaptures });

  function render(): void {
    const searchInput = app.querySelector<HTMLInputElement>('#search');
    const caret = searchInput && document.activeElement === searchInput ? [searchInput.selectionStart, searchInput.selectionEnd] : null;

    const index = store.index();
    const stats = workspaceStats(index);
    const entries = searchEntries(index, search, activeType);
    const decisions = searchEntries(index, '', 'decision');
    const selected = (selectedDecisionId && index.byId.get(selectedDecisionId)) || decisions[0];
    selectedDecisionId = selected?.id;
    const empty = stats.total === 0;

    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand"><span class="brand-mark" aria-hidden="true">↯</span><span>traceback</span></div>
          <div class="sidebar-copy">Your work, with the<br /><strong>why</strong> still attached.</div>
          <nav class="filters" aria-label="Entry filters">
            <button class="filter ${activeType === 'all' ? 'active' : ''}" data-type="all" aria-pressed="${activeType === 'all'}"><span aria-hidden="true">◈</span> All activity <b>${stats.total}</b></button>
            ${ENTRY_TYPES.map((type) => `<button class="filter ${activeType === type ? 'active' : ''}" data-type="${type}" aria-pressed="${activeType === type}"><span aria-hidden="true">${iconFor(type)}</span> ${typeLabel(type, true)} <b>${stats.byType[type]}</b></button>`).join('')}
          </nav>
          <div class="backup-actions">
            <button class="link-button" id="export-backup" ${empty ? 'disabled' : ''}>Export backup</button>
            <label class="link-button">Import backup<input type="file" id="import-backup" accept="application/json,.json" hidden /></label>
          </div>
          <div class="sidebar-footer"><span class="status-dot"></span> ${store.loadReport.persistent ? 'Stored locally' : 'Not saved: storage blocked'} <small>· private by default</small></div>
        </aside>
        <main class="main">
          <header class="topbar"><div><p class="eyebrow">WORKSPACE / PERSONAL</p><h1>Timeline</h1><p class="page-subtitle">A clear trail of what you found, changed, and chose.</p></div><button class="primary" id="new-entry">＋ Capture entry</button></header>
          <div class="notices" aria-live="polite">${notices.map(noticeCard).join('')}</div>
          ${stats.examples ? `<div class="example-banner"><span>You are looking at the example workspace: the real decision log of the Traceback 0.2 rewrite.</span><button class="link-button" id="remove-examples">Remove example data</button></div>` : ''}
          <section class="how-it-works"><div class="how-heading"><span class="eyebrow">THE TRACEBACK LOOP</span><button class="how-toggle" id="toggle-how" aria-expanded="${!howCollapsed}" aria-controls="how-steps">How does this work? <span aria-hidden="true">⌄</span></button></div><div class="how-steps ${howCollapsed ? 'collapsed' : ''}" id="how-steps"><div><b>1</b><strong>Capture evidence</strong><p>Save a source, note, command, or file change while you work.</p></div><div><b>2</b><strong>Make a decision</strong><p>Record what you chose and why it mattered.</p></div><div><b>3</b><strong>Connect the why</strong><p>Link evidence for or against the decision, then export the bundle later.</p></div></div></section>
          <section class="stats" aria-label="Workspace summary"><div><span class="stat-icon" aria-hidden="true">◈</span><span><b>${stats.total}</b><small>total entries</small></span></div><div><span class="stat-icon stat-decision" aria-hidden="true">◎</span><span><b>${stats.decisions}</b><small>${stats.unsupported.length ? `decisions · ${stats.unsupported.length} without support` : 'decisions'}</small></span></div><div><span class="stat-icon stat-linked" aria-hidden="true">↗</span><span><b>${stats.linkedEvidence}/${stats.evidence}</b><small>evidence connected</small></span></div></section>
          <section class="toolbar"><label class="search"><span aria-hidden="true">⌕</span><span class="visually-hidden">Search entries</span><input id="search" value="${escapeHtml(search)}" placeholder="Search… try type:decision, #tag or is:unlinked" autocomplete="off" spellcheck="false" /></label><span class="result-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span></section>
          <section class="content-grid">
            <div class="timeline">${empty ? onboarding() : entries.length ? entries.map((entry) => entryCard(entry, selected?.id === entry.id)).join('') : emptyState()}</div>
            <aside class="inspector">${selected ? inspector(selected) : '<div class="empty-inspector">Create a decision to build an evidence bundle.</div>'}</aside>
          </section>
        </main>
      </div>
      <dialog id="entry-dialog" aria-labelledby="entry-dialog-title"><form id="entry-form"><div class="dialog-head"><div><p class="eyebrow">NEW CAPTURE</p><h2 id="entry-dialog-title">Add to your trail</h2><p class="dialog-help">A piece of evidence you may want later, or a decision you made.</p></div><button type="button" class="icon-button" data-close aria-label="Close">×</button></div><label>Type<select name="type">${ENTRY_TYPES.map((type) => `<option value="${type}">${typeLabel(type)}</option>`).join('')}</select></label><label>Title<input name="title" required maxlength="300" placeholder="What happened?" /></label><label>Details<textarea name="body" rows="5" placeholder="Capture the useful context…"></textarea></label><label>Link <small>optional</small><input name="url" type="url" inputmode="url" placeholder="https://…" /></label><label>Tags<input name="tags" placeholder="e.g. release, research" /></label><button class="primary full" type="submit">Save entry</button></form></dialog>
      <dialog id="link-dialog" aria-labelledby="link-dialog-title"><form id="link-form"><div class="dialog-head"><div><p class="eyebrow">CONNECT EVIDENCE</p><h2 id="link-dialog-title">What bears on this decision?</h2><p class="dialog-help">Select the sources, notes, commands, or file changes that explain this choice, or push against it.</p></div><button type="button" class="icon-button" data-close aria-label="Close">×</button></div><div class="relation-picker" role="radiogroup" aria-label="Relation">${(['supports', 'challenges'] as LinkKind[]).map((kind, position) => `<label><input type="radio" name="kind" value="${kind}" ${position === 0 ? 'checked' : ''} /> ${LINK_LABELS[kind]}</label>`).join('')}</div><div class="candidate-list">${linkCandidates().map((entry) => `<label class="candidate"><input type="checkbox" name="evidence" value="${entry.id}" /><span class="mini-icon type-${entry.type}" aria-hidden="true">${iconFor(entry.type)}</span><span><strong>${escapeHtml(entry.title)}</strong><small>${typeLabel(entry.type)} · ${formatDate(entry.createdAt)}</small></span></label>`).join('')}</div><button class="primary full" type="submit">Link selected evidence</button></form></dialog>
    `;
    bindEvents();

    if (caret) {
      const input = app.querySelector<HTMLInputElement>('#search');
      input?.focus();
      input?.setSelectionRange(caret[0], caret[1]);
    }
  }

  function noticeCard(notice: (typeof notices)[number]): string {
    return `<div class="capture-notice ${notice.tone === 'warn' ? 'is-warning' : ''}"><span class="notice-icon" aria-hidden="true">${notice.tone === 'warn' ? '!' : '✓'}</span><div><strong>${escapeHtml(notice.title)}</strong>${notice.detail ? `<small>${escapeHtml(notice.detail)}</small>` : ''}</div><button class="notice-close" data-dismiss="${notice.id}" aria-label="Dismiss">×</button></div>`;
  }

  function entryCard(entry: Entry, selected: boolean): string {
    const index = store.index();
    const links = decisionsFor(index, entry.id);
    const isDecision = entry.type === 'decision';
    const supports = links.filter(({ link }) => link.kind === 'supports').length;
    const challenges = links.length - supports;
    const linked = [
      supports ? `↳ supports ${supports} decision${supports === 1 ? '' : 's'}` : '',
      challenges ? `↳ challenges ${challenges}` : '',
    ].filter(Boolean).join(' · ');
    return `<article class="entry ${selected ? 'selected' : ''} ${isDecision ? 'is-decision' : ''}" data-entry-id="${entry.id}" ${isDecision ? `tabindex="0" role="button" aria-pressed="${selected}"` : ''}>
      <div class="entry-rail"><span class="type-icon type-${entry.type}" aria-hidden="true">${iconFor(entry.type)}</span><span class="line"></span></div>
      <div class="entry-main">
        <div class="entry-meta"><span class="pill pill-${entry.type}">${typeLabel(entry.type)}</span>${entry.status ? `<span class="pill status-${entry.status}">${STATUS_LABELS[entry.status]}</span>` : ''}<time datetime="${entry.createdAt}">${formatDate(entry.createdAt)}</time>${linked ? `<span class="linked">${linked}</span>` : ''}</div>
        <h3>${escapeHtml(entry.title)}${isDecision ? '<span class="open-arrow" aria-hidden="true">↗</span>' : ''}</h3>
        ${entry.quote ? `<blockquote>${escapeHtml(entry.quote)}</blockquote>` : ''}
        ${entry.body ? `<p>${escapeHtml(entry.body)}</p>` : ''}
        ${entry.url ? `<a class="entry-url" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeHtml(entry.url)}</a>` : ''}
        ${entry.tags.length ? `<div class="tags">${entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      </div>
    </article>`;
  }

  function inspector(decision: Entry): string {
    const evidence = evidenceFor(store.index(), decision.id);
    const replacement = decision.supersededBy ? store.get(decision.supersededBy) : undefined;
    const item = ({ entry, link }: (typeof evidence)[number]) =>
      `<div class="evidence-item relation-${link.kind}"><span class="mini-icon type-${entry.type}" aria-hidden="true">${iconFor(entry.type)}</span><div><strong>${escapeHtml(entry.title)}</strong><small>${LINK_LABELS[link.kind]} · ${typeLabel(entry.type)} · ${formatDate(entry.createdAt)}</small></div><button class="unlink" data-unlink="${entry.id}" aria-label="Unlink ${escapeHtml(entry.title)}">×</button></div>`;
    const supports = evidence.filter(({ link }) => link.kind === 'supports');
    const challenges = evidence.filter(({ link }) => link.kind === 'challenges');
    return `<div class="inspector-head"><div><p class="eyebrow">DECISION FOCUS</p><h2>${escapeHtml(decision.title)}</h2></div><span class="decision-badge" aria-hidden="true">◎</span></div>
      <label class="status-select">Status<select id="decision-status">${DECISION_STATUSES.filter((status) => status !== 'superseded' || decision.status === 'superseded').map((status) => `<option value="${status}" ${decision.status === status ? 'selected' : ''}>${STATUS_LABELS[status]}</option>`).join('')}</select></label>
      ${replacement ? `<p class="muted">Superseded by “${escapeHtml(replacement.title)}”.</p>` : ''}
      <p class="inspector-body">${escapeHtml(decision.body) || '<span class="muted">No rationale recorded.</span>'}</p>
      <div class="bundle-label"><span>Supporting evidence</span><b>${supports.length}</b></div>
      <div class="evidence-list">${supports.length ? supports.map(item).join('') : '<p class="muted">Nothing connected yet. Add the sources that helped you decide.</p>'}</div>
      ${challenges.length ? `<div class="bundle-label is-challenge"><span>Challenging evidence</span><b>${challenges.length}</b></div><div class="evidence-list">${challenges.map(item).join('')}</div>` : ''}
      <button class="secondary full" id="link-evidence">＋ Connect evidence</button>
      <div class="export-actions"><button class="export" data-format="md">Export Markdown</button><button class="export" data-format="json">Export JSON</button></div>`;
  }

  function onboarding(): string {
    return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">⌁</div><h2>Your trail is empty</h2><p>Capture a source, note, command or file change, then record the decision it led to.</p><div class="onboarding-actions"><button class="primary" id="first-entry">Capture your first entry</button><button class="secondary" id="load-example">Explore an example workspace</button></div><p class="muted">The example is the real decision log behind Traceback 0.2. You can remove it in one click.</p></div>`;
  }

  function emptyState(): string {
    return '<div class="empty-state"><div class="empty-icon" aria-hidden="true">⌁</div><h2>No matching entries</h2><p>Try a different search or capture something new.</p></div>';
  }

  function bindEvents(): void {
    app.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((button) =>
      button.addEventListener('click', () => {
        activeType = button.dataset.type as EntryType | 'all';
        render();
      }),
    );
    app.querySelector<HTMLInputElement>('#search')?.addEventListener('input', (event) => {
      search = (event.target as HTMLInputElement).value;
      render();
    });
    app.querySelectorAll<HTMLElement>('[data-entry-id]').forEach((card) => {
      const select = () => {
        const entry = store.get(card.dataset.entryId!);
        if (entry?.type === 'decision') {
          selectedDecisionId = entry.id;
          render();
          app.querySelector<HTMLElement>(`[data-entry-id="${entry.id}"]`)?.focus();
        }
      };
      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('a')) return;
        select();
      });
      card.addEventListener('keydown', (event) => {
        if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          select();
        }
      });
    });

    const entryDialog = app.querySelector<HTMLDialogElement>('#entry-dialog')!;
    const linkDialog = app.querySelector<HTMLDialogElement>('#link-dialog')!;
    app.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((button) =>
      button.addEventListener('click', () => button.closest('dialog')?.close()),
    );
    const openEntryDialog = () => entryDialog.showModal();
    app.querySelector('#new-entry')?.addEventListener('click', openEntryDialog);
    app.querySelector('#first-entry')?.addEventListener('click', openEntryDialog);
    app.querySelector('#load-example')?.addEventListener('click', () => {
      const added = attempt(() => store.loadExample());
      if (added !== undefined) {
        selectedDecisionId = 'example-d-bridge';
        render();
      }
    });
    app.querySelector('#remove-examples')?.addEventListener('click', () => {
      const removed = attempt(() => store.removeExamples());
      if (removed) {
        notify('ok', `Removed ${removed} example entries.`);
        selectedDecisionId = undefined;
        render();
      }
    });

    app.querySelector<HTMLFormElement>('#entry-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const created = attempt(() =>
        store.createEntry({
          type: form.get('type') as EntryType,
          title: String(form.get('title') ?? ''),
          body: String(form.get('body') ?? ''),
          url: String(form.get('url') ?? ''),
          tags: String(form.get('tags') ?? ''),
        }),
      );
      if (!created) return;
      if (created.type === 'decision') selectedDecisionId = created.id;
      entryDialog.close();
      render();
    });

    app.querySelector('#link-evidence')?.addEventListener('click', () => {
      if (!selectedDecisionId) return;
      if (!linkCandidates().length) {
        notify('warn', 'Nothing left to connect.', 'Capture a source, note, command or file change first.');
        render();
        return;
      }
      linkDialog.showModal();
    });
    app.querySelector<HTMLFormElement>('#link-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const decisionId = selectedDecisionId;
      if (!decisionId) return;
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const kindValue = form.get('kind');
      const kind: LinkKind = isLinkKind(kindValue) ? kindValue : 'supports';
      for (const id of form.getAll('evidence')) {
        if (attempt(() => store.linkEvidence(decisionId, String(id), kind)) === undefined) return;
      }
      linkDialog.close();
      render();
    });
    app.querySelectorAll<HTMLButtonElement>('[data-unlink]').forEach((button) =>
      button.addEventListener('click', () => {
        if (selectedDecisionId) attempt(() => store.unlinkEvidence(selectedDecisionId!, button.dataset.unlink!));
        render();
      }),
    );
    app.querySelector<HTMLSelectElement>('#decision-status')?.addEventListener('change', (event) => {
      const status = (event.target as HTMLSelectElement).value as (typeof DECISION_STATUSES)[number];
      if (selectedDecisionId) attempt(() => store.updateEntry(selectedDecisionId!, { status }));
      render();
    });

    app.querySelectorAll<HTMLButtonElement>('[data-dismiss]').forEach((button) =>
      button.addEventListener('click', () => {
        const position = notices.findIndex((notice) => notice.id === Number(button.dataset.dismiss));
        if (position >= 0) notices.splice(position, 1);
        render();
      }),
    );
    app.querySelector('#toggle-how')?.addEventListener('click', () => {
      howCollapsed = !howCollapsed;
      render();
    });
    app.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((button) =>
      button.addEventListener('click', () => downloadBundle(button.dataset.format as 'md' | 'json')),
    );
    app.querySelector('#export-backup')?.addEventListener('click', () => {
      download(workspaceToJson(store.workspace), exportFilename('workspace', 'json'), 'application/json');
    });
    app.querySelector<HTMLInputElement>('#import-backup')?.addEventListener('change', async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const text = await file.text();
      const report = attempt(() => store.importWorkspace(text, 'merge'));
      if (report) {
        notify(
          report.issues.length ? 'warn' : 'ok',
          `Imported ${report.added} new and ${report.updated} updated entries.`,
          report.issues.length ? `${report.issues.length} records needed repair or were skipped: ${report.issues[0]}` : undefined,
        );
        render();
      }
    });
  }

  function linkCandidates(): Entry[] {
    if (!selectedDecisionId) return [];
    const index = store.index();
    const linked = new Set(evidenceFor(index, selectedDecisionId).map(({ entry }) => entry.id));
    return searchEntries(index, '').filter((entry) => entry.type !== 'decision' && !linked.has(entry.id));
  }

  function downloadBundle(format: 'md' | 'json'): void {
    if (!selectedDecisionId) return;
    const bundle = attempt(() => buildDecisionBundle(store.index(), selectedDecisionId!));
    if (!bundle) return;
    const content = format === 'md' ? bundleToMarkdown(bundle) : bundleToJson(bundle);
    download(content, exportFilename(bundle.decision.title, format), format === 'md' ? 'text/markdown' : 'application/json');
  }

  function download(content: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }


  render();
  return () => {
    unsubscribe();
    stopSync();
    stopBridge();
  };
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));
}

function iconFor(type: EntryType): string {
  return ({ source: '◉', note: '✎', decision: '◎', command: '⌘', 'file-change': '⌁' } as const)[type];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character);
}
