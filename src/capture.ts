import type { TimelineRepository } from './repository';

export interface BrowserCapture {
  title: string;
  url: string;
  text?: string;
}

const MAX_TITLE_LENGTH = 240;
const MAX_TEXT_LENGTH = 20_000;

export function parseBrowserCapture(value: string | null): BrowserCapture | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<BrowserCapture>;
    if (typeof parsed.title !== 'string' || typeof parsed.url !== 'string') return undefined;
    const url = new URL(parsed.url);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return {
      title: parsed.title.trim().slice(0, MAX_TITLE_LENGTH) || url.hostname,
      url: url.toString(),
      text: typeof parsed.text === 'string' ? parsed.text.trim().slice(0, MAX_TEXT_LENGTH) : undefined,
    };
  } catch {
    return undefined;
  }
}

export function saveBrowserCapture(repository: TimelineRepository, capture: BrowserCapture) {
  const pageTitle = capture.title || new URL(capture.url).hostname;
  const body = [
    capture.text ? `Selected text:\n\n${capture.text}` : 'Captured from the active browser tab.',
    `\n\nURL: ${capture.url}`,
  ].join('');
  return repository.create({
    type: 'source',
    title: pageTitle,
    body,
    tags: ['browser', new URL(capture.url).hostname],
  });
}
