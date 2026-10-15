import { parseBrowserCapture, saveBrowserCapture } from '../src/capture';
import { LocalStorageTimelineRepository } from '../src/repository';

describe('browser capture bridge', () => {
  it('accepts safe web URLs and rejects unsupported protocols', () => {
    expect(parseBrowserCapture(JSON.stringify({ title: 'Docs', url: 'https://example.com/docs', text: 'hello' }))).toMatchObject({
      title: 'Docs',
      url: 'https://example.com/docs',
      text: 'hello',
    });
    expect(parseBrowserCapture(JSON.stringify({ title: 'Bad', url: 'javascript:alert(1)' }))).toBeUndefined();
  });

  it('supports the fragment payload used by the extension', () => {
    const hash = `#traceback_capture=${encodeURIComponent(JSON.stringify({ title: 'Fragment', url: 'https://example.com' }))}`;
    expect(parseBrowserCapture(new URLSearchParams(hash.slice(1)).get('traceback_capture'))?.title).toBe('Fragment');
  });

  it('saves browser metadata as a source through the repository', () => {
    const repository = new LocalStorageTimelineRepository();
    const entry = saveBrowserCapture(repository, { title: 'Docs', url: 'https://example.com/docs', text: 'Selected quote' });
    expect(entry).toMatchObject({ type: 'source', title: 'Docs', tags: ['browser', 'example.com'] });
    expect(entry.body).toContain('Selected quote');
    expect(entry.body).toContain('https://example.com/docs');
  });
});
