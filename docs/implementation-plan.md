# Plan: cmap-mcp, a CLI and MCP server for cmap.vn (Bun), with CI/CD, a live e2e check and an agent skill

## Context

cmap.vn, the culture map of Vietnam, has no official API. Its public `/fe_api/*` JSON API has two traps found during the investigation (see `PLAN.md` §1):
- **Paging loses events:** paging through the event list returns about 529 of 549 events because the sort order isn't stable. Querying per province, with at most 100 events per province, returns all of them.
- **The site's own lookups are wrong:** the map, the facet counts and slug resolution are built by the site with the same paging bug. At any moment 23–27 events are missing from them and their direct links return 404.

You want Claude Code, Codex and any other coding agent to use this data. Agents with a shell will call a CLI. Agents that use MCP or tool calls will use an MCP server built on the same core.

**Decisions so far:**
- A single npm package `cmap-mcp`, built on one core library, with two entry points: the `cmap` CLI and `cmap mcp` (stdio, or HTTP when given `--http`).
- **Bun only** (your instruction; this overrides the global pnpm rule for this repository). Bun handles installs, scripts, tests, bundling, compiled binaries, publishing (`bun publish`) and one-off tools (`bunx`). No pnpm, no npm CLI and no `setup-node` anywhere in the repo or CI. The published bundle still runs under Node, so people without Bun can use `npx`. CI checks this with the Node runtime that GitHub's runners already include.
- Public repo `cuongtranba/cmap-mcp`. The name is free, and `gh` is logged in with the `repo`, `workflow` and `write:packages` scopes.
- Releases go to npm, to GitHub Release binaries and to a GHCR Docker image.
- An agent skill in `skills/cmap/SKILL.md`, installable with `npx skills add cuongtranba/cmap-mcp`.
- A daily live e2e test against cmap.vn at 07:00 Vietnam time that opens a GitHub issue when the upstream API changes.

## Repository layout (new; the folder currently holds only `PLAN.md` and `screenshots/`)

```
package.json            # name cmap-mcp; bin {cmap, cmap-mcp} -> dist/cli.js; engines node>=22
tsconfig.json biome.json bun.lock .gitignore LICENSE(MIT) README.md AGENTS.md CLAUDE.md
src/
  index.ts              # public library API: createCmap({baseUrl, cachePath, ...}) -> {sync, status, events, offers, provinces, places, taxonomies}
  cli.ts                # bin entry (#!/usr/bin/env node), node:util parseArgs, JSON output
  config.ts             # env: CMAP_BASE_URL, CMAP_CACHE_DIR, CMAP_MAX_AGE_MIN, CMAP_CONCURRENCY, CMAP_REFRESH_MIN
  upstream/schemas.ts   # zod schemas for every /fe_api response (single source of the contract)
  upstream/client.ts    # fetch + retry/backoff on 429/5xx + p-limit(4) + zod parse + UA "cmap-mcp/<ver>"
  snapshot/sync.ts      # per-province crawl, dedupe, validation threshold, atomic swap
  snapshot/store.ts     # in-memory snapshot + disk JSON (~/.cache/cmap-mcp/snapshot.json), maxAge
  query/normalize.ts    # VN diacritic folding (NFD, strip marks, đ->d)
  query/search.ts       # filters (province/type/category/date overlap/free/highlight), paging, geo
  query/format.ts       # compact records: html->text, resolved names, url to cmap.vn
  mcp/server.ts         # McpServer + registerTool per library function; stdio + Streamable HTTP
skills/cmap/SKILL.md    # agent skill: when to use, `npx -y cmap-mcp ...` commands, output shape, MCP setup
test/
  fake-cmap.ts          # Bun.serve fake upstream serving fixtures (reproduces both upstream bugs)
  fixtures/*.json       # small trimmed recordings (≈10 events) from scripts/record-fixtures.ts
  library.test.ts cli.test.ts mcp.test.ts
  live/upstream.live.test.ts   # hits the real cmap.vn; excluded from `bun test` by default
  contract/shape.json   # recorded key shape of each endpoint, used to detect upstream drift
scripts/record-fixtures.ts scripts/build.ts
Dockerfile
.github/workflows/ci.yml live-e2e.yml release.yml
.github/dependabot.yml
docs/design.md          # PLAN.md moved here and updated for the CLI + MCP decision
docs/investigation/     # the hidden-events screenshots, with notes
```

Runtime dependencies are only `@modelcontextprotocol/server@2.4.0` (which brings `zod@^4`), `zod` and `p-limit`. Development dependencies are `typescript`, `@biomejs/biome`, `@types/bun` and `@modelcontextprotocol/client`, the last one for the MCP tests.

**Portability rule:** code in `src/` uses only Web and `node:` APIs (`fetch`, `node:fs`, `node:util`, `node:http`), never `Bun.*`, so the npm build runs under both `npx` (Node) and `bunx`. Only the tests and scripts use `Bun.serve` and `Bun.build`.

