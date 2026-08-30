# grits

> Typed, backend-independent Git repository API for filesystem and in-memory implementations.

## Quick start

```bash
git clone https://github.com/<you>/grits.git ~/repos/grits
cd ~/repos/grits
npm install
npm run build
npm link    # makes `grits` available globally
```

## Commands

```bash
grits --help
grits doctor          # health check (use --json for machine output)
grits schema          # machine-readable command catalog
grits schema --summary
grits update          # git pull, install dependencies, and rebuild
```

## Questions and tasks it can handle

- "What commands does grits expose for agents?"
- "Is my local environment healthy enough to run grits?"
- "Show me the exact JSON contract before I automate against this CLI."
- "Which commands are read-only and which ones mutate state?"

## Conventions

- **Lean deps.** Runtime deps stay small (currently 3: chalk, commander, zod).
  Add a runtime dep only with a clear reason — every dep is supply-chain risk.
- **Registry first.** `src/registry.ts` is the command source of truth for
  `schema`, docs, help examples, and generated skills.
- **`doctor` first.** Every CLI ships a `doctor` command that returns
  `CheckResult[]` (name, ok, detail, hint). Hints carry remediation text.
- **`schema` first.** Every CLI ships a `schema` command in v0.1.0 so
  agents can discover the command surface without scraping help text.
- **`--json` everywhere.** Any command that produces output supports
  `--json` for machine-readable mode.
- **Semantic verbs.** Product/API CLIs expose stable intent-level commands
  instead of raw HTTP, raw exec, or request-template passthrough.
- **Plan → preview → confirm → apply** for any command that mutates state on
  disk or remote. Silent auto-apply is an anti-pattern.

## Development

```bash
npm run build               # lint + test type-check -> tsc -> dist/
npm run lint                # type-check (src + test)
npm test                    # all tests
npm run test:unit           # unit only
npm run test:integration    # integration only
npm run clean               # remove dist/
```

CI runs on Ubuntu + Windows via GitHub Actions (`.github/workflows/ci.yml`).

## Project structure

```
src/
  cli.ts              # Entry point — Commander.js program
  registry.ts         # Command catalog for schema/docs/skill parity
  commands/           # One file per CLI command
test/
  run.mjs             # Cross-platform test runner (HOME-sandboxed)
  tsconfig.json       # Test type-check config
  unit/               # Unit tests (*.test.ts)
  integration/        # Integration tests (*.test.ts)
```

## License

MIT
