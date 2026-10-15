import { ENTRY_TYPES, STATUS_LABELS, typeLabel, type Entry, type EntryType } from '../core/model';
import { decisionsFor, searchEntries, workspaceStats, type WorkspaceIndex } from '../core/query';
import { escapeHtml, formatDateTime } from './format';
import { icon, typeIcon } from './icons';
import { inspectorHtml } from './inspector';

export interface TimelineViewState {
  type: EntryType | 'all';
  search: string;
  selectedId?: string;
}

export function timelineHtml(index: WorkspaceIndex, state: TimelineViewState): string {
  const stats = workspaceStats(index);
  const entries = searchEntries(index, state.search, state.type);
  const selected = state.selectedId ? index.byId.get(state.selectedId) : undefined;
  const chips = [
    { key: 'all' as const, label: 'All activity', count: stats.total },
    ...ENTRY_TYPES.map((type) => ({ key: type, label: typeLabel(type, true), count: stats.byType[type] })),
  ]
    .map(({ key, label, count }) => {
      const on = state.type === key;
      return `<button type="button" class="chip${on ? ' on' : ''}" data-action="timeline-type" data-type="${key}" data-focus="type:${key}" aria-pressed="${on}">${label}<span class="chip-count">${count}</span></button>`;
    })
    .join('');

  return `<section class="view view-timeline" aria-labelledby="view-title">
    <header class="view-head">
      <div><p class="eyebrow">WORKSPACE / PERSONAL</p><h1 id="view-title">Timeline</h1><p class="sub">Everything you captured, newest first.</p></div>
      <div class="summary">
        <div class="stat"><b>${stats.total}</b><small>total entries</small></div>
        <div class="stat"><b>${stats.decisions}</b><small>${stats.unsupported.length ? `decisions · ${stats.unsupported.length} without support` : 'decisions'}</small></div>
        <div class="stat"><b class="is-accent">${stats.linkedEvidence}/${stats.evidence}</b><small>evidence connected</small></div>
      </div>
    </header>
    <div class="chip-row" role="toolbar" aria-label="Filter by type">${chips}<span class="spacer"></span><span class="result-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span></div>
    <div class="content-grid">
      <ol class="timeline">${entries.length ? entries.map((entry) => card(index, entry, entry.id === selected?.id)).join('') : `<li class="empty-state"><div class="empty-icon">${icon('search', 34)}</div><h2>No matching entries</h2><p>Try a different search or capture something new.</p></li>`}</ol>
      <aside class="inspector" aria-label="Details">${inspectorHtml(index, selected, { empty: 'Select an entry to see its details and what it connects to.' })}</aside>
    </div>
  </section>`;
}

function card(index: WorkspaceIndex, entry: Entry, selected: boolean): string {
  const links = decisionsFor(index, entry.id);
  const supports = links.filter(({ link }) => link.kind === 'supports').length;
  const challenges = links.length - supports;
  const linked = [
    supports ? `↳ supports ${supports} decision${supports === 1 ? '' : 's'}` : '',
    challenges ? `↳ challenges ${challenges}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<li class="entry${selected ? ' selected' : ''}${entry.type === 'decision' ? ' is-decision' : ''}" data-action="select" data-id="${entry.id}">
    <div class="entry-rail"><span class="type-icon type-${entry.type}">${typeIcon(entry.type, 15)}</span><span class="line"></span></div>
    <div class="entry-main">
      <div class="entry-meta"><span class="pill pill-${entry.type}">${typeLabel(entry.type)}</span>${entry.status ? `<span class="pill status-${entry.status}">${STATUS_LABELS[entry.status]}</span>` : ''}<time datetime="${entry.createdAt}">${formatDateTime(entry.createdAt)}</time>${linked ? `<span class="linked">${linked}</span>` : ''}</div>
      <h3><button type="button" class="entry-open" data-action="select" data-id="${entry.id}" data-focus="entry:${entry.id}" aria-pressed="${selected}">${escapeHtml(entry.title)}</button></h3>
      ${entry.quote ? `<blockquote>${escapeHtml(entry.quote)}</blockquote>` : ''}
      ${entry.body ? `<p class="entry-body">${escapeHtml(entry.body)}</p>` : ''}
      ${entry.url ? `<a class="entry-url" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeHtml(entry.url)}</a>` : ''}
      ${entry.tags.length ? `<div class="tags">${entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    </div>
  </li>`;
}