## Behaviour

**Sync**, as in PLAN.md §3:
1. Fetch the taxonomies (provinces, wards, event types, event categories, position types).
2. Fetch events for each of the 34 provinces with `page_size=100`. If a province has more than one page, page through it and record a warning.
3. Fetch offers and places, paging through every page (offers passed 100 in November 2026).
4. Remove duplicate events by `id`.
5. Validate with zod. If more than 10% of records fail, reject the whole sync and keep the previous snapshot.

A full sync takes about 6 seconds.
- **CLI:** each command loads the snapshot from disk. If it's missing or older than `--max-age` (default 60 minutes) it syncs first; `--refresh` forces a sync.
- **MCP server:** loads the disk snapshot at start-up, syncs in the background every `CMAP_REFRESH_MIN` minutes (default 10), and keeps the last good snapshot when a sync fails.

**Never** use `/fe_api/*/resolve`, `/event/map` or `/event/facets`, because they're affected by the site's paging bug. Slugs are resolved from the snapshot, and details are fetched with `/fe_api/{event|offer|position}/{id}?language=`, cached for 10 minutes.

**CLI** (JSON on stdout by default; `--text` gives a readable table; exit code 1 with a JSON error on stderr):
```
cmap sync | cmap status
cmap events search [query] --province --type --category --from --to --free|--paid --highlight --limit --offset --lang
cmap events near <lat> <lng> [--radius-km] [--limit]
cmap event get <id|slug> [--lang]
cmap offers search [query] --province --kind --limit --offset | cmap offer get <id|slug>
cmap provinces | cmap province get <id|slug|name> | cmap places [--province --type] | cmap taxonomies
cmap mcp [--http 0.0.0.0:8787]
```

**MCP tools.** Each tool maps one-to-one to a library function, using zod `inputSchema` and `outputSchema` and returning `structuredContent`: `search_events`, `get_event`, `events_near`, `list_provinces`, `get_province`, `list_taxonomies`, `search_offers`, `get_offer`, `list_places` and `get_sync_status`.

**Skill** (`skills/cmap/SKILL.md`): the frontmatter is `name: cmap` and a `description` that says when to use it (cultural events, festivals, exhibitions and deals in Vietnam, cmap.vn, and the 24/11 Vietnam Culture Day). The body covers:
- how to run it: `npx -y cmap-mcp …` or `bunx cmap-mcp …`;
- the commands, with examples and the output fields;
- that results are a cached copy and should name cmap.vn as the source;
- an alternative MCP setup: `claude mcp add cmap -- npx -y cmap-mcp mcp`, or a Codex `config.toml` entry.

## Tests (behaviour only, public seams, no mocks)

The offline tests run with `bun test` against the deterministic `fake-cmap` server. It serves fixtures and reproduces both upstream bugs: list pages that overlap, and a `resolve` endpoint that returns 404 for some slugs.
1. A sync whose list pages overlap still returns every event exactly once. This is the regression test for the paging bug.
2. `events search "ha noi mua roi"` finds the event with accents, and the province, type and date filters narrow the results.
3. A sync that fails partway through keeps the previous snapshot, and `status` reports the error.
4. `event get <slug>` works for an event whose upstream `resolve` returns 404. This is the regression test for the resolve bug.
5. `events near` sorts by distance and respects the radius.
6. The CLI: `cmap events search … ` prints valid JSON, and an unknown ID exits with code 1 and a JSON error. The test spawns `bun src/cli.ts` with `CMAP_BASE_URL` pointing at the fake server.
7. MCP: an MCP `Client` connected over stdio to `bun src/cli.ts mcp` sees the 10 tools, and `search_events` returns `structuredContent`.

The **live e2e test** (`bun run test:live`, against the real cmap.vn) is what tells us the upstream site has changed:
- every endpoint parses with the zod schemas;
- the key shape matches `test/contract/shape.json` (a missing or retyped key fails the test; a new key only produces a warning);
- 34 provinces are returned, at least 300 events in total, and no province has more than 100 events (the per-province assumption still holds);
- a sample of `get` by ID returns content;
- the real CLI and the MCP server answer searches.

It also prints an informational check of whether the resolve bug is still present.

## CI/CD (GitHub Actions; `oven-sh/setup-bun@v2`, with the Bun version pinned in `package.json`)

