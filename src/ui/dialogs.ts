import { isLiveDecision, replacementCandidates } from '../core/decisions';
import { ENTRY_TYPES, STATUS_LABELS, isLinkKind, typeLabel, type DecisionStatus, type Entry, type EntryType } from '../core/model';
import { evidenceFor, decisionsFor } from '../core/query';
import type { TimelineStore } from '../core/store';
import { escapeHtml, formatDateTime } from './format';
import { icon, typeIcon } from './icons';

/**
 * The three dialogs live outside the re-rendered app shell, so a change
 * arriving from another tab never closes a dialog or wipes what was typed.
 * Errors are shown inside the dialog, above its backdrop.
 */
export interface DialogDeps {
  store: TimelineStore;
  /** Called after an entry was created or edited. */
  onSaved(entry: Entry, mode: 'create' | 'edit'): void;
  /** Called after links or replacements changed. */
  onChanged(message?: string): void;
  /** Move focus back to the element with this `data-focus` key, if it still exists. */
  restoreFocus(key: string | undefined): void;
}

export interface EntryDialogOptions {
  type?: EntryType;
  /** Edit this entry instead of creating a new one. */
  entry?: Entry;
}

export interface Dialogs {
  openEntry(options?: EntryDialogOptions): void;
  /** Returns false when there is nothing left to connect. */
  openLink(anchorId: string): boolean;
  /** Returns false when no other decision could replace this one. */
  openSupersede(decisionId: string): boolean;
  dispose(): void;
}

const closeButton = `<button type="button" class="icon-button" data-close aria-label="Close">${icon('close', 18)}</button>`;

