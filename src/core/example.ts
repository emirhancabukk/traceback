import { SCHEMA_VERSION, type Entry, type EntryType, type Link, type LinkKind, type Workspace } from './model';

/**
 * The example workspace: a made-up café putting its website together. It is
 * only added when the person asks for it, and every entry carries
 * `origin: "example"` so it can be removed again in one step.
 *
 * It is small on purpose but shows every part of the app: decisions with
 * evidence for and against, two decisions that were replaced, evidence that
 * bears on two decisions, a decision still open, and one source that is not
 * connected to anything yet.
 */

type Draft = Omit<Entry, 'createdAt' | 'updatedAt' | 'origin' | 'tags' | 'body'> & {
  /** UTC, "YYYY-MM-DD HH:MM". */
  when: string;
  body?: string;
  tags?: string[];
};

const drafts: Draft[] = [
  // Decisions ────────────────────────────────────────────────────────────
  {
    id: 'example-d-host',
    type: 'decision',
    status: 'accepted',
    when: '2026-03-12 10:40',
    title: 'Host the website on Vercel',
    body: 'It was the fastest host in our test, every change gets its own preview link, and one paid seat covers a site our size.',
    tags: ['hosting'],
  },
  {
    id: 'example-d-shared',
    type: 'decision',
    status: 'superseded',
    supersededBy: 'example-d-host',
    when: '2026-03-02 09:15',
    title: 'Keep the site on our shared hosting',
    body: 'It is already paid for until the end of March, so staying costs nothing extra for now.',
    tags: ['hosting'],
  },
  {
    id: 'example-d-checkout',
    type: 'decision',
    status: 'accepted',
    when: '2026-03-19 15:05',
    title: 'Use a hosted checkout for online orders',
    body: 'Card numbers never touch our own site, and it was working the same afternoon.',
    tags: ['orders'],
  },
  {
    id: 'example-d-own-form',
    type: 'decision',
    status: 'superseded',
    supersededBy: 'example-d-checkout',
    when: '2026-03-05 11:30',
    title: 'Build our own order form',
    body: 'Full control over how ordering looks on the site.',
    tags: ['orders'],
  },
  {
    id: 'example-d-domain',
    type: 'decision',
    status: 'accepted',
    when: '2026-03-03 16:20',
    title: 'Keep our current domain name',
    body: 'Customers already know cornercafe.example, and it is printed on every cup.',
    tags: ['domain'],
  },
  {
    id: 'example-d-photos',
    type: 'decision',
    status: 'accepted',
    when: '2026-03-24 13:10',
    title: 'Take our own photos of the menu',
    body: 'Two hours with a phone and window light was enough.',
    tags: ['design'],
  },
  {
    id: 'example-d-newsletter',
    type: 'decision',
    status: 'proposed',
    when: '2026-03-27 09:45',
    title: 'Send a monthly newsletter with the specials',
    body: 'Not decided yet. Worth it only if someone can write it every month.',
    tags: ['marketing'],
  },

  // Evidence ─────────────────────────────────────────────────────────────
  {
    id: 'example-s-vercel',
    type: 'source',
    when: '2026-03-10 14:00',
    title: 'Vercel pricing page',
    url: 'https://vercel.com/pricing',
    body: 'Compared the plans. One paid seat covers a site our size.',
    tags: ['hosting'],
  },
  {
    id: 'example-c-speedtest',
    type: 'command',
    when: '2026-03-11 17:30',
    title: 'Speed test: Vercel preview vs. shared hosting',
    body: 'Ran Lighthouse on the home page of both.\nVercel preview: performance 97\nShared hosting: performance 58',
    tags: ['hosting', 'speed'],
  },
  {
    id: 'example-n-preview',
    type: 'note',
    when: '2026-03-11 18:05',
    title: 'Every change gets its own preview link',
    body: 'Ana can check a new menu on her phone before it goes live.',
    tags: ['hosting'],
  },
  {
    id: 'example-n-lockin',
    type: 'note',
    when: '2026-03-12 09:20',
    title: 'The contact form only works on Vercel',
    body: 'Moving to another host later means rewriting it.',
    tags: ['hosting', 'risk'],
  },
  {
    id: 'example-n-https',
    type: 'note',
    when: '2026-03-02 12:40',
    title: 'Shared hosting charges extra for HTTPS',
    body: 'The certificate is a paid add-on there.',
    tags: ['hosting'],
  },
  {
    id: 'example-s-stripe',
    type: 'source',
    when: '2026-03-17 10:10',
    title: 'Stripe: guide to PCI compliance',
    url: 'https://stripe.com/guides/pci-compliance',
    body: 'If card numbers never reach our own site, the yearly compliance check is much simpler.',
    tags: ['payments'],
  },
  {
    id: 'example-c-test-order',
    type: 'command',
    when: '2026-03-19 14:20',
    title: 'Placed a test order from a phone',
    body: 'A flat white and a croissant in test mode. Paid, got the email receipt, saw it in the dashboard.',
    tags: ['orders'],
  },
  {
    id: 'example-n-weekends',
    type: 'note',
    when: '2026-03-06 19:00',
    title: 'Our own form would take a few weekends',
    body: 'Validation, emails, refunds, and testing it all on phones.',
    tags: ['orders'],
  },
  {
    id: 'example-n-leave-site',
    type: 'note',
    when: '2026-03-19 15:00',
    title: 'Customers leave our site to pay',
    body: "The payment page is on Stripe's address. A few regulars might find that odd.",
    tags: ['orders', 'risk'],
  },
  {
    id: 'example-n-card-data',
    type: 'note',
    when: '2026-03-06 19:10',
    title: 'Keeping card numbers ourselves is risky',
    body: "One mistake could leak our customers' cards.",
    tags: ['payments', 'risk'],
  },
  {
    id: 'example-n-control',
    type: 'note',
    when: '2026-03-05 11:00',
    title: 'We want ordering to look like the rest of the site',
    tags: ['orders', 'design'],
  },
  {
    id: 'example-n-printed',
    type: 'note',
    when: '2026-03-03 15:50',
    title: 'The address is printed on cups and flyers',
    body: 'Reprinting everything would cost more than the domain itself.',
    tags: ['domain'],
  },
  {
    id: 'example-n-search',
    type: 'note',
    when: '2026-03-03 16:05',
    title: 'Searching for us already finds the old address',
    tags: ['domain'],
  },
  {
    id: 'example-n-stock',
    type: 'note',
    when: '2026-03-23 10:30',
    title: 'Stock photos looked nothing like our food',
    tags: ['design'],
  },
  {
    id: 'example-f-photos',
    type: 'file-change',
    when: '2026-03-24 12:45',
    title: 'menu/: 18 photos, resized to 1600 px',
    tags: ['design'],
  },
  {
    id: 'example-n-regulars',
    type: 'note',
    when: '2026-03-26 17:15',
    title: 'Regulars ask on Instagram when the specials change',
    tags: ['marketing'],
  },
  {
    id: 'example-n-no-time',
    type: 'note',
    when: '2026-03-27 09:30',
    title: 'Nobody has time to write it every month',
    tags: ['marketing', 'risk'],
  },
  {
    id: 'example-s-font',
    type: 'source',
    when: '2026-03-28 11:00',
    title: 'Fraunces, a font for the menu headings',
    url: 'https://fonts.google.com/specimen/Fraunces',
    body: 'Maybe for the printed menu too. Not decided.',
    tags: ['design'],
  },
];

