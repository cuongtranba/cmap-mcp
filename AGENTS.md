# Agent instructions for cmap-mcp

cmap-mcp is a CLI (`cmap`) and an MCP server (`cmap mcp`) over one core library that reads the public JSON API of https://cmap.vn. Read `docs/design.md` (the upstream API and its bugs) and `docs/implementation-plan.md` (the approved plan) before changing code.

## Toolchain: Bun only

- Use Bun for everything: `bun install`, `bun run <script>`, `bun test`, `bun build`, `bun publish`, `bunx <tool>`.
- Never use pnpm, npm, yarn or npx in scripts, docs for contributors, or CI. (User-facing docs may show `npx` as an install option for people without Bun.)
- Run tasks through `package.json` scripts: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build`, `bun run test:live`, `bun run fixtures:record`. If a task has no script, add one.

## Portability

- Code in `src/` uses only Web and `node:` APIs (`fetch`, `node:fs`, `node:path`, `node:os`, `node:util`, `node:http`, `node:crypto`). Never `Bun.*` in `src/`: the npm bundle must also run under Node 22+ for `npx` users.
- `Bun.*` is allowed in `test/` and `scripts/`.

## Upstream rules (cmap.vn)

- Fetch events once per province (`/fe_api/event/event?get_all=1&page_size=100&province={id}`). Never page the global event list: its sort order is unstable and pages overlap.
- Never use `/fe_api/*/resolve/*`, `/fe_api/event/map` or `/fe_api/event/facets` for correctness: they are built with the same paging bug and miss 20+ events at any time. Resolve slugs from our snapshot; fetch details by id.
- At most 4 concurrent requests, a `cmap-mcp/<version>` User-Agent, retries with backoff on 429/5xx.
- Every upstream response is parsed with the zod schemas in `src/upstream/schemas.ts`, the single definition of the contract.

## Typing

- TypeScript strict mode. No `any`, no `as unknown as`, no non-null assertions to silence errors. Use `unknown` plus zod parsing at boundaries, discriminated unions, and explicit return types on exported functions.

## Tests

- Behaviour tests only, through public seams: the library entry `src/index.ts`, the CLI process, or an MCP client. Never import private modules from tests.
- No mocks: no `mock()`, `spyOn`, or global patches. Use the deterministic fake upstream in `test/fake-cmap.ts`.
- One test per promise; titles state behaviour; regressions name the bug. Never sleep; poll for public state.
- `bun test` runs offline. Live tests against cmap.vn live in `test/live/` and run only via `bun run test:live`.
- Do not test helpers, zod itself, SDK wiring or third-party behaviour.

## Git

- Never commit on `main`. Work on a feature branch in `.worktrees/<name>`.
- Before claiming done: `bun run lint && bun run typecheck && bun test && bun run build`.
