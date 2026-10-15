import { EVIDENCE_TYPES, STATUS_LABELS, typeLabel, type Entry } from '../core/model';
import type { WorkspaceIndex } from '../core/query';
import { TRACE_FILTERS, buildTraceMap, type TraceFilter, type TraceMap, type TraceRow } from '../core/tracemap';
import { REPLACED_HINT, escapeHtml, formatShort, plural } from './format';
import { icon, typeIcon } from './icons';

/** Chip height and vertical pitch. Connectors are computed from these, so the CSS must match. */
const CHIP = 36;
const SLOT = 44;
const FLOW_WIDTH = 70;

export interface TraceMapViewState {
  filter: TraceFilter;
  showClosed: boolean;
  search: string;
  selectedId?: string;
}

export function traceMapHtml(index: WorkspaceIndex, state: TraceMapViewState): string {
  const map = buildTraceMap(index, state);
  return `<section class="view view-map" aria-labelledby="view-title">
    ${header(map)}
    ${toolbar(map, state)}
    ${content(map, state)}
  </section>`;
}

function header(map: TraceMap): string {
  const { summary } = map;
  const largest = Math.max(1, ...EVIDENCE_TYPES.map((type) => summary.evidenceByType[type]));
  const bars = EVIDENCE_TYPES.map((type) => {
    const count = summary.evidenceByType[type];
    const height = count ? Math.max(14, Math.round((count / largest) * 100)) : 6;
    return `<i class="type-${type}" style="height:${height}%" title="${count} ${typeLabel(type, count !== 1).toLowerCase()}"></i>`;
  }).join('');
  const described = EVIDENCE_TYPES.map((type) => {
    const count = summary.evidenceByType[type];
    return `${count} ${typeLabel(type, count !== 1).toLowerCase()}`;
  }).join(', ');
  return `<header class="view-head">
    <div><p class="eyebrow">WORKSPACE / PERSONAL</p><h1 id="view-title">Trace map</h1><p class="sub">Every current decision, with the evidence for it on the left and against it on the right.</p></div>
    <div class="summary">
      <div class="stat" title="Decisions that are proposed or accepted, not replaced or rejected"><b>${summary.liveDecisions}</b><small>current decisions</small></div>
      <div class="stat" title="Connections from evidence that supports a current decision"><b class="is-accent">${summary.supportingLinks}</b><small>reasons for</small></div>
      <div class="stat" title="Connections from evidence that argues against a current decision"><b class="is-rose">${summary.openChallenges}</b><small>reasons against</small></div>
      <div class="stat" role="img" aria-label="Evidence by type: ${described}" title="Evidence by type: ${described}"><div class="type-bars">${bars}</div><small>evidence by type</small></div>
    </div>
  </header>`;
}

function toolbar(map: TraceMap, state: TraceMapViewState): string {
  const labels: Record<TraceFilter, string> = {
    live: state.showClosed ? 'All' : 'All current',
    accepted: 'Accepted',
    proposed: 'Proposed',
    challenged: 'Challenged',
    unsupported: 'No support yet',
  };
  const hints: Record<TraceFilter, string> = {
    live: state.showClosed ? 'Every decision, including replaced and rejected ones' : 'Every decision that is proposed or accepted',
    accepted: 'Decisions you have made',
    proposed: 'Decisions that are not settled yet',
    challenged: 'At least one piece of evidence argues against it',
    unsupported: 'Nothing supports it so far',
  };
  const chips = TRACE_FILTERS.map((filter) => {
    const on = state.filter === filter;
    return `<button type="button" class="chip${on ? ' on' : ''}" data-action="map-filter" data-filter="${filter}" data-focus="filter:${filter}" aria-pressed="${on}" title="${hints[filter]}">${labels[filter]}<span class="chip-count">${map.counts[filter]}</span></button>`;
  }).join('');
  const { superseded, rejected } = map.summary;
  const closed = superseded + rejected;
  const closedLabel = superseded && rejected ? 'Show replaced and rejected' : superseded ? 'Show replaced decisions' : 'Show rejected decisions';
  const toggle = closed
    ? `<button type="button" class="chip${state.showClosed ? ' on' : ''}" data-action="toggle-closed" data-focus="toggle-closed" aria-pressed="${state.showClosed}" title="${REPLACED_HINT}">${closedLabel} (${closed})</button>`
    : '';
  const record = `<button type="button" class="secondary is-small" data-action="new-entry" data-type="decision" data-focus="map-new-decision">${icon('plus', 13)} Record a decision</button>`;
  return `<div class="chip-row" role="toolbar" aria-label="Filter decisions">${chips}<span class="spacer"></span>${toggle}${record}</div>`;
}

function content(map: TraceMap, state: TraceMapViewState): string {
  const { summary } = map;
  const hasDecisions = summary.liveDecisions + summary.superseded + summary.rejected > 0;
  let rows: string;
  if (!hasDecisions) {
    rows = `<div class="empty-state"><div class="empty-icon">${icon('map', 34)}</div><h2>No decisions yet</h2><p>Record what you chose; its evidence will line up beside it here.</p><button type="button" class="primary" data-action="new-entry" data-type="decision" data-focus="empty-decision">Record a decision</button></div>`;
  } else if (!map.rows.length) {
    rows = `<div class="empty-state"><div class="empty-icon">${icon('search', 34)}</div><h2>No decisions match</h2><p>Try another filter or clear the search.</p><button type="button" class="secondary" data-action="reset-map" data-focus="reset-map">Show all current decisions</button></div>`;
  } else {
    rows = `<div class="trace-columns" aria-hidden="true"><span class="col-supports">SUPPORTS</span><span></span><span>DECISION</span><span></span><span class="col-challenges">CHALLENGES</span></div>
      <ol class="trace-rows">${map.rows.map((row) => rowHtml(row, map, state)).join('')}</ol>`;
  }
  return `${rows}${looseHtml(map, state)}`;
}