export function createDialogs(root: HTMLElement, deps: DialogDeps): Dialogs {
  const doc = root.ownerDocument;
  const host = doc.createElement('div');
  host.className = 'tb-dialogs';
  host.innerHTML = `
    <dialog id="entry-dialog" aria-labelledby="entry-dialog-title">
      <form id="entry-form" class="dialog-form" data-type="note" novalidate>
        <div class="dialog-head"><div><p class="eyebrow" data-role="eyebrow">NEW CAPTURE</p><h2 id="entry-dialog-title" data-role="heading">Add to your trail</h2><p class="dialog-help" data-role="help">A piece of evidence you may want later, or a decision you made.</p></div>${closeButton}</div>
        <input type="hidden" name="id" />
        <label>Type<select name="type">${ENTRY_TYPES.map((type) => `<option value="${type}">${typeLabel(type)}</option>`).join('')}</select></label>
        <label>Title<input name="title" maxlength="300" placeholder="What happened?" autocomplete="off" /></label>
        <label>Details<textarea name="body" rows="5" placeholder="Capture the useful context…"></textarea></label>
        <label class="for-decision">Status<select name="status"></select></label>
        <label class="for-quote"><span>Quote <small>optional</small></span><textarea name="quote" rows="3" placeholder="Words copied from the source"></textarea></label>
        <label><span>Link <small>optional</small></span><input name="url" type="url" inputmode="url" placeholder="https://…" autocomplete="off" /></label>
        <label><span>Tags <small>comma separated</small></span><input name="tags" placeholder="e.g. release, research" autocomplete="off" /></label>
        <p class="form-error" role="alert" data-role="error"></p>
        <button class="primary full" type="submit" data-role="submit">Save entry</button>
      </form>
    </dialog>
    <dialog id="link-dialog" aria-labelledby="link-dialog-title">
      <form id="link-form" class="dialog-form" novalidate>
        <div class="dialog-head"><div><p class="eyebrow">CONNECT EVIDENCE</p><h2 id="link-dialog-title" data-role="heading">Connect evidence to this decision</h2><p class="dialog-help" data-role="help"></p></div>${closeButton}</div>
        <div class="relation-picker" role="radiogroup" aria-label="Relation"><label><input type="radio" name="kind" value="supports" checked /> Supports</label><label><input type="radio" name="kind" value="challenges" /> Challenges</label></div>
        <label class="filter-field"><span class="visually-hidden">Filter the list</span><input type="search" data-role="filter" placeholder="Filter…" autocomplete="off" /></label>
        <div class="candidate-list" data-role="candidates"></div>
        <p class="form-error" role="alert" data-role="error"></p>
        <button class="primary full" type="submit">Connect</button>
      </form>
    </dialog>
    <dialog id="supersede-dialog" aria-labelledby="supersede-dialog-title">
      <form id="supersede-form" class="dialog-form" novalidate>
        <div class="dialog-head"><div><p class="eyebrow">REPLACE DECISION</p><h2 id="supersede-dialog-title">Which decision replaced this one?</h2><p class="dialog-help" data-role="help"></p></div>${closeButton}</div>
        <label class="filter-field"><span class="visually-hidden">Filter the list</span><input type="search" data-role="filter" placeholder="Filter…" autocomplete="off" /></label>
        <div class="candidate-list" data-role="candidates"></div>
        <p class="form-error" role="alert" data-role="error"></p>
        <div class="dialog-actions"><button type="button" class="ghost" data-role="clear" hidden>Not replaced any more</button><button class="primary" type="submit">Mark as replaced</button></div>
      </form>
    </dialog>`;
  root.append(host);

  const entryDialog = host.querySelector<HTMLDialogElement>('#entry-dialog')!;
  const entryForm = host.querySelector<HTMLFormElement>('#entry-form')!;
  const linkDialog = host.querySelector<HTMLDialogElement>('#link-dialog')!;
  const linkForm = host.querySelector<HTMLFormElement>('#link-form')!;
  const supersedeDialog = host.querySelector<HTMLDialogElement>('#supersede-dialog')!;
  const supersedeForm = host.querySelector<HTMLFormElement>('#supersede-form')!;
  const part = <T extends Element = HTMLElement>(scope: ParentNode, role: string) => scope.querySelector<T>(`[data-role="${role}"]`)!;
  const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(name: string) =>
    entryForm.elements.namedItem(name) as T;

  let returnFocus: string | undefined;
  let linkAnchor: string | undefined;
  let supersedeId: string | undefined;

  const showError = (form: HTMLFormElement, error: unknown) => {
    part(form, 'error').textContent = error instanceof Error ? error.message : String(error);
  };
  const open = (dialog: HTMLDialogElement, form: HTMLFormElement) => {
    const active = doc.activeElement as HTMLElement | null;
    returnFocus = active?.dataset?.focus;
    part(form, 'error').textContent = '';
    dialog.showModal();
  };

  host.addEventListener('click', (event) => {
    const close = (event.target as Element).closest('[data-close]');
    close?.closest('dialog')?.close();
  });
  for (const dialog of [entryDialog, linkDialog, supersedeDialog]) {
    dialog.addEventListener('close', () => deps.restoreFocus(returnFocus));
  }

  // ── Entry ──────────────────────────────────────────────────────────────
  const statusSelect = field<HTMLSelectElement>('status');
  const fillStatuses = (current: DecisionStatus) => {
    const options: DecisionStatus[] = current === 'superseded' ? ['proposed', 'accepted', 'superseded', 'rejected'] : ['proposed', 'accepted', 'rejected'];
    statusSelect.innerHTML = options.map((status) => `<option value="${status}">${STATUS_LABELS[status]}</option>`).join('');
    statusSelect.value = current;
  };
  field<HTMLSelectElement>('type').addEventListener('change', (event) => {
    entryForm.dataset.type = (event.target as HTMLSelectElement).value;
  });
  entryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(entryForm);
    const id = String(values.get('id') ?? '');
    const type = String(values.get('type')) as EntryType;
    const fields = {
      type,
      title: String(values.get('title') ?? ''),
      body: String(values.get('body') ?? ''),
      quote: String(values.get('quote') ?? ''),
      url: String(values.get('url') ?? ''),
      tags: String(values.get('tags') ?? ''),
      ...(type === 'decision' ? { status: String(values.get('status')) as DecisionStatus } : {}),
    };
    try {
      const saved = id ? deps.store.updateEntry(id, fields) : deps.store.createEntry(fields);
      entryDialog.close();
      deps.onSaved(saved, id ? 'edit' : 'create');
    } catch (error) {
      showError(entryForm, error);
    }
  });

  // ── Candidate lists (link and supersede) ──────────────────────────────
  const candidateHtml = (entry: Entry, input: 'checkbox' | 'radio', name: string) =>
    `<label class="candidate" data-text="${escapeHtml(`${entry.title} ${typeLabel(entry.type)} ${entry.tags.join(' ')}`.toLowerCase())}"><input type="${input}" name="${name}" value="${entry.id}" /><span class="mini-icon type-${entry.type}">${typeIcon(entry.type, 12)}</span><span class="candidate-text"><strong>${escapeHtml(entry.title)}</strong><small>${typeLabel(entry.type)}${entry.status ? ` · ${STATUS_LABELS[entry.status]}` : ''} · ${formatDateTime(entry.createdAt)}</small></span></label>`;
  for (const form of [linkForm, supersedeForm]) {
    part<HTMLInputElement>(form, 'filter').addEventListener('input', (event) => {
      const text = (event.target as HTMLInputElement).value.trim().toLowerCase();
      form.querySelectorAll<HTMLElement>('.candidate').forEach((candidate) => {
        candidate.hidden = Boolean(text) && !(candidate.dataset.text ?? '').includes(text);
      });
    });
  }

  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const anchor = linkAnchor ? deps.store.get(linkAnchor) : undefined;
    if (!anchor) return showError(linkForm, new Error('This entry no longer exists. It may have been deleted in another tab.'));
    const values = new FormData(linkForm);
    const picks = values.getAll('pick').map(String);
    if (!picks.length) return showError(linkForm, new Error('Pick at least one entry to connect.'));
    const kindValue = values.get('kind');
    const kind = isLinkKind(kindValue) ? kindValue : 'supports';
    try {
      for (const pick of picks) {
        if (anchor.type === 'decision') deps.store.linkEvidence(anchor.id, pick, kind);
        else deps.store.linkEvidence(pick, anchor.id, kind);
      }
      linkDialog.close();
      deps.onChanged(`Connected ${picks.length} ${picks.length === 1 ? 'entry' : 'entries'} as ${kind === 'supports' ? 'support' : 'challenges'}.`);
    } catch (error) {
      showError(linkForm, error);
    }
  });

  supersedeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const replacement = new FormData(supersedeForm).get('replacement');
    if (!supersedeId) return;
    if (!replacement) return showError(supersedeForm, new Error('Pick the decision that replaced it.'));
    try {
      deps.store.updateEntry(supersedeId, { supersededBy: String(replacement) });
      supersedeDialog.close();
      deps.onChanged('Marked as replaced. It stays in your trail, linked to the decision that replaced it.');
    } catch (error) {
      showError(supersedeForm, error);
    }
  });
  part(supersedeForm, 'clear').addEventListener('click', () => {
    if (!supersedeId) return;
    try {
      deps.store.updateEntry(supersedeId, { status: 'accepted' });
      supersedeDialog.close();
      deps.onChanged('The decision is in force again.');
    } catch (error) {
      showError(supersedeForm, error);
    }
  });

  return {
    openEntry(options = {}) {
      const { entry } = options;
      entryForm.reset();
      const type = entry?.type ?? options.type ?? 'note';
      field<HTMLInputElement>('id').value = entry?.id ?? '';
      field<HTMLSelectElement>('type').value = type;
      entryForm.dataset.type = type;
      field<HTMLInputElement>('title').value = entry?.title ?? '';
      field<HTMLTextAreaElement>('body').value = entry?.body ?? '';
      field<HTMLTextAreaElement>('quote').value = entry?.quote ?? '';
      field<HTMLInputElement>('url').value = entry?.url ?? '';
      field<HTMLInputElement>('tags').value = entry?.tags.join(', ') ?? '';
      fillStatuses(entry?.status ?? 'accepted');
      entryForm.toggleAttribute('data-quote', Boolean(entry?.quote));
      part(entryForm, 'eyebrow').textContent = entry ? 'EDIT ENTRY' : 'NEW CAPTURE';
      part(entryForm, 'heading').textContent = entry ? 'Edit entry' : type === 'decision' ? 'Record a decision' : 'Add to your trail';
      part(entryForm, 'help').textContent = entry
        ? 'Changes are saved to this browser right away.'
        : type === 'decision'
          ? 'Say what you chose and why. Connect the evidence afterwards.'
          : 'A piece of evidence you may want later, or a decision you made.';
      part(entryForm, 'submit').textContent = entry ? 'Save changes' : 'Save entry';
      open(entryDialog, entryForm);
      field<HTMLInputElement>('title').focus();
    },

    openLink(anchorId) {
      const index = deps.store.index();
      const anchor = index.byId.get(anchorId);
      if (!anchor) return false;
      const isDecision = anchor.type === 'decision';
      const taken = new Set((isDecision ? evidenceFor(index, anchorId) : decisionsFor(index, anchorId)).map(({ entry }) => entry.id));
      const candidates = index.workspace.entries
        .filter((entry) => (isDecision ? entry.type !== 'decision' : entry.type === 'decision') && !taken.has(entry.id))
        .sort((a, b) => Number(isLiveDecision(b)) - Number(isLiveDecision(a)) || b.createdAt.localeCompare(a.createdAt));
      if (!candidates.length) return false;
      linkAnchor = anchorId;
      linkForm.reset();
      part(linkForm, 'heading').textContent = isDecision ? 'Connect evidence to this decision' : 'Connect this to decisions';
      part(linkForm, 'help').textContent = isDecision
        ? `Pick the evidence behind “${anchor.title}”, then choose whether it supports the decision or challenges it.`
        : `Pick the decisions “${anchor.title}” matters for, then choose whether it supports or challenges them.`;
      part(linkForm, 'candidates').innerHTML = candidates.map((entry) => candidateHtml(entry, 'checkbox', 'pick')).join('');
      open(linkDialog, linkForm);
      part<HTMLInputElement>(linkForm, 'filter').focus();
      return true;
    },

    openSupersede(decisionId) {
      const index = deps.store.index();
      const decision = index.byId.get(decisionId);
      if (!decision || decision.type !== 'decision') return false;
      const candidates = replacementCandidates(index, decisionId);
      if (!candidates.length) return false;
      supersedeId = decisionId;
      supersedeForm.reset();
      part(supersedeForm, 'help').textContent = `“${decision.title}” will be marked as replaced. It is not deleted: it stays in your trail, linked to the decision that replaced it.`;
      part(supersedeForm, 'candidates').innerHTML = candidates.map((entry) => candidateHtml(entry, 'radio', 'replacement')).join('');
      const current = decision.supersededBy
        ? supersedeForm.querySelector<HTMLInputElement>(`input[value="${decision.supersededBy}"]`)
        : null;
      if (current) current.checked = true;
      part(supersedeForm, 'clear').hidden = !decision.supersededBy;
      open(supersedeDialog, supersedeForm);
      part<HTMLInputElement>(supersedeForm, 'filter').focus();
      return true;
    },

    dispose() {
      host.remove();
    },
  };
}
