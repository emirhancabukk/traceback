# Contributing to Traceback

Thanks for helping. Issues and pull requests are welcome.

## Setup

```bash
npm install
npm run dev     # http://localhost:5173
npm run check   # run this before opening a pull request
```

## Principles

- **Local-first, no network.** The app must work offline and never contact a server. New features may not add outside requests; the Content-Security-Policy in `index.html` enforces this.
- **No runtime dependencies.** Prefer a small, tested helper over a package. Development tooling is fine.
- **Never lose data.** Every write goes through `TimelineStore.commit()`. Changes to the stored format need a migration in `src/core/schema.ts` and a test that loads the old format.
- **Core stays pure.** `src/core/*` must not touch the DOM so it can be reused by other front ends. `src/ui/*` renders; it reads from the core and changes data only through `TimelineStore`.
- **Escape everything.** Views build HTML strings; every piece of user text goes through `escapeHtml` in `src/ui/format.ts`.
- **Plain language in the UI.** Labels and messages should make sense to someone who has never read this file.

## Pull requests

- Keep each pull request focused on one change and include tests for behaviour changes.
- Run `npm run check`; CI runs the same command.
- Changed the icon artwork? Run `npm run icons` and commit the regenerated files.
- Need a new extension permission? Explain why in the pull request and update the allow-list in `scripts/validate-extension.mjs` deliberately.
