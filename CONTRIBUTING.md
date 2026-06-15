# Contributing

Private friend-group project. These notes are for keeping the codebase coherent across sessions and collaborators.

## Setup

See [QUICKSTART.md](QUICKSTART.md) for the full setup walkthrough. Short version:

```bash
npm install          # root (bot + API)
cd ui && npm install # operator app
```

No global tooling is required beyond Node 22 and npm.

## Running tests

Root-level unit tests:
```bash
npm test
```

Operator app tests:
```bash
cd ui && npx vitest run
```

Type-check the operator app (always run before committing UI changes):
```bash
cd ui && npm run check
```

Type-check the b-side site:
```bash
cd bside && npm run check
```

Root-level TypeScript check:
```bash
npm run build
```

## Linting and formatting

```bash
npm run lint      # ESLint
npm run format    # Prettier
```

## Branch and commit conventions

- One logical change per commit. Commit freely during a sprint; push in batches (see `CLAUDE.md` for the push threshold policy).
- Commit message format: `type(scope): short description` — e.g. `feat(content): archive-update modal`, `fix(digest): handle empty round`.
- Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- Never `git push` without explicit confirmation from the project owner (see `CLAUDE.md`).
- Never `--amend` a commit that has already been pushed.

## Code style

- TypeScript throughout. No `any` except at external API boundaries where the shape is genuinely unknown.
- Svelte 5 runes (`$state`, `$derived`, `$effect`) in all new UI code — no Svelte 4 stores.
- Tailwind CSS 4 utility classes in the operator app. Avoid inline `style=` except for dynamic values Tailwind can't express.
- No comments unless the WHY is non-obvious (a hidden constraint, a workaround, a subtle invariant).

## Where docs live

| Location | What it covers |
|---|---|
| `README.md` | Project overview, features, architecture |
| `QUICKSTART.md` | Step-by-step dev and prod setup |
| `CHANGELOG.md` | Version history (updated per release) |
| `docs/design/` | UI/UX design docs and design system notes |
| `docs/design-briefs/` | Feature briefs written before implementation |
| `docs/coordination/` | Sprint process logs and decision records |
| `docs/archive/` | Historical planning docs no longer active |
| `ui/README.md` | Operator app internals |
| `bside/README.md` | Public per-league site |
| `extension/README.md` | Chrome extension |
| `src/README.md` | Backend module map |

When writing a new feature, start with a brief in `docs/design-briefs/`. Decisions that affect the architecture belong in `docs/coordination/`.

## Key invariants

- **Never mutate `data/` on the host while the dev server is running** if the task writes to the DB. Copy the DB first.
- **`digest-static` is read-only** — it serves `digests/` but never writes to it. The operator app writes; Caddy reads.
- **b-side slugs are unguessable** — 22-char base64url (16 bytes of entropy). Never expose a slug-listing endpoint.
- **No-strife LLM contract** — superlative and blurb prompts must never produce leaderboard language or make anyone feel bad. Keep this invariant when modifying digest or b-side LLM prompts.
