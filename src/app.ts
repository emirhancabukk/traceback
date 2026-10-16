import { captureToEntry, connectExtensionBridge, type BrowserCapture } from './core/bridge';
import { buildDecisionBundle, bundleToJson, bundleToMarkdown, exportFilename, workspaceToJson } from './core/export';
import { isDecisionStatus, isEntryType, isLinkKind, type EntryType } from './core/model';
import { StorageFullError, TimelineStore } from './core/store';
import { TRACE_FILTERS, type TraceFilter } from './core/tracemap';
import { createDialogs } from './ui/dialogs';
import { escapeHtml, plural } from './ui/format';
import { attachGraph, renderGraph, type GraphController, type GraphTransform } from './ui/graph-view';
import { icon, type IconName } from './ui/icons';
import { THEME_KEY, applyTheme, isTheme, readTheme, saveTheme, type Theme } from './ui/theme';
import { inspectorHtml } from './ui/inspector';
import { timelineHtml } from './ui/timeline-view';
import { traceMapHtml } from './ui/tracemap-view';

export type View = 'map' | 'timeline' | 'graph';

const VIEWS: Record<View, { label: string; key: string; icon: IconName; hash: string }> = {
  timeline: { label: 'Timeline', key: 't', icon: 'timeline', hash: '#timeline' },
  map: { label: 'Trace map', key: 'm', icon: 'map', hash: '#map' },
  graph: { label: 'Graph', key: 'g', icon: 'graph', hash: '#graph' },
};
const VIEW_ORDER: View[] = ['timeline', 'map', 'graph'];
const DEFAULT_VIEW: View = 'map';

