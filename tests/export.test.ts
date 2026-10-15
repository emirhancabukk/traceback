import { exportDecisionJson, exportDecisionMarkdown } from '../src/export';
import type { TimelineEntry } from '../src/domain';

const decision: TimelineEntry = { id: 'd1', type: 'decision', title: 'Ship locally', body: 'Keep data on device.', createdAt: '2025-01-01T12:00:00.000Z', tags: [] };
const source: TimelineEntry = { id: 's1', type: 'source', title: 'Brief', body: 'Local-first requirement.', createdAt: '2025-01-01T13:00:00.000Z', tags: ['product'] };

describe('decision exports', () => {
  it('exports a readable Markdown evidence bundle', () => {
    const output = exportDecisionMarkdown(decision, [source]);
    expect(output).toContain('# Ship locally');
    expect(output).toContain('### Brief');
    expect(output).toContain('`product`');
  });

  it('exports structured JSON with decision and evidence', () => {
    expect(JSON.parse(exportDecisionJson(decision, [source]))).toEqual({ decision, evidence: [source] });
  });
});
