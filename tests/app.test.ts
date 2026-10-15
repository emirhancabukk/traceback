import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountApp } from '../src/app';
import { BRIDGE_CHANNEL } from '../src/core/bridge';
import { isLiveDecision } from '../src/core/decisions';
import { STORAGE_KEY, TimelineStore } from '../src/core/store';

let root: HTMLElement;
let store: TimelineStore;
let unmount: (() => void) | undefined;

const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const $$ = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
const press = (key: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const clickSvg = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const heading = () => $('main h1').textContent;

function mount(): void {
  store = new TimelineStore();
  unmount = mountApp(root, { store });
}

function remount(): void {
  unmount?.();
  unmount = mountApp(root, { store });
}

function loadExample(): void {
  mount();
  $('[data-action="load-example"]').click();
}

beforeEach(() => {
  history.replaceState(null, '', '/');
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.restoreAllMocks();
});

describe('first run', () => {
  it('offers the example workspace instead of seeding fake entries', () => {
    mount();
    expect(store.workspace.entries).toEqual([]);
    expect(heading()).toBe('Your trail is empty');
    $('[data-action="load-example"]').click();
    expect(location.hash).toBe('#map');
    expect(root.textContent).toContain('You are looking at the example workspace');
    expect($$('.trace-row')).toHaveLength(store.workspace.entries.filter(isLiveDecision).length);
    $('[data-action="remove-examples"]').click();
    expect(store.workspace.entries).toEqual([]);
    expect(heading()).toBe('Your trail is empty');
  });

  it('opens the view named in the address and normalises unknown addresses', () => {
    history.replaceState(null, '', '/#timeline');
    loadExample();
    expect(location.hash).toBe('#map');
    unmount?.();
    history.replaceState(null, '', '/#graph');
    remount();
    expect(heading()).toBe('Graph');
    unmount?.();
    history.replaceState(null, '', '/#traceback_capture=%7B%7D');
    remount();
    expect(location.hash).toBe('#map');
  });
});

describe('trace map', () => {
  it('puts supporting evidence left, challenging evidence right and replaced decisions in the card', () => {
    loadExample();
    const row = $('.trace-card[data-id="example-d-reread"]').closest('.trace-row')!;
    expect(row.querySelectorAll('.is-supports .chip-ev')).toHaveLength(3);
    expect(row.querySelectorAll('.is-challenges .chip-ev')).toHaveLength(1);
    expect(row.querySelector('.trace-replaces')?.textContent).toContain('Keep the trail in memory');
    expect(row.querySelector('.trace-replaces em')?.textContent).toBe('2 reasons against');
    expect(row.querySelector('.chip-ev[data-id="example-c-multitab"] .shared')?.textContent).toBe('×2');
    expect($$('.flow.is-supports path').length).toBeGreaterThan(0);
  });

  it('filters rows and can include replaced decisions', () => {
    loadExample();
    $('[data-filter="proposed"]').click();
    expect($$('.trace-card').map((card) => card.dataset.id)).toEqual(['example-d-replay']);
    $('[data-filter="challenged"]').click();
    expect($$('.trace-row').every((row) => row.querySelector('.is-challenges .chip-ev'))).toBe(true);
    $('[data-filter="live"]').click();
    const live = $$('.trace-row').length;
    $('[data-action="toggle-closed"]').click();
    expect($$('.trace-row')).toHaveLength(live + 2);
    expect($$('.trace-row.is-closed')).toHaveLength(2);
    expect($$('.trace-row.is-closed .trace-meta .pill').map((pill) => pill.textContent)).toEqual(['Replaced', 'Replaced']);
  });

  it('records a decision straight from the trace map toolbar', () => {
    loadExample();
    expect($('[data-filter="unsupported"]').textContent).toContain('No support yet');
    $('[data-focus="map-new-decision"]').click();
    expect($('#entry-dialog').hasAttribute('open')).toBe(true);
    expect($('#entry-form').dataset.type).toBe('decision');
    expect($('#entry-dialog-title').textContent).toBe('Record a decision');
  });

  it('opens an entry in the drawer and closes it with Escape', () => {
    loadExample();
    $('.chip-ev[data-id="example-c-multitab"]').click();
    expect($('.drawer h2').textContent).toBe('Simulate two app tabs writing to the same storage');
    expect($('.drawer').textContent).toContain('Supports');
    expect($('.drawer').textContent).toContain('Challenges');
    expect(document.activeElement).toBe($('.drawer h2'));
    press('Escape');
    expect(root.querySelector('.drawer')).toBeNull();
  });

  it('searches decisions through their evidence', () => {
    loadExample();
    const search = $<HTMLInputElement>('#search');
    search.value = 'MDN';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect($$('.trace-card').map((card) => card.dataset.id)).toEqual(['example-d-bridge']);
    expect($('.chip-ev[data-id="example-s-mdn"]').classList.contains('is-match')).toBe(true);
  });

  it('lists evidence that is not connected yet', () => {
    mount();
    store.createEntry({ type: 'decision', title: 'Decide' });
    const loose = store.createEntry({ type: 'note', title: 'Loose end' });
    remount();
    expect($('.trace-loose').textContent).toContain('NOT CONNECTED YET · 1');
    expect($(`.trace-loose .chip-ev[data-id="${loose.id}"]`)).toBeTruthy();
    expect($('.trace-placeholder').textContent).toBe('no supporting evidence yet');
  });
});

describe('views and shortcuts', () => {
  it('switches views with T, M and G but not while typing', () => {
    loadExample();
    press('t');
    expect(location.hash).toBe('#timeline');
    expect(heading()).toBe('Timeline');
    press('g');
    expect(location.hash).toBe('#graph');
    press('m');
    expect(heading()).toBe('Trace map');
    const search = $<HTMLInputElement>('#search');
    search.focus();
    press('t', search);
    expect(location.hash).toBe('#map');
    $('[data-action="view"][data-view="timeline"]').click();
    expect(heading()).toBe('Timeline');
    history.replaceState(null, '', '/#graph');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(heading()).toBe('Graph');
  });

  it('opens the capture dialog with N and focuses search with /', () => {
    loadExample();
    press('n');
    expect(root.querySelector('#entry-dialog')?.hasAttribute('open')).toBe(true);
    root.querySelector<HTMLButtonElement>('#entry-dialog [data-close]')!.click();
    press('/');
    expect(document.activeElement).toBe($('#search'));
  });

  it('filters the timeline by type', () => {
    loadExample();
    press('t');
    $('[data-action="timeline-type"][data-type="source"]').click();
    const sources = store.workspace.entries.filter((entry) => entry.type === 'source').length;
    expect($$('.timeline .entry')).toHaveLength(sources);
  });
});

describe('graph', () => {
  it('draws every entry, link and replacement', () => {
    loadExample();
    press('g');
    expect($$('.g-node')).toHaveLength(store.workspace.entries.length);
    expect($$('.g-edge.kind-replaces')).toHaveLength(2);
    expect($$('.g-edge.kind-challenges')).toHaveLength(store.workspace.links.filter((link) => link.kind === 'challenges').length);
  });

  it('selects nodes by click and keyboard, dims the rest and keeps positions stable', () => {
    loadExample();
    press('g');
    const before = $('.g-node[data-id="example-d-icons"]').getAttribute('transform');
    clickSvg($('.g-node[data-id="example-d-bridge"]'));
    expect($('.inspector h2').textContent).toBe('Deliver browser captures through a content-script bridge');
    expect($('.g-node[data-id="example-d-icons"]').classList.contains('is-dim')).toBe(true);
    expect($('.g-node[data-id="example-s-mdn"]').classList.contains('is-dim')).toBe(false);
    expect($('.g-node[data-id="example-d-icons"]').getAttribute('transform')).toBe(before);
    press('Enter', $('.g-node[data-id="example-d-port"]'));
    expect($('.inspector h2').textContent).toBe('Refuse to start when port 5173 is taken');
    press('Escape');
    expect($('.inspector').textContent).toContain('Select a node');
  });

  it('zooms with the buttons', () => {
    loadExample();
    press('g');
    const scale = () => Number(/scale\(([\d.]+)\)/.exec($('.graph-viewport').getAttribute('transform') ?? '')?.[1]);
    const start = scale();
    $('[data-action="zoom-in"]').click();
    expect(scale()).toBeCloseTo(start * 1.25, 2);
    $('[data-action="zoom-fit"]').click();
    expect(scale()).toBeCloseTo(start, 2);
  });
});

describe('dialogs', () => {
  it('closes the entry dialog with × without saving, even when fields are filled', () => {
    mount();
    $('[data-action="new-entry"]').click();
    const dialog = $<HTMLDialogElement>('#entry-dialog');
    $<HTMLInputElement>('#entry-form [name="title"]').value = 'Half-written';
    dialog.querySelector<HTMLButtonElement>('[data-close]')!.click();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(store.workspace.entries).toEqual([]);
  });

  it('records a decision and opens it', () => {
    mount();
    $('[data-action="new-entry"]').click();
    const type = $<HTMLSelectElement>('#entry-form [name="type"]');
    type.value = 'decision';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    expect($('#entry-form').dataset.type).toBe('decision');
    $<HTMLInputElement>('#entry-form [name="title"]').value = 'Ship 0.3';
    $<HTMLSelectElement>('#entry-form [name="status"]').value = 'proposed';
    $<HTMLInputElement>('#entry-form [name="tags"]').value = 'release';
    $<HTMLFormElement>('#entry-form').requestSubmit();
    expect(store.workspace.entries).toEqual([expect.objectContaining({ type: 'decision', title: 'Ship 0.3', status: 'proposed', tags: ['release'] })]);
    expect($('.drawer h2').textContent).toBe('Ship 0.3');
  });

  it('shows errors inside the dialog and keeps it open', () => {
    mount();
    $('[data-action="new-entry"]').click();
    $<HTMLInputElement>('#entry-form [name="title"]').value = 'Bad link';
    $<HTMLInputElement>('#entry-form [name="url"]').value = 'ftp://example.com';
    $<HTMLFormElement>('#entry-form').requestSubmit();
    expect($('#entry-form .form-error').textContent).toBe('Links must start with http:// or https://.');
    expect($('#entry-dialog').hasAttribute('open')).toBe(true);
    expect(store.workspace.entries).toEqual([]);
  });

  it('edits an entry from the inspector', () => {
    mount();
    const note = store.createEntry({ type: 'note', title: 'Draft', body: 'First version' });
    remount();
    press('t');
    $(`.entry-open[data-id="${note.id}"]`).click();
    $('.inspector [data-action="edit"]').click();
    const title = $<HTMLInputElement>('#entry-form [name="title"]');
    expect(title.value).toBe('Draft');
    title.value = 'Final';
    $<HTMLFormElement>('#entry-form').requestSubmit();
    expect(store.get(note.id)).toMatchObject({ title: 'Final', body: 'First version' });
    expect($('.inspector h2').textContent).toBe('Final');
  });

  it('connects evidence to a decision from the evidence side, then flips and removes the link', () => {
    mount();
    const decision = store.createEntry({ type: 'decision', title: 'Decide' });
    const note = store.createEntry({ type: 'note', title: 'Evidence' });
    remount();
    $(`.trace-loose .chip-ev[data-id="${note.id}"]`).click();
    $('.drawer [data-action="link"]').click();
    expect($('#link-form').textContent).toContain('Connect this to decisions');
    $<HTMLInputElement>(`#link-form [name="pick"][value="${decision.id}"]`).checked = true;
    $<HTMLInputElement>('#link-form [value="challenges"]').checked = true;
    $<HTMLFormElement>('#link-form').requestSubmit();
    expect(store.workspace.links).toEqual([expect.objectContaining({ decisionId: decision.id, evidenceId: note.id, kind: 'challenges' })]);
    $('.drawer [data-action="flip"]').click();
    expect(store.workspace.links[0].kind).toBe('supports');
    $('.drawer [data-action="unlink"]').click();
    expect(store.workspace.links).toEqual([]);
  });

  it('closes the link dialog with × without connecting the ticked evidence', () => {
    mount();
    const decision = store.createEntry({ type: 'decision', title: 'Decide' });
    store.createEntry({ type: 'note', title: 'Evidence' });
    remount();
    $(`.card-open[data-id="${decision.id}"]`).click();
    $('.drawer [data-action="link"]').click();
    $<HTMLInputElement>('#link-form [name="pick"]').checked = true;
    $('#link-dialog [data-close]').click();
    expect(store.workspace.links).toEqual([]);
  });

  it('marks a decision as replaced', () => {
    mount();
    const old = store.createEntry({ type: 'decision', title: 'Old approach' });
    const next = store.createEntry({ type: 'decision', title: 'New approach' });
    remount();
    $(`.card-open[data-id="${old.id}"]`).click();
    $('.drawer [data-action="supersede"]').click();
    $<HTMLInputElement>(`#supersede-form [value="${next.id}"]`).checked = true;
    $<HTMLFormElement>('#supersede-form').requestSubmit();
    expect(store.get(old.id)).toMatchObject({ status: 'superseded', supersededBy: next.id });
    expect($(`.trace-card[data-id="${next.id}"]`).textContent).toContain('Replaces');
  });

  it('explains when no decision could replace this one', () => {
    mount();
    const only = store.createEntry({ type: 'decision', title: 'Only decision' });
    remount();
    $(`.card-open[data-id="${only.id}"]`).click();
    $('.drawer [data-action="supersede"]').click();
    expect(root.textContent).toContain('No other decision can replace this one.');
  });
});

describe('editing in place', () => {
  it('deletes an entry and brings it back with Undo', () => {
    loadExample();
    $('.card-open[data-id="example-d-port"]').click();
    $('.drawer [data-action="delete"]').click();
    expect(store.get('example-d-port')).toBeUndefined();
    expect(root.textContent).toContain('Deleted “Refuse to start when port 5173 is taken”.');
    expect(root.textContent).toContain('2 connections went with it.');
    $('[data-notice-action]').click();
    expect(store.get('example-d-port')).toBeTruthy();
    expect(store.workspace.links.filter((link) => link.decisionId === 'example-d-port')).toHaveLength(2);
    expect($('.drawer h2').textContent).toBe('Refuse to start when port 5173 is taken');
  });

  it('changes a decision status from the inspector', () => {
    loadExample();
    $('.card-open[data-id="example-d-replay"]').click();
    const select = $<HTMLSelectElement>('.drawer [data-change="status"]');
    select.value = 'rejected';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get('example-d-replay')?.status).toBe('rejected');
    expect($('[data-action="toggle-closed"]').textContent).toContain('Show replaced and rejected (3)');
  });
});

