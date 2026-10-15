import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountApp } from '../src/app';
import { BRIDGE_CHANNEL } from '../src/core/bridge';
import { STORAGE_KEY, TimelineStore } from '../src/core/store';

let root: HTMLElement;
let unmount: () => void;
let store: TimelineStore;

const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

function mount() {
  store = new TimelineStore();
  unmount = mountApp(root, { store });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

afterEach(() => {
  unmount?.();
  vi.restoreAllMocks();
});

describe('first run', () => {
  it('offers the example workspace instead of seeding fake entries', () => {
    mount();
    expect(store.workspace.entries).toEqual([]);
    $('#load-example').click();
    expect(store.workspace.entries.length).toBeGreaterThan(10);
    expect(root.textContent).toContain('You are looking at the example workspace');
    $('#remove-examples').click();
    expect(store.workspace.entries).toEqual([]);
  });
});

describe('dialogs', () => {
  it('closes the entry dialog with × without saving, even when fields are filled', () => {
    mount();
    $('#new-entry').click();
    const dialog = $<HTMLDialogElement>('#entry-dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    $<HTMLInputElement>('#entry-form [name="title"]').value = 'Half-written';
    dialog.querySelector<HTMLButtonElement>('[data-close]')!.click();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(store.workspace.entries).toEqual([]);
  });

  it('saves an entry from the form', () => {
    mount();
    $('#new-entry').click();
    $<HTMLSelectElement>('#entry-form [name="type"]').value = 'decision';
    $<HTMLInputElement>('#entry-form [name="title"]').value = 'Ship 0.2';
    $<HTMLInputElement>('#entry-form [name="tags"]').value = 'release';
    $<HTMLFormElement>('#entry-form').requestSubmit();
    expect(store.workspace.entries).toEqual([expect.objectContaining({ type: 'decision', title: 'Ship 0.2', tags: ['release'] })]);
    expect($('.inspector h2').textContent).toBe('Ship 0.2');
  });

  it('shows a readable error for an invalid link instead of failing silently', () => {
    mount();
    $<HTMLInputElement>('#entry-form [name="title"]').value = 'Bad link';
    $<HTMLInputElement>('#entry-form [name="url"]').value = 'ftp://example.com';
    $<HTMLFormElement>('#entry-form').requestSubmit();
    expect(store.workspace.entries).toEqual([]);
    expect(root.textContent).toContain('Links must start with http:// or https://.');
  });

  it('closes the link dialog with × without linking the ticked evidence', () => {
    mount();
    const decision = store.createEntry({ type: 'decision', title: 'Decide' });
    store.createEntry({ type: 'note', title: 'Evidence' });
    unmount();
    unmount = mountApp(root, { store });
    $('#link-evidence').click();
    $<HTMLInputElement>('#link-form [name="evidence"]').checked = true;
    $('#link-dialog [data-close]').click();
    expect(store.workspace.links).toEqual([]);

    $('#link-evidence').click();
    $<HTMLInputElement>('#link-form [name="evidence"]').checked = true;
    $<HTMLInputElement>('#link-form [value="challenges"]').checked = true;
    $<HTMLFormElement>('#link-form').requestSubmit();
    expect(store.workspace.links).toEqual([expect.objectContaining({ decisionId: decision.id, kind: 'challenges' })]);
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

describe('cross-tab', () => {
  it('re-renders when another tab adds an entry', () => {
    mount();
    new TimelineStore().createEntry({ type: 'note', title: 'Written in another tab' });
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(root.textContent).toContain('Written in another tab');
  });
});

describe('search', () => {
  it('keeps focus and caret position while re-rendering', () => {
    mount();
    store.createEntry({ type: 'note', title: 'alpha beta' });
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
