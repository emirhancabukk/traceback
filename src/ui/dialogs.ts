import { isLiveDecision, replacementCandidates } from '../core/decisions';
import { ENTRY_TYPES, STATUS_LABELS, isEntryType, isLinkKind, typeLabel, type DecisionStatus, type Entry, type EntryType } from '../core/model';
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
  openHelp(): void;
  dispose(): void;
}

const closeButton = `<button type="button" class="icon-button" data-close aria-label="Close">${icon('close', 18)}</button>`;

/** One line under the type cards, so nobody has to guess what a "source" is. */
const TYPE_HINTS: Record<EntryType, string> = {
  source: 'A page, article or document you read. Paste its link below.',
  note: 'Something you noticed, learned or worked out.',
  decision: 'Something you chose to do. Say why in the details.',
  command: 'Something you ran or tested, and what happened.',
  'file-change': 'A change you made to a file or a document.',
};

export function createDialogs(root: HTMLElement, deps: DialogDeps): Dialogs {
  const doc = root.ownerDocument;
  const host = doc.createElement('div');
  host.className = 'tb-dialogs';
  host.innerHTML = `
    <dialog id="entry-dialog" aria-labelledby="entry-dialog-title">
      <form id="entry-form" class="dialog-form" data-type="note" novalidate>
        <div class="dialog-head"><div><p class="eyebrow" data-role="eyebrow">NEW CAPTURE</p><h2 id="entry-dialog-title" data-role="heading">Add to your trail</h2><p class="dialog-help" data-role="help">A piece of evidence you may want later, or a decision you made.</p></div>${closeButton}</div>
        <input type="hidden" name="id" />
        <fieldset class="type-picker"><legend>What are you adding?</legend><div class="type-options">${ENTRY_TYPES.map((type) => `<label class="type-option"><input type="radio" name="type" value="${type}" /><span class="type-option-icon type-${type}">${typeIcon(type, 15)}</span><span>${typeLabel(type)}</span></label>`).join('')}</div><p class="type-hint" data-role="type-hint"></p></fieldset>
        <label>Title<input name="title" maxlength="300" placeholder="What happened?" autocomplete="off" /></label>
        <label>Details<textarea name="body" rows="5" placeholder="Capture the useful context…"></textarea></label>
        <fieldset class="for-decision"><legend>Status</legend><div class="segmented" data-role="status-options"></div></fieldset>
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
        <div class="relation-picker segmented" role="radiogroup" aria-label="Relation"><label class="seg-option is-for"><input type="radio" name="kind" value="supports" checked />${icon('check', 14)}<span>Supports it</span></label><label class="seg-option is-against"><input type="radio" name="kind" value="challenges" />${icon('close', 14)}<span>Challenges it</span></label></div>
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
    </dialog>
    <dialog id="help-dialog" aria-labelledby="help-dialog-title">
      <div class="dialog-form">
        <div class="dialog-head"><div><p class="eyebrow">HOW IT WORKS</p><h2 id="help-dialog-title">Keep the why next to the what</h2><p class="dialog-help">Months after a decision, nobody remembers why it was made. Traceback keeps the reasons attached, so the answer is one click away.</p></div>${closeButton}</div>
        <ol class="help-steps">
          <li><b>1</b><div><strong>Save evidence while you work</strong><p>An article you read, a test you ran, a risk you noticed. Press <kbd>N</kbd>, or use the browser extension on any page.</p></div></li>
          <li><b>2</b><div><strong>Record the decision</strong><p>Write what you chose and why, in a sentence or two.</p></div></li>
          <li><b>3</b><div><strong>Connect the evidence</strong><p>Open the decision, press <em>Connect evidence</em>, and mark each piece as a reason for it or against it.</p></div></li>
          <li><b>4</b><div><strong>Come back later</strong><p>The trace map shows every decision with its reasons. Export one as Markdown to share it.</p></div></li>
        </ol>
        <div class="help-example"><strong>Example.</strong> You are choosing where to host a website. You save two pricing pages and a speed test you ran, then record the decision <em>“Host on Vercel”</em>. The speed test and one pricing page support it; a note about lock-in challenges it. A year later, the trace map still tells you why.</div>
        <dl class="help-keys">
          <div><dt>New entry</dt><dd><kbd>N</kbd></dd></div>
          <div><dt>Search</dt><dd><kbd>/</kbd></dd></div>
          <div><dt>Trace map · Graph · Timeline</dt><dd><kbd>M</kbd> <kbd>G</kbd> <kbd>T</kbd></dd></div>
          <div><dt>Close the details</dt><dd><kbd>Esc</kbd></dd></div>
        </dl>
        <div class="dialog-actions"><button type="button" class="primary" data-close>Got it</button></div>
      </div>
    </dialog>`;
  root.append(host);

  const entryDialog = host.querySelector<HTMLDialogElement>('#entry-dialog')!;
  const entryForm = host.querySelector<HTMLFormElement>('#entry-form')!;
  const linkDialog = host.querySelector<HTMLDialogElement>('#link-dialog')!;
  const linkForm = host.querySelector<HTMLFormElement>('#link-form')!;
  const supersedeDialog = host.querySelector<HTMLDialogElement>('#supersede-dialog')!;
  const supersedeForm = host.querySelector<HTMLFormElement>('#supersede-form')!;
  const helpDialog = host.querySelector<HTMLDialogElement>('#help-dialog')!;
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
  for (const dialog of [entryDialog, linkDialog, supersedeDialog, helpDialog]) {
    dialog.addEventListener('close', () => deps.restoreFocus(returnFocus));
  }

  // ── Entry ──────────────────────────────────────────────────────────────
  const statusOptions = part(entryForm, 'status-options');
  const fillStatuses = (current: DecisionStatus) => {
    const options: DecisionStatus[] = current === 'superseded' ? ['proposed', 'accepted', 'superseded', 'rejected'] : ['proposed', 'accepted', 'rejected'];
    statusOptions.innerHTML = options
      .map((status) => `<label class="seg-option status-${status}"><input type="radio" name="status" value="${status}"${status === current ? ' checked' : ''} /><span>${STATUS_LABELS[status]}</span></label>`)
      .join('');
  };
  const setType = (type: EntryType) => {
    (entryForm.elements.namedItem('type') as RadioNodeList).value = type;
    entryForm.dataset.type = type;
    part(entryForm, 'type-hint').textContent = TYPE_HINTS[type];
  };
  entryForm.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name === 'type' && isEntryType(target.value)) setType(target.value);
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
    `<label class="candidate" data-text="${escapeHtml(`${entry.title} ${typeLabel(entry.type)} ${entry.tags.join(' ')}`.toLowerCase())}"><input type="${input}" name="${name}" value="${entry.id}" /><span class="check${input === 'radio' ? ' is-radio' : ''}" aria-hidden="true">${icon('check', 12)}</span><span class="mini-icon type-${entry.type}">${typeIcon(entry.type, 12)}</span><span class="candidate-text"><strong>${escapeHtml(entry.title)}</strong><small>${typeLabel(entry.type)}${entry.status ? ` · ${STATUS_LABELS[entry.status]}` : ''} · ${formatDateTime(entry.createdAt)}</small></span></label>`;
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
      setType(type);
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

    openHelp() {
      const active = doc.activeElement as HTMLElement | null;
      returnFocus = active?.dataset?.focus;
      helpDialog.showModal();
      helpDialog.querySelector<HTMLButtonElement>('.dialog-actions .primary')?.focus();
    },

    dispose() {
      host.remove();
    },
  };
}
