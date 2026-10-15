import { formatDate, typeLabel, type TimelineEntry } from './domain';
import type { TimelineRepository } from './repository';

export function exportDecisionMarkdown(decision: TimelineEntry, evidence: TimelineEntry[]): string {
  return [
    `# ${decision.title}`,
    '',
    `> Decision recorded ${formatDate(decision.createdAt)}`,
    '',
    decision.body,
    '',
    '## Evidence bundle',
    '',
    ...(evidence.length
      ? evidence.flatMap((entry) => [
          `### ${entry.title}`,
          `**${typeLabel(entry.type)} · ${formatDate(entry.createdAt)}**`,
          '',
          entry.body,
          entry.tags.length ? `\nTags: ${entry.tags.map((tag) => `\`${tag}\``).join(', ')}` : '',
          '',
        ])
      : ['No evidence linked.']),
  ].join('\n');
}

export function exportDecisionJson(decision: TimelineEntry, evidence: TimelineEntry[]): string {
  return JSON.stringify({ decision, evidence }, null, 2);
}

export function decisionBundle(repository: TimelineRepository, decisionId: string): { decision: TimelineEntry; evidence: TimelineEntry[] } {
  const decision = repository.get(decisionId);
  if (!decision || decision.type !== 'decision') throw new Error('Select a decision to export.');
  return { decision, evidence: repository.evidenceFor(decisionId) };
}