function chip(entry: Entry, map: TraceMap, state: TraceMapViewState, focusScope: string): string {
  const shared = map.linkCounts.get(entry.id) ?? 0;
  const classes = ['chip-ev'];
  if (map.matches?.has(entry.id)) classes.push('is-match');
  if (state.selectedId === entry.id) classes.push('is-selected');
  const title = escapeHtml(entry.title);
  return `<button type="button" class="${classes.join(' ')}" data-action="select" data-id="${entry.id}" data-ev="${entry.id}" data-focus="${focusScope}:${entry.id}" title="${title}"><i class="type-${entry.type}">${typeIcon(entry.type, 12)}</i><span class="chip-title">${title}</span>${shared > 1 ? `<span class="shared" title="Connected to ${shared} decisions">×${shared}</span>` : ''}</button>`;
}

/** Curves from each evidence chip to the card edge, fanning in around the middle of the chip stack. */
function flow(count: number, height: number, side: 'supports' | 'challenges'): string {
  if (!count) return '<div class="flow" aria-hidden="true"></div>';
  const middle = height / 2;
  const paths = Array.from({ length: count }, (_, i) => {
    const y = i * SLOT + CHIP / 2;
    const end = Math.min(height - 10, Math.max(10, middle + (i - (count - 1) / 2) * 5));
    const half = FLOW_WIDTH / 2;
    return side === 'supports'
      ? `<path d="M0 ${y}C${half} ${y} ${half} ${end} ${FLOW_WIDTH} ${end}"/>`
      : `<path d="M${FLOW_WIDTH} ${y}C${half} ${y} ${half} ${end} 0 ${end}"/>`;
  }).join('');
  return `<svg class="flow is-${side}" width="${FLOW_WIDTH}" height="${height}" viewBox="0 0 ${FLOW_WIDTH} ${height}" aria-hidden="true">${paths}</svg>`;
}

function rowHtml(row: TraceRow, map: TraceMap, state: TraceMapViewState): string {
  const { decision, supports, challenges, replaces, replacedBy } = row;
  const status = decision.status ?? 'accepted';
  const slots = Math.max(supports.length, challenges.length, 2 + replaces.length + (replacedBy ? 1 : 0));
  const height = slots * SLOT - (SLOT - CHIP);
  const title = escapeHtml(decision.title);
  const cardClasses = ['trace-card', `status-${status}`];
  if (state.selectedId === decision.id) cardClasses.push('is-selected');
  if (map.matches?.has(decision.id)) cardClasses.push('is-match');
  const balance = supports.length + challenges.length
    ? `<span class="s" style="flex:${supports.length}"></span><span class="c" style="flex:${challenges.length}"></span>`
    : '';
  const replacedLines = replaces
    .map(({ entry, against }) => `<div class="trace-replaces" title="${REPLACED_HINT}">Replaces <button type="button" class="link-inline" data-action="select" data-id="${entry.id}" data-focus="replaced:${decision.id}:${entry.id}"><s>${escapeHtml(entry.title)}</s></button>${against ? ` <em>${plural(against, 'reason')} against</em>` : ''}</div>`)
    .join('');
  const replacedByLine = replacedBy
    ? `<div class="trace-replaces" title="${REPLACED_HINT}">Replaced by <button type="button" class="link-inline" data-action="select" data-id="${replacedBy.id}" data-focus="replacement:${decision.id}">${escapeHtml(replacedBy.title)}</button></div>`
    : '';

  return `<li class="trace-row${row.live ? '' : ' is-closed'}">
    <div class="trace-stack is-supports" role="group" aria-label="Evidence supporting: ${title}">${supports.length ? supports.map(({ entry }) => chip(entry, map, state, `s:${decision.id}`)).join('') : '<div class="trace-placeholder">no supporting evidence yet</div>'}</div>
    ${flow(supports.length, height, 'supports')}
    <article class="${cardClasses.join(' ')}" data-action="select" data-id="${decision.id}" style="min-height:${height}px">
      <h3><button type="button" class="card-open" data-action="select" data-id="${decision.id}" data-focus="card:${decision.id}">${title}</button></h3>
      <div class="trace-meta"><span class="pill status-${status}">${STATUS_LABELS[status]}</span><time datetime="${decision.createdAt}">${formatShort(decision.createdAt)}</time><span class="trace-tally">${supports.length} for · ${challenges.length} against</span></div>
      <div class="balance" aria-hidden="true" title="${supports.length} for, ${challenges.length} against">${balance}</div>
      ${replacedLines}${replacedByLine}
    </article>
    ${flow(challenges.length, height, 'challenges')}
    <div class="trace-stack is-challenges" role="group" aria-label="Evidence challenging: ${title}">${challenges.map(({ entry }) => chip(entry, map, state, `c:${decision.id}`)).join('')}</div>
  </li>`;
}

function looseHtml(map: TraceMap, state: TraceMapViewState): string {
  if (!map.unlinked.length) return '';
  return `<section class="trace-loose" aria-labelledby="loose-title">
    <p class="eyebrow" id="loose-title">NOT CONNECTED YET · ${map.unlinked.length}</p>
    <p class="hint">Evidence that is not connected to any decision yet. Open one to connect it.</p>
    <div class="loose-grid">${map.unlinked.map((entry) => chip(entry, map, state, 'loose')).join('')}</div>
  </section>`;
}
