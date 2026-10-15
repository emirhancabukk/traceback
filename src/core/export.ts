import { SCHEMA_VERSION, STATUS_LABELS, typeLabel, type Entry, type Link, type Workspace } from './model';
import { evidenceFor, type WorkspaceIndex } from './query';

export interface BundleEvidence {
  entry: Entry;
  link: Link;
}

export interface DecisionBundle {
  decision: Entry;
  supports: BundleEvidence[];
  challenges: BundleEvidence[];
  supersededBy?: Entry;
  /** Older decisions this one replaced. */
  supersedes: Entry[];
}

export function buildDecisionBundle(index: WorkspaceIndex, decisionId: string): DecisionBundle {
  const decision = index.byId.get(decisionId);
  if (!decision || decision.type !== 'decision') throw new Error('Select a decision to export.');
  const evidence = evidenceFor(index, decisionId);
  const supersededBy = decision.supersededBy ? index.byId.get(decision.supersededBy) : undefined;
  return {
    decision,
    supports: evidence.filter(({ link }) => link.kind === 'supports'),
    challenges: evidence.filter(({ link }) => link.kind === 'challenges'),
    ...(supersededBy ? { supersededBy } : {}),
    supersedes: index.workspace.entries
      .filter((entry) => entry.supersededBy === decisionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

/** `2026-10-15 16:42 UTC` — stable across machines, unlike locale formatting. */
export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Escapes characters that would change how a single line renders in Markdown. */
export function escapeMarkdown(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>|]/g, '\\$&');
}

function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `> ${line.replace(/[\\<>`]/g, '\\$&')}` : '>'))
    .join('\n');
}

function tagLine(entry: Entry): string {
  return entry.tags.length ? `Tags: ${entry.tags.map((tag) => `\`${tag.replace(/`/g, "'")}\``).join(', ')}` : '';
}

function evidenceSection(title: string, items: BundleEvidence[]): string[] {
  if (!items.length) return [];
  const lines = [`## ${title} (${items.length})`, ''];
  items.forEach(({ entry, link }, position) => {
    lines.push(`### ${position + 1}. ${escapeMarkdown(entry.title)}`, '');
    lines.push(`*${typeLabel(entry.type)} · recorded ${formatUtc(entry.createdAt)} · linked ${formatUtc(link.createdAt)}*`, '');
    if (entry.url) lines.push(`<${entry.url}>`, '');
    if (entry.quote) lines.push(quoteBlock(entry.quote), '');
    if (entry.body) lines.push(entry.body, '');
    const tags = tagLine(entry);
    if (tags) lines.push(tags, '');
  });
  return lines;
}

export function bundleToMarkdown(bundle: DecisionBundle, exportedAt: Date = new Date()): string {
  const { decision } = bundle;
  const status = decision.status ? STATUS_LABELS[decision.status] : 'Accepted';
  const meta = [`**Status:** ${status}`, `**Recorded:** ${formatUtc(decision.createdAt)}`];
  if (decision.updatedAt !== decision.createdAt) meta.push(`**Updated:** ${formatUtc(decision.updatedAt)}`);
  const lines = [`# ${escapeMarkdown(decision.title)}`, '', meta.join(' · '), ''];
  if (bundle.supersededBy) {
    lines.push(`> **Replaced by:** ${escapeMarkdown(bundle.supersededBy.title)} (${formatUtc(bundle.supersededBy.createdAt)})`, '');
  }
  if (decision.url) lines.push(`<${decision.url}>`, '');
  const tags = tagLine(decision);
  if (tags) lines.push(tags, '');
  lines.push('## Rationale', '', decision.body || '_No rationale recorded._', '');
  lines.push(...evidenceSection('Supporting evidence', bundle.supports));
  lines.push(...evidenceSection('Challenging evidence', bundle.challenges));
  if (!bundle.supports.length && !bundle.challenges.length) lines.push('## Evidence', '', '_No evidence linked yet._', '');
  if (bundle.supersedes.length) {
    lines.push('## Replaces', '');
    for (const old of bundle.supersedes) lines.push(`- ${escapeMarkdown(old.title)} (recorded ${formatUtc(old.createdAt)})`);
    lines.push('');
  }
  lines.push('---', '', `Exported from Traceback on ${exportedAt.toISOString()}.`, '');
  return lines.join('\n');
}

export function bundleToJson(bundle: DecisionBundle, exportedAt: Date = new Date()): string {
  return `${JSON.stringify(
    {
      format: 'traceback.decision-bundle',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      decision: bundle.decision,
      evidence: [...bundle.supports, ...bundle.challenges].map(({ entry, link }) => ({
        relation: link.kind,
        linkedAt: link.createdAt,
        entry,
      })),
      supersededBy: bundle.supersededBy ?? null,
      supersedes: bundle.supersedes,
    },
    null,
    2,
  )}\n`;
}

/** Full backup. `importWorkspace` reads this format back. */
export function workspaceToJson(workspace: Readonly<Workspace>, exportedAt: Date = new Date()): string {
  return `${JSON.stringify(
    {
      format: 'traceback.workspace',
      schema: SCHEMA_VERSION,
      exportedAt: exportedAt.toISOString(),
      revision: workspace.revision,
      entries: workspace.entries,
      links: workspace.links,
    },
    null,
    2,
  )}\n`;
}

const TRANSLITERATE: Record<string, string> = { ı: 'i', ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', þ: 'th' };

export function exportFilename(title: string, extension: 'md' | 'json', date: Date = new Date()): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[ıßøæœłđþ]/g, (letter) => TRANSLITERATE[letter] ?? letter)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'export';
  return `traceback-${slug}-${date.toISOString().slice(0, 10)}.${extension}`;
}