export function viewFromHash(hash: string): View | undefined {
  const name = hash.replace(/^#\/?/, '');
  return name === 'map' || name === 'timeline' || name === 'graph' ? name : undefined;
}

interface Notice {
  id: number;
  tone: 'ok' | 'warn';
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export interface MountOptions {
  /** Defaults to a store backed by this browser's localStorage. */
  store?: TimelineStore;
  /** Window used for routing, shortcuts, cross-tab sync and the extension bridge. */
  target?: Window;
}

/** Renders Traceback into `root`. Returns a function that removes it and every listener. */
export function mountApp(root: HTMLElement, options: MountOptions = {}): () => void {
  const store = options.store ?? new TimelineStore();
  const target = options.target ?? window;
  const doc = root.ownerDocument;

  const shell = doc.createElement('div');
  shell.className = 'tb-app';
  const toasts = doc.createElement('div');
  toasts.className = 'toasts';
  toasts.setAttribute('role', 'region');
  toasts.setAttribute('aria-label', 'Notifications');
  toasts.setAttribute('aria-live', 'polite');
  root.replaceChildren(shell, toasts);

  const state = {
    view: viewFromHash(target.location.hash) ?? DEFAULT_VIEW,
    search: '',
    selectedId: undefined as string | undefined,
    timelineType: 'all' as EntryType | 'all',
    mapFilter: 'live' as TraceFilter,
    showClosed: false,
    graphTransform: undefined as GraphTransform | undefined,
    drawerEntering: false,
    /** Where focus goes back to when the trace map drawer closes. */
    drawerOpener: undefined as string | undefined,
    theme: readTheme() as Theme,
  };
  const notices: Notice[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let noticeSeq = 0;
  let disposed = false;
  let pendingFocus: string | undefined;
  let graph: GraphController | undefined;
  let hoveredEvidence: string | undefined;

  const dialogs = createDialogs(root, {
    store,
    onSaved(entry, mode) {
      state.selectedId = entry.id;
      if (mode === 'create') {
        const decision = entry.type === 'decision';
        notify(
          'ok',
          `Saved “${entry.title}”.`,
          decision ? 'Next: connect the evidence behind it.' : 'Next: connect it to the decision it is about.',
          { label: decision ? 'Connect evidence' : 'Connect', run: () => connect(entry.id) },
        );
      }
      render();
      renderNotices();
    },
    onChanged(message) {
      if (message) notify('ok', message);
      render();
      renderNotices();
    },
    restoreFocus(key) {
      if (key) focusKey(key);
    },
  });

  // ── Notices ────────────────────────────────────────────────────────────

  function notify(tone: Notice['tone'], title: string, detail?: string, action?: Notice['action']): void {
    const notice: Notice = { id: ++noticeSeq, tone, title, ...(detail ? { detail } : {}), ...(action ? { action } : {}) };
    notices.unshift(notice);
    notices.splice(3);
    if (tone === 'ok') {
      const timer = setTimeout(() => {
        timers.delete(timer);
        dismiss(notice.id);
      }, action ? 10_000 : 6_000);
      timers.add(timer);
    }
  }

  function dismiss(id: number): void {
    const position = notices.findIndex((notice) => notice.id === id);
    if (position === -1) return;
    notices.splice(position, 1);
    renderNotices();
  }

  function renderNotices(): void {
    if (disposed) return;
    toasts.innerHTML = notices
      .map(
        (notice) => `<div class="toast${notice.tone === 'warn' ? ' is-warning' : ''}"><span class="toast-icon" aria-hidden="true">${notice.tone === 'warn' ? '!' : '✓'}</span><div class="toast-text"><strong>${escapeHtml(notice.title)}</strong>${notice.detail ? `<small>${escapeHtml(notice.detail)}</small>` : ''}</div>${notice.action ? `<button type="button" class="toast-action" data-notice-action="${notice.id}">${escapeHtml(notice.action.label)}</button>` : ''}<button type="button" class="toast-close" data-dismiss="${notice.id}" aria-label="Dismiss">${icon('close', 14)}</button></div>`,
      )
      .join('');
  }

  /** Runs a store change and turns a failure into a visible notice instead of a console error. */
  function attempt<T>(action: () => T): T | undefined {
    try {
      return action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify('warn', error instanceof StorageFullError ? 'Could not save' : 'That did not work', message);
      renderNotices();
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

  // ── Browser captures ───────────────────────────────────────────────────

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
        'Find it under “Not connected yet” in the trace map and connect it to a decision.',
      );
    }
    render();
    renderNotices();
    return stored;
  }

  // ── Routing and selection ──────────────────────────────────────────────

  function setView(view: View): void {
    if (state.view === view) return;
    state.view = view;
    if (target.location.hash !== VIEWS[view].hash) target.history.pushState(null, '', VIEWS[view].hash);
    render();
  }

  function select(id: string | undefined): void {
    const opening = state.view === 'map' && Boolean(id) && !state.selectedId;
    if (opening) {
      state.drawerOpener = activeFocusKey();
      state.drawerEntering = true;
    }
    state.selectedId = id;
    if (state.view === 'map' && id) pendingFocus = 'inspector-title';
    render();
  }

  function closeSelection(): void {
    if (!state.selectedId) return;
    state.selectedId = undefined;
    if (state.view === 'map') pendingFocus = state.drawerOpener;
    state.drawerOpener = undefined;
    render();
  }

  // ── Focus ──────────────────────────────────────────────────────────────

  function activeFocusKey(): string | undefined {
    const active = doc.activeElement;
    return active && shell.contains(active) ? active.getAttribute('data-focus') ?? undefined : undefined;
  }

  function focusKey(key: string, selection?: { start: number | null; end: number | null }): boolean {
    const element = [...shell.querySelectorAll<HTMLElement>('[data-focus]')].find((candidate) => candidate.getAttribute('data-focus') === key);
    if (!element) return false;
    try {
      element.focus({ preventScroll: true });
    } catch {
      return false;
    }
    if (selection && selection.start !== null && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      element.setSelectionRange(selection.start, selection.end);
    }
    return true;
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function render(): void {
    if (disposed) return;
    const active = doc.activeElement;
    const keep = pendingFocus
      ? { key: pendingFocus, start: null, end: null }
      : active && shell.contains(active) && active.getAttribute('data-focus')
        ? {
            key: active.getAttribute('data-focus')!,
            start: active instanceof HTMLInputElement ? active.selectionStart : null,
            end: active instanceof HTMLInputElement ? active.selectionEnd : null,
          }
        : undefined;
    pendingFocus = undefined;

    const index = store.index();
    const empty = index.workspace.entries.length === 0;
    if (state.selectedId && !index.byId.has(state.selectedId)) state.selectedId = undefined;
    const selected = state.selectedId ? index.byId.get(state.selectedId) : undefined;
    const examples = index.workspace.entries.some((entry) => entry.origin === 'example');

    let content: string;
    let rendered: ReturnType<typeof renderGraph> | undefined;
    if (empty) content = onboardingHtml();
    else if (state.view === 'map') {
      content = traceMapHtml(index, { filter: state.mapFilter, showClosed: state.showClosed, search: state.search, selectedId: state.selectedId });
    } else if (state.view === 'timeline') {
      content = timelineHtml(index, { type: state.timelineType, search: state.search, selectedId: state.selectedId });
    } else {
      rendered = renderGraph(index, { search: state.search, selectedId: state.selectedId });
      content = rendered.html;
    }
    const drawer =
      !empty && state.view === 'map' && selected
        ? `<aside class="drawer${state.drawerEntering ? ' is-entering' : ''}" aria-label="Details">${inspectorHtml(index, selected, { drawer: true })}</aside>`
        : '';
    state.drawerEntering = false;
    hoveredEvidence = undefined;

    shell.innerHTML = `<div class="shell view-is-${state.view}${empty ? ' is-empty' : ''}">
      ${sidebarHtml(empty)}
      <main class="main" id="main">
        ${examples ? '<div class="example-banner"><span>You are looking at the example workspace: the real decision log behind Traceback itself.</span><button type="button" class="link-button" data-action="remove-examples" data-focus="remove-examples">Remove example data</button></div>' : ''}
        ${content}
      </main>
      ${drawer}
    </div>`;

    graph = rendered
      ? attachGraph(shell, {
          neighbours: rendered.model.neighbours,
          ...(rendered.bounds ? { bounds: rendered.bounds } : {}),
          ...(state.graphTransform ? { transform: state.graphTransform } : {}),
          onTransform: (transform) => {
            state.graphTransform = transform;
          },
          onBackgroundClick: () => closeSelection(),
        })
      : undefined;

    if (keep) focusKey(keep.key, keep);
  }

  function sidebarHtml(empty: boolean): string {
    const persistent = store.loadReport.persistent;
    const nav = VIEW_ORDER.map((view) => {
      const on = state.view === view;
      const { label, key, hash } = VIEWS[view];
      return `<a href="${hash}" class="nav-item${on ? ' on' : ''}" data-action="view" data-view="${view}" data-focus="nav:${view}" title="${label} (keyboard shortcut: ${key.toUpperCase()})"${on ? ' aria-current="page"' : ''}>${icon(VIEWS[view].icon, 16)}<span>${label}</span><kbd aria-hidden="true">${key.toUpperCase()}</kbd></a>`;
    }).join('');
    return `<aside class="sidebar">
      <div class="brand"><span class="brand-mark">${icon('bolt', 17)}</span><span>traceback</span></div>
      <div class="side-search">
        <label class="search-box" title="Search (keyboard shortcut: /)">${icon('search', 15)}<span class="visually-hidden">Search entries</span><input id="search" type="search" data-focus="search" value="${escapeHtml(state.search)}" placeholder="Search…" autocomplete="off" spellcheck="false" /><kbd aria-hidden="true">/</kbd></label>
        <p class="search-hint">Try <code>#tag</code>, <code>type:note</code> or <code>is:unsupported</code></p>
      </div>
      <button type="button" class="primary side-capture" data-action="new-entry" data-focus="capture" title="Capture a source, note, command, file change or decision (keyboard shortcut: N)">${icon('plus', 15)}<span>New entry</span><kbd aria-hidden="true">N</kbd></button>
      <nav class="side-nav" aria-label="Views">${nav}<button type="button" class="nav-item nav-help" data-action="help" data-focus="help" title="How Traceback works (keyboard shortcut: ?)">${icon('help', 16)}<span>How it works</span><kbd aria-hidden="true">?</kbd></button></nav>
      <div class="side-foot">
        <div class="theme-switch" role="group" aria-label="Colour theme">${themeSwitchHtml()}</div>
        <div class="backup-actions"><button type="button" class="link-button" data-action="export-backup" data-focus="export-backup"${empty ? ' disabled' : ''}>Export backup</button><label class="link-button">Import backup<input type="file" data-change="import" accept="application/json,.json" hidden /></label></div>
        <div class="storage-status"><span class="status-dot${persistent ? '' : ' is-off'}"></span>${persistent ? 'Stored locally' : 'Not saved: storage blocked'} <small>· private by default</small></div>
      </div>
    </aside>`;
  }

  function themeSwitchHtml(): string {
    const options: Array<{ value: Theme; label: string; glyph: IconName }> = [
      { value: 'system', label: 'Match system', glyph: 'monitor' },
      { value: 'dark', label: 'Dark', glyph: 'moon' },
      { value: 'light', label: 'Light', glyph: 'sun' },
    ];
    return options
      .map(({ value, label, glyph }) => {
        const on = state.theme === value;
        return `<button type="button" class="theme-option${on ? ' on' : ''}" data-action="theme" data-theme-value="${value}" data-focus="theme:${value}" aria-pressed="${on}" aria-label="${label}" title="${label}">${icon(glyph, 14)}</button>`;
      })
      .join('');
  }

  function onboardingHtml(): string {
    return `<section class="onboarding" aria-labelledby="view-title">
      <div class="onboarding-mark">${icon('bolt', 26)}</div>
      <h1 id="view-title">Your trail is empty</h1>
      <p class="lead">Traceback keeps the evidence behind your decisions connected, so months later you can still answer “why did we do it this way?”</p>
      <ol class="loop">
        <li><b>1</b><div><strong>Capture evidence</strong><p>Save a source, note, command or file change while you work.</p></div></li>
        <li><b>2</b><div><strong>Record the decision</strong><p>Say what you chose and why it mattered.</p></div></li>
        <li><b>3</b><div><strong>Connect the why</strong><p>Link each piece of evidence as support for the decision, or as a challenge to it.</p></div></li>
      </ol>
      <div class="onboarding-actions"><button type="button" class="primary" data-action="new-entry" data-focus="first-entry">Capture your first entry</button><button type="button" class="secondary" data-action="load-example" data-focus="load-example">Explore an example workspace</button></div>
      <p class="muted">The example is the real decision log behind Traceback itself. You can remove it in one click.</p>
    </section>`;
  }

  // ── Actions ────────────────────────────────────────────────────────────

  function handleAction(element: HTMLElement | SVGElement, event: Event): void {
    const action = element.getAttribute('data-action');
    const id = element.getAttribute('data-id') ?? undefined;
    switch (action) {
      case 'view': {
        event.preventDefault();
        const view = element.getAttribute('data-view');
        if (view === 'map' || view === 'timeline' || view === 'graph') setView(view);
        break;
      }
      case 'new-entry': {
        const type = element.getAttribute('data-type');
        dialogs.openEntry(isEntryType(type) ? { type } : {});
        break;
      }
      case 'select':
        if (id && id !== state.selectedId) select(id);
        break;
      case 'close-drawer':
        closeSelection();
        break;
      case 'map-filter': {
        const filter = element.getAttribute('data-filter');
        if ((TRACE_FILTERS as readonly string[]).includes(filter ?? '')) {
          state.mapFilter = filter as TraceFilter;
          render();
        }
        break;
      }
      case 'toggle-closed':
        state.showClosed = !state.showClosed;
        render();
        break;
      case 'reset-map':
        state.mapFilter = 'live';
        state.search = '';
        render();
        break;
      case 'timeline-type': {
        const type = element.getAttribute('data-type');
        if (type === 'all' || isEntryType(type)) {
          state.timelineType = type;
          render();
        }
        break;
      }
      case 'edit': {
        const entry = id ? store.get(id) : undefined;
        if (entry) dialogs.openEntry({ entry });
        break;
      }
      case 'delete':
        if (id) deleteEntry(id);
        break;
      case 'link':
        if (id) connect(id);
        break;
      case 'set-status': {
        const status = element.getAttribute('data-status');
        const entry = id ? store.get(id) : undefined;
        if (entry && isDecisionStatus(status) && status !== entry.status && attempt(() => store.updateEntry(entry.id, { status }))) render();
        break;
      }
      case 'help':
        dialogs.openHelp();
        break;
      case 'unlink': {
        const decision = element.getAttribute('data-decision');
        const evidence = element.getAttribute('data-evidence');
        if (decision && evidence && attempt(() => store.unlinkEvidence(decision, evidence))) render();
        break;
      }
      case 'flip': {
        const decision = element.getAttribute('data-decision');
        const evidence = element.getAttribute('data-evidence');
        const kind = element.getAttribute('data-kind');
        if (decision && evidence && isLinkKind(kind) && attempt(() => store.linkEvidence(decision, evidence, kind))) render();
        break;
      }
      case 'supersede':
        if (id && !dialogs.openSupersede(id)) {
          notify('warn', 'No other decision can replace this one.', 'Record the decision that replaced it first.', {
            label: 'Record a decision',
            run: () => dialogs.openEntry({ type: 'decision' }),
          });
          renderNotices();
        }
        break;
      case 'export': {
        const format = element.getAttribute('data-format');
        if (id && (format === 'md' || format === 'json')) downloadBundle(id, format);
        break;
      }
      case 'export-backup':
        download(workspaceToJson(store.workspace), exportFilename('workspace', 'json'), 'application/json');
        break;
      case 'load-example': {
        const added = attempt(() => store.loadExample());
        if (added === undefined) break;
        state.selectedId = undefined;
        state.graphTransform = undefined;
        state.view = 'map';
        if (target.location.hash !== VIEWS.map.hash) target.history.pushState(null, '', VIEWS.map.hash);
        render();
        break;
      }
      case 'remove-examples': {
        const removed = attempt(() => store.removeExamples());
        if (!removed) break;
        state.selectedId = undefined;
        state.graphTransform = undefined;
        notify('ok', `Removed ${plural(removed, 'example entry', 'example entries')}.`);
        render();
        renderNotices();
        break;
      }
      case 'zoom-in':
        graph?.zoomBy(1.25);
        break;
      case 'zoom-out':
        graph?.zoomBy(0.8);
        break;
      case 'zoom-fit':
        graph?.fit();
        break;
      case 'theme': {
        const value = element.getAttribute('data-theme-value');
        if (isTheme(value) && value !== state.theme) {
          state.theme = value;
          saveTheme(value);
          applyTheme(doc.documentElement, value);
          render();
        }
        break;
      }
    }
  }

  /** Opens the connect dialog for an entry, or explains why there is nothing to connect yet. */
  function connect(id: string): void {
    if (dialogs.openLink(id)) return;
    const entry = store.get(id);
    const decision = entry?.type === 'decision';
    notify(
      'warn',
      'Nothing to connect yet.',
      decision
        ? 'Add some evidence first: a source, note, command or file change. Then connect it here.'
        : 'Record a decision first. Then connect this evidence to it.',
      { label: decision ? 'Add evidence' : 'Record a decision', run: () => dialogs.openEntry(decision ? { type: 'source' } : { type: 'decision' }) },
    );
    renderNotices();
  }

  function deleteEntry(id: string): void {
    const entry = store.get(id);
    if (!entry) return;
    const deleted = attempt(() => store.deleteEntry(id));
    if (!deleted) return;
    if (state.selectedId === id) {
      state.selectedId = undefined;
      if (state.view === 'map') pendingFocus = state.drawerOpener;
    }
    notify(
      'ok',
      `Deleted “${entry.title}”.`,
      deleted.links.length ? `${plural(deleted.links.length, 'connection')} went with it.` : undefined,
      {
        label: 'Undo',
        run: () => {
          const restored = attempt(() => {
            store.restoreDeleted(deleted);
            return true;
          });
          if (restored) {
            state.selectedId = deleted.entry.id;
            render();
          }
        },
      },
    );
    render();
    renderNotices();
  }

  function downloadBundle(id: string, format: 'md' | 'json'): void {
    const bundle = attempt(() => buildDecisionBundle(store.index(), id));
    if (!bundle) return;
    const content = format === 'md' ? bundleToMarkdown(bundle) : bundleToJson(bundle);
    download(content, exportFilename(bundle.decision.title, format), format === 'md' ? 'text/markdown' : 'application/json');
  }

  function download(content: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
    const link = doc.createElement('a');
    link.href = url;
    link.download = filename;
    doc.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function importBackup(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    const report = attempt(() => store.importWorkspace(text, 'merge'));
    if (!report) return;
    state.graphTransform = undefined;
    notify(
      report.issues.length ? 'warn' : 'ok',
      `Imported ${report.added} new and ${report.updated} updated entries.`,
      report.issues.length ? `${plural(report.issues.length, 'record')} needed repair or were skipped: ${report.issues[0]}` : undefined,
    );
    render();
    renderNotices();
  }

  // ── Listeners ──────────────────────────────────────────────────────────

  const onClick = (event: MouseEvent) => {
    const origin = event.target as Element;
    const element = origin.closest<HTMLElement>('[data-action]');
    if (!element || !shell.contains(element)) return;
    // Let links inside cards open normally instead of selecting the card.
    if (origin.closest('a[href]') && element.getAttribute('data-action') !== 'view') return;
    handleAction(element, event);
  };
  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'search') return;
    state.search = input.value;
    render();
  };
  const onChange = (event: Event) => {
    const element = event.target as HTMLElement;
    const kind = element.getAttribute('data-change');
    if (kind === 'import') {
      void importBackup(element as HTMLInputElement);
    }
  };
  const onPointerOver = (event: PointerEvent) => {
    const chip = (event.target as Element).closest<HTMLElement>('[data-ev]');
    const id = chip?.getAttribute('data-ev') ?? undefined;
    if (id === hoveredEvidence) return;
    shell.querySelectorAll('.is-related').forEach((element) => element.classList.remove('is-related'));
    hoveredEvidence = id;
    if (id) shell.querySelectorAll(`[data-ev="${id}"]`).forEach((element) => element.classList.add('is-related'));
  };
  const onToastClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-dismiss], [data-notice-action]');
    if (!button) return;
    const id = Number(button.getAttribute('data-dismiss') ?? button.getAttribute('data-notice-action'));
    const notice = notices.find((candidate) => candidate.id === id);
    dismiss(id);
    if (button.hasAttribute('data-notice-action')) notice?.action?.run();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (doc.querySelector('dialog[open]')) return;
    const element = event.target as HTMLElement;
    const typing = Boolean(element.closest?.('input, textarea, select, [contenteditable="true"]'));
    if (event.key === 'Escape') {
      if (element.id === 'search') {
        if (!(element as HTMLInputElement).value) element.blur();
        return;
      }
      if (state.selectedId) {
        event.preventDefault();
        closeSelection();
      }
      return;
    }
    if (typing) return;
    if ((event.key === 'Enter' || event.key === ' ') && element.matches?.('g[role="button"][data-action]')) {
      event.preventDefault();
      handleAction(element, event);
      return;
    }
    switch (event.key.toLowerCase()) {
      case 't':
        setView('timeline');
        break;
      case 'm':
        setView('map');
        break;
      case 'g':
        setView('graph');
        break;
      case 'n':
        dialogs.openEntry();
        break;
      case '/':
        focusKey('search');
        break;
      case '?':
        dialogs.openHelp();
        break;
      case '+':
      case '=':
        if (!graph) return;
        graph.zoomBy(1.25);
        break;
      case '-':
        if (!graph) return;
        graph.zoomBy(0.8);
        break;
      case '0':
        if (!graph) return;
        graph.fit();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const onRoute = () => {
    const view = viewFromHash(target.location.hash);
    if (view && view !== state.view) {
      state.view = view;
      render();
    }
  };

  shell.addEventListener('click', onClick);
  shell.addEventListener('input', onInput);
  shell.addEventListener('change', onChange);
  shell.addEventListener('pointerover', onPointerOver);
  toasts.addEventListener('click', onToastClick);
  doc.addEventListener('keydown', onKeyDown);
  target.addEventListener('popstate', onRoute);
  target.addEventListener('hashchange', onRoute);
  const onThemeStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    const next = readTheme();
    if (next === state.theme) return;
    state.theme = next;
    applyTheme(doc.documentElement, next);
    render();
  };
  target.addEventListener('storage', onThemeStorage);

  const unsubscribe = store.subscribe((reason) => {
    if (reason === 'external') render();
  });
  const stopSync = store.connect(target);
  const stopBridge = connectExtensionBridge({ target, onCaptures: receiveCaptures });

  applyTheme(doc.documentElement, state.theme);
  if (target.location.hash !== VIEWS[state.view].hash) target.history.replaceState(null, '', VIEWS[state.view].hash);
  render();
  renderNotices();

  return () => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    shell.removeEventListener('click', onClick);
    shell.removeEventListener('input', onInput);
    shell.removeEventListener('change', onChange);
    shell.removeEventListener('pointerover', onPointerOver);
    toasts.removeEventListener('click', onToastClick);
    doc.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('popstate', onRoute);
    target.removeEventListener('hashchange', onRoute);
    target.removeEventListener('storage', onThemeStorage);
    applyTheme(doc.documentElement, 'system');
    unsubscribe();
    stopSync();
    stopBridge();
    dialogs.dispose();
    root.replaceChildren();
  };
}
