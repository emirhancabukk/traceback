import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_CHANNEL, captureToEntry, connectExtensionBridge, parseCapture } from '../src/core/bridge';

const now = new Date('2026-10-15T12:00:00.000Z');
const valid = { id: 'cap-1', title: 'Docs', url: 'https://example.com/docs', text: 'quote', tags: ['x'], capturedAt: '2026-10-15T11:59:00.000Z' };

describe('parseCapture', () => {
  it('accepts a well-formed capture', () => {
    expect(parseCapture(valid, now)).toEqual(valid);
  });

  it('rejects unsafe or malformed captures', () => {
    expect(parseCapture({ ...valid, url: 'javascript:alert(1)' }, now)).toBeUndefined();
    expect(parseCapture({ ...valid, id: '../../etc' }, now)).toBeUndefined();
    expect(parseCapture('nope', now)).toBeUndefined();
  });

  it('repairs what it can', () => {
    const capture = parseCapture({ ...valid, title: '  ', url: 'https://u:p@example.com/', text: 'x'.repeat(30_000), capturedAt: '2099-01-01T00:00:00.000Z' }, now);
    expect(capture).toMatchObject({ title: 'example.com', url: 'https://example.com/', capturedAt: now.toISOString() });
    expect(capture?.text).toHaveLength(20_000);
  });

  it('becomes a browser source entry', () => {
    expect(captureToEntry(parseCapture({ ...valid, note: 'why' }, now)!)).toMatchObject({
      id: 'cap-1',
      type: 'source',
      body: 'why',
      quote: 'quote',
      origin: 'browser',
      tags: ['browser', 'example.com', 'x'],
    });
  });
});

describe('connectExtensionBridge', () => {
  let disconnect: (() => void) | undefined;
  afterEach(() => disconnect?.());

  function setup(onCaptures = vi.fn((captures: { id: string }[]) => captures.map((capture) => capture.id))) {
    const posted: unknown[] = [];
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => void posted.push(message));
    disconnect = connectExtensionBridge({ target: window, onCaptures });
    const send = (data: unknown, init: Partial<MessageEventInit> = {}) =>
      window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window, ...init }));
    return { posted, postMessage, onCaptures, send };
  }

  it('announces itself and answers the extension handshake', () => {
    const { posted, send } = setup();
    expect(posted).toEqual([{ channel: BRIDGE_CHANNEL, type: 'app-ready', protocol: 1 }]);
    send({ channel: BRIDGE_CHANNEL, type: 'extension-ready' });
    expect(posted).toHaveLength(2);
  });

  it('stores valid captures and acknowledges stored and malformed ids', () => {
    const { posted, onCaptures, send } = setup();
    send({ channel: BRIDGE_CHANNEL, type: 'captures', captures: [valid, { id: 'broken', url: 'ftp://x' }] });
    expect(onCaptures).toHaveBeenCalledWith([expect.objectContaining({ id: 'cap-1' })]);
    expect(posted.at(-1)).toEqual({ channel: BRIDGE_CHANNEL, type: 'ack', ids: ['cap-1', 'broken'] });
  });

  it('keeps captures queued when they could not be stored', () => {
    const { posted, send } = setup(vi.fn(() => []));
    send({ channel: BRIDGE_CHANNEL, type: 'captures', captures: [valid] });
    expect(posted).toHaveLength(1);
  });

  it('ignores messages from other origins, other windows and other channels', () => {
    const { onCaptures, send } = setup();
    const message = { channel: BRIDGE_CHANNEL, type: 'captures', captures: [valid] };
    send(message, { origin: 'https://evil.example' });
    send(message, { source: null });
    send({ ...message, channel: 'other' });
    expect(onCaptures).not.toHaveBeenCalled();
  });
});
