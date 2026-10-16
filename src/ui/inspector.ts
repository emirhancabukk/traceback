import { DECISION_STATUSES, STATUS_LABELS, typeLabel, type Entry, type LinkKind } from '../core/model';
import { decisionsFor, evidenceFor, type Connected, type WorkspaceIndex } from '../core/query';
import { REPLACED_HINT, escapeHtml, formatDateTime, plural } from './format';
import { icon, typeIcon } from './icons';

export interface InspectorOptions {
  /** Rendered in the trace map's drawer, with a close button. */
  drawer?: boolean;
  /** Text shown when nothing is selected. */
  empty?: string;
}

const ORIGIN_NOTES: Partial<Record<Entry['origin'], string>> = {
  browser: 'Captured from the browser',
  import: 'Imported from a backup',
  example: 'Example data',
};

export function inspectorHtml(index: WorkspaceIndex, entry: Entry | undefined, options: InspectorOptions = {}): string {
  if (!entry) {
    return `<div class="inspector-empty">${escapeHtml(options.empty ?? 'Select an entry to see how it connects.')}</div>`;
  }
  return entry.type === 'decision' ? decisionHtml(index, entry, options) : evidenceHtml(index, entry, options);
}

function head(eyebrow: string, entry: Entry, options: InspectorOptions): string {
  const close = options.drawer
    ? `<button type="button" class="icon-button" data-action="close-drawer" data-focus="drawer-close" aria-label="Close details">${icon('close', 18)}</button>`
    : '';
  return `<div class="inspector-head"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2 tabindex="-1" data-focus="inspector-title">${escapeHtml(entry.title)}</h2></div>${close}</div>`;
}