const relations: Array<[decisionId: string, evidenceId: string, kind: LinkKind]> = [
  ['example-d-host', 'example-s-vercel', 'supports'],
  ['example-d-host', 'example-c-speedtest', 'supports'],
  ['example-d-host', 'example-n-preview', 'supports'],
  ['example-d-host', 'example-n-lockin', 'challenges'],
  ['example-d-shared', 'example-c-speedtest', 'challenges'],
  ['example-d-shared', 'example-n-https', 'challenges'],
  ['example-d-checkout', 'example-s-stripe', 'supports'],
  ['example-d-checkout', 'example-c-test-order', 'supports'],
  ['example-d-checkout', 'example-n-weekends', 'supports'],
  ['example-d-checkout', 'example-n-leave-site', 'challenges'],
  ['example-d-own-form', 'example-n-control', 'supports'],
  ['example-d-own-form', 'example-n-weekends', 'challenges'],
  ['example-d-own-form', 'example-n-card-data', 'challenges'],
  ['example-d-domain', 'example-n-printed', 'supports'],
  ['example-d-domain', 'example-n-search', 'supports'],
  ['example-d-photos', 'example-n-stock', 'supports'],
  ['example-d-photos', 'example-f-photos', 'supports'],
  ['example-d-newsletter', 'example-n-regulars', 'supports'],
  ['example-d-newsletter', 'example-n-no-time', 'challenges'],
];

const iso = (when: string) => `${when.replace(' ', 'T')}:00.000Z`;

const entries: Entry[] = drafts.map(({ when, body = '', tags = [], ...rest }) => ({
  ...rest,
  type: rest.type as EntryType,
  body,
  tags,
  createdAt: iso(when),
  updatedAt: iso(when),
  origin: 'example',
}));

const createdAt = new Map(entries.map((entry) => [entry.id, entry.createdAt]));

const links: Link[] = relations.map(([decisionId, evidenceId, kind]) => {
  const a = createdAt.get(decisionId) ?? '';
  const b = createdAt.get(evidenceId) ?? '';
  return { decisionId, evidenceId, kind, createdAt: a > b ? a : b };
});

export const EXAMPLE_WORKSPACE: Readonly<Workspace> = Object.freeze({
  schema: SCHEMA_VERSION,
  revision: 0,
  entries,
  links,
});