describe('browser captures', () => {
  it('saves captures delivered by the extension bridge and acknowledges them', () => {
    const posted: unknown[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => void posted.push(message));
    mount();
    const capture = { id: 'cap-1', title: 'Pricing page', url: 'https://example.com/pricing', text: 'Plans start at…', tags: [], capturedAt: new Date().toISOString() };
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: BRIDGE_CHANNEL, type: 'captures', captures: [capture] },
        origin: window.location.origin,
        source: window,
      }),
    );
    expect(store.get('cap-1')).toMatchObject({ type: 'source', quote: 'Plans start at…', origin: 'browser' });
    expect(root.textContent).toContain('Saved “Pricing page” as source evidence.');
    expect($('.trace-loose .chip-ev[data-id="cap-1"]')).toBeTruthy();
    expect(posted.at(-1)).toEqual({ channel: BRIDGE_CHANNEL, type: 'ack', ids: ['cap-1'] });
  });

  it('ignores a capture that arrives from another origin', () => {
    mount();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: BRIDGE_CHANNEL, type: 'captures', captures: [{ id: 'evil', title: 'x', url: 'https://evil.example', capturedAt: new Date().toISOString() }] },
        origin: 'https://evil.example',
        source: window,
      }),
    );
    expect(store.workspace.entries).toEqual([]);
  });
});

describe('cross-tab and focus', () => {
  it('re-renders when another tab adds an entry', () => {
    mount();
    new TimelineStore().createEntry({ type: 'note', title: 'Written in another tab' });
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    press('t');
    expect(root.textContent).toContain('Written in another tab');
  });

  it('keeps focus and caret position in the search box while re-rendering', () => {
    mount();
    store.createEntry({ type: 'note', title: 'alpha beta' });
    remount();
    press('t');
    const input = $<HTMLInputElement>('#search');
    input.focus();
    input.value = 'alpa';
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const after = $<HTMLInputElement>('#search');
    expect(document.activeElement).toBe(after);
    expect(after.selectionStart).toBe(3);
    expect(root.textContent).toContain('No matching entries');
  });
});