function extras(entry: Entry): string {
  const url = entry.url
    ? `<a class="entry-url" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeHtml(entry.url)}</a>`
    : '';
  const tags = entry.tags.length ? `<div class="tags">${entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  return url || tags ? `<div class="inspector-extras">${url}${tags}</div>` : '';
}

function entryButton(entry: Entry, strike = false): string {
  const title = escapeHtml(entry.title);
  return `<button type="button" class="link-inline" data-action="select" data-id="${entry.id}">${strike ? `<s>${title}</s>` : title}</button>`;
}

/** One connected entry, with buttons to open it, flip the relation or disconnect it. */
function linkedItem(decisionId: string, evidenceId: string, shown: Entry, kind: LinkKind): string {
  const other: LinkKind = kind === 'supports' ? 'challenges' : 'supports';
  const flipLabel = other === 'supports' ? 'Count as support instead' : 'Count as a challenge instead';
  const title = escapeHtml(shown.title);
  return `<li class="evidence-item relation-${kind}">
    <button type="button" class="evidence-open" data-action="select" data-id="${shown.id}" data-focus="item:${shown.id}"><span class="mini-icon type-${shown.type}">${typeIcon(shown.type, 12)}</span><span class="evidence-text"><strong>${title}</strong><small>${typeLabel(shown.type)} · ${formatDateTime(shown.createdAt)}</small></span></button>
    <button type="button" class="mini-action" data-action="flip" data-decision="${decisionId}" data-evidence="${evidenceId}" data-kind="${other}" title="${flipLabel}" aria-label="${flipLabel}: ${title}">${icon('swap', 14)}</button>
    <button type="button" class="mini-action is-danger" data-action="unlink" data-decision="${decisionId}" data-evidence="${evidenceId}" title="Disconnect" aria-label="Disconnect ${title}">${icon('close', 14)}</button>
  </li>`;
}

function section(label: string, items: string[], tone: 'support' | 'challenge'): string {
  return `<div class="bundle-label is-${tone}"><span>${label}</span><b>${items.length}</b></div><ul class="evidence-list">${items.join('')}</ul>`;
}

function decisionHtml(index: WorkspaceIndex, decision: Entry, options: InspectorOptions): string {
  const status = decision.status ?? 'accepted';
  const evidence = evidenceFor(index, decision.id);
  const supports = evidence.filter(({ link }) => link.kind === 'supports');
  const challenges = evidence.filter(({ link }) => link.kind === 'challenges');
  const replacement = decision.supersededBy ? index.byId.get(decision.supersededBy) : undefined;
  const replaces = index.workspace.entries.filter((entry) => entry.supersededBy === decision.id);
  const statuses = DECISION_STATUSES.filter((option) => option !== 'superseded' || status === 'superseded');
  const item = ({ entry, link }: Connected) => linkedItem(decision.id, entry.id, entry, link.kind);
  const total = supports.length + challenges.length;

  return `${head('DECISION', decision, options)}
    <div class="inspector-meta"><span class="pill status-${status}">${STATUS_LABELS[status]}</span><time datetime="${decision.createdAt}">${formatDateTime(decision.createdAt)}</time>${ORIGIN_NOTES[decision.origin] ? `<span>${ORIGIN_NOTES[decision.origin]}</span>` : ''}</div>
    <div class="field-inline"><span>Status</span><div class="segmented" role="group" aria-label="Status">${statuses.map((option) => `<button type="button" class="seg-option status-${option}${option === status ? ' on' : ''}" data-action="set-status" data-id="${decision.id}" data-status="${option}" data-focus="status:${option}" aria-pressed="${option === status}">${STATUS_LABELS[option]}</button>`).join('')}</div></div>
    ${replacement ? `<p class="relation-line" title="${REPLACED_HINT}">Replaced by ${entryButton(replacement)}</p>` : ''}
    ${replaces.map((old) => `<p class="relation-line" title="${REPLACED_HINT}">Replaces ${entryButton(old, true)}</p>`).join('')}
    <div class="inspector-body">${decision.body ? escapeHtml(decision.body) : '<span class="muted">No rationale recorded yet. Edit the decision to say why.</span>'}</div>
    ${extras(decision)}
    <p class="eyebrow">EVIDENCE BALANCE</p>
    <div class="balance is-large" aria-hidden="true">${total ? `<span class="s" style="flex:${supports.length}"></span><span class="c" style="flex:${challenges.length}"></span>` : ''}</div>
    <div class="balance-legend"><span>${supports.length} support</span><span>${plural(challenges.length, 'challenge')}</span></div>
    ${section('Supporting evidence', supports.map(item), 'support')}
    ${supports.length ? '' : '<p class="muted">Nothing supports this yet. Connect the sources, notes or results that led to it.</p>'}
    ${challenges.length ? section('Challenging evidence', challenges.map(item), 'challenge') : ''}
    <button type="button" class="secondary full" data-action="link" data-id="${decision.id}" data-focus="inspector-link">${icon('link', 15)} Connect evidence</button>
    <div class="inspector-actions">
      <button type="button" class="ghost" data-action="edit" data-id="${decision.id}" data-focus="inspector-edit">${icon('edit', 14)} Edit</button>
      <button type="button" class="ghost" data-action="supersede" data-id="${decision.id}" data-focus="inspector-supersede">${icon('replace', 14)} ${replacement ? 'Change replacement' : 'Mark as replaced'}</button>
      <button type="button" class="ghost is-danger" data-action="delete" data-id="${decision.id}" data-focus="inspector-delete">${icon('trash', 14)} Delete</button>
    </div>
    <div class="export-actions"><button type="button" class="export" data-action="export" data-format="md" data-id="${decision.id}">${icon('download', 13)} Markdown</button><button type="button" class="export" data-action="export" data-format="json" data-id="${decision.id}">${icon('download', 13)} JSON</button></div>`;
}

function evidenceHtml(index: WorkspaceIndex, entry: Entry, options: InspectorOptions): string {
  const decisions = decisionsFor(index, entry.id);
  const supports = decisions.filter(({ link }) => link.kind === 'supports');
  const challenges = decisions.filter(({ link }) => link.kind === 'challenges');
  const item = ({ entry: decision, link }: Connected) => linkedItem(decision.id, entry.id, decision, link.kind);

  return `${head(typeLabel(entry.type).toUpperCase(), entry, options)}
    <div class="inspector-meta"><span class="pill pill-${entry.type}">${typeLabel(entry.type)}</span><time datetime="${entry.createdAt}">${formatDateTime(entry.createdAt)}</time>${ORIGIN_NOTES[entry.origin] ? `<span>${ORIGIN_NOTES[entry.origin]}</span>` : ''}</div>
    ${entry.quote ? `<blockquote class="inspector-quote">${escapeHtml(entry.quote)}</blockquote>` : ''}
    ${entry.body ? `<div class="inspector-body">${escapeHtml(entry.body)}</div>` : ''}
    ${extras(entry)}
    ${supports.length ? section('Supports', supports.map(item), 'support') : ''}
    ${challenges.length ? section('Challenges', challenges.map(item), 'challenge') : ''}
    ${decisions.length ? '' : '<p class="muted">Not connected to a decision yet, so the trace map cannot show why it matters.</p>'}
    <button type="button" class="secondary full" data-action="link" data-id="${entry.id}" data-focus="inspector-link">${icon('link', 15)} Connect to a decision</button>
    <div class="inspector-actions">
      <button type="button" class="ghost" data-action="edit" data-id="${entry.id}" data-focus="inspector-edit">${icon('edit', 14)} Edit</button>
      <button type="button" class="ghost is-danger" data-action="delete" data-id="${entry.id}" data-focus="inspector-delete">${icon('trash', 14)} Delete</button>
    </div>`;
}