- **`ci.yml`** runs on pushes to `main` and on every PR. Steps:
  1. `bun install --frozen-lockfile`
  2. `bun run lint` (Biome)
  3. `bun run typecheck` (`tsc --noEmit`)
  4. `bun test`
  5. `bun run build`, which bundles for Node and compiles a Linux binary
  6. a smoke test: `node dist/cli.js --version` (the runner's own Node, proving `npx` users are fine) and `./cmap-linux-x64 status`
  7. `bun pm pack --dry-run`
  8. `bunx skills add ./ --list`, which must list `cmap`
- **`live-e2e.yml`** runs daily on `cron: "0 0 * * *"` (07:00 in Vietnam), when started by hand, and on PRs that touch `src/upstream/**` or `test/live/**`.
  - On a **scheduled** failure it opens or comments on a single issue labelled `upstream-drift` with `gh issue`, including the failing assertions.
  - When a later run passes, it closes that issue.
  - It needs `permissions: issues: write`.
- **`release.yml`** runs on a `v*` tag.
  1. A **verify** job checks that the tag matches the `package.json` version and runs the full CI.
  2. An **npm** job runs `bun publish --access public`, authenticated with `NPM_CONFIG_TOKEN` set from the `NPM_TOKEN` secret. `bun publish` can't create provenance statements or use npm's trusted publishing (OIDC) yet, so the package ships without provenance and the token stays in place. That is the cost of using Bun only.
  3. A **binaries** job builds with `bun build --compile` for `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64` and `bun-windows-x64`, adds `SHA256SUMS`, and creates the release with `gh release create --generate-notes`.
  4. A **docker** job uses buildx to build for linux/amd64 and linux/arm64 and pushes `ghcr.io/cuongtranba/cmap-mcp:{version,latest}` with `GITHUB_TOKEN` (`packages: write`). The image carries the label `org.opencontainers.image.source`, and the container runs `cmap mcp --http 0.0.0.0:8787`.
- **`dependabot.yml`**: weekly updates for GitHub Actions and the Bun/npm dependencies.
- **Releasing:** `bun pm version minor`, then `git push --follow-tags`. This is documented in the README.

## Git and repository steps (in this order)

1. `git init -b main` in `/home/cuong/Kanna/cmap`. Make a bootstrap commit containing `.gitignore` (which ignores `.worktrees/`, `dist/`, `node_modules/` and the cache), `LICENSE` (MIT), a stub `README.md`, `docs/design.md` (moved from `PLAN.md`) and `docs/investigation/` (the screenshots). This is the only commit made directly on `main`; a new repository needs one.
2. `gh repo create cuongtranba/cmap-mcp --public --source . --remote origin --push --description "CLI + MCP server for cmap.vn (Vietnam culture map) data"`.
3. `git worktree add .worktrees/initial-implementation -b feat/initial-implementation`. All implementation happens there.
4. Implementation, delegated in phases to the coding-agent subagent with this plan; I review each report:
   - (a) scaffold, tooling and `AGENTS.md`/`CLAUDE.md` (Bun only and never pnpm or npm, strict typing, and the test rules);
   - (b) schemas, client and fixture recorder, with fixtures recorded;
   - (c) sync and store;
   - (d) query, format and the library API;
   - (e) CLI;
   - (f) MCP server;
   - (g) the skill and README;
   - (h) tests and the live e2e test;
   - (i) the workflows, Dockerfile and dependabot.
5. Push the branch, open a PR, wait for CI to pass (`gh run watch`), and run `live-e2e` by hand on the branch.
6. Merge the PR and set `main` to require the `ci` check (`gh api` branch protection).
7. Cut the first release, `v0.1.0`. The binaries and GHCR jobs need nothing from you. The npm job needs the action from you described below.

## What you need to do

- **Add an npm token.** On npmjs.com, create a granular access token with read and write access to packages (it can be limited to `cmap-mcp` once the package exists), then run `gh secret set NPM_TOKEN -R cuongtranba/cmap-mcp`. Because we use `bun publish`, this token stays permanently. Until it's added, the npm job fails and the binaries and Docker jobs still run.
- If the GHCR package turns out to be private after the first push, switch it to public in the GitHub package settings.

## Verification (run in this session before I report the work done)

- **Local checks:** `bun run lint && bun run typecheck && bun test && bun run build` in the worktree, with the real output shown.
- **Live run:** `bun run test:live` against cmap.vn passes, and `bun src/cli.ts sync` reports about 549 events in under 10 seconds.
- **Node and packaging:** `node dist/cli.js events search "ha noi" --limit 3` (a Node runtime check only) and `bun pm pack --dry-run`, checking the file list.
- **MCP:** `bunx @modelcontextprotocol/inspector --cli bun dist/cli.js mcp --method tools/list` shows the 10 tools, and a call to `search_events` returns data.
- **Docker:** `docker build -t cmap-mcp . && docker run -p 8787:8787 cmap-mcp`, then an MCP `initialize` and `tools/list` request over HTTP.
- **Skill:** `bunx skills add ./ --list` locally, then `bunx skills add cuongtranba/cmap-mcp --list` after the push. For users, the README documents both `npx skills add cuongtranba/cmap-mcp` and the `bunx` form.
- **GitHub:** the PR's CI passes, a manual `live-e2e` run passes, and after the tag the release jobs pass and the assets, the GHCR image and the npm version (if a token was given) all exist.
