# cmap-mcp

[Tiếng Việt](README.md) | **English**

A command line tool (`cmap`) and an [MCP](https://modelcontextprotocol.io) server that give coding agents (Claude Code, Codex, Cursor and others) read access to the public data on [cmap.vn](https://cmap.vn), the culture map of Vietnam: cultural events, festivals, exhibitions, performances, sports and community activities, deals, places and provinces.

Both entry points are thin adapters over one core library, so they return the same data.

## Data and attribution

The data belongs to cmap.vn and its operator. This project does not host or redistribute it: it fetches the data at runtime from the site's public JSON API, keeps a local cache, and every record carries a `url` that links back to its page on cmap.vn. Please cite cmap.vn when you use the results. Requests are polite (at most 4 at a time, a `cmap-mcp/<version>` User-Agent, backoff on 429 and 5xx, one full refresh at most every few minutes). Check the site's terms or ask its operator before any commercial or public redistribution.

## Install

No installation is needed if you have Node 22+ or Bun:

```bash
npx -y cmap-mcp events search "ha noi"
bunx cmap-mcp events search "ha noi"
```

Other options:

- **Global install:** `npm install -g cmap-mcp` or `bun add -g cmap-mcp`, then run `cmap`.
- **Standalone binaries** (no Node or Bun needed) on [GitHub Releases](https://github.com/cuongtranba/cmap-mcp/releases): `cmap-linux-x64`, `cmap-linux-arm64`, `cmap-darwin-x64`, `cmap-darwin-arm64` and `cmap-windows-x64.exe`, with a `SHA256SUMS` file to verify them.
- **Docker:** `docker run -p 8787:8787 ghcr.io/cuongtranba/cmap-mcp` starts the MCP server in HTTP mode. The image is published for `linux/amd64` and `linux/arm64` with the tags `latest`, `<major>.<minor>` and `<version>` (for example `0.1.0`).
- **Agent skill:** `npx skills add cuongtranba/cmap-mcp` (or `bunx skills add cuongtranba/cmap-mcp`) teaches an agent when and how to call the CLI. See [skills/cmap/SKILL.md](skills/cmap/SKILL.md).

## CLI

```
cmap sync | cmap status
cmap events search [query] --province --type --category --from --to --free|--paid --highlight --limit --offset --lang
cmap events near <lat> <lng> [--radius-km] [--limit]
cmap event get <id|slug> [--lang]
cmap offers search [query] --province --kind --limit --offset
cmap offer get <id|slug>
cmap provinces | cmap province get <id|slug|name> | cmap places [--province --type] | cmap taxonomies
cmap mcp [--http host:port]
cmap --version | cmap --help | cmap <command> --help
```

Global flags: `--refresh` (sync from cmap.vn first), `--max-age <minutes>` (re-sync when the cache is older; default 60), `--text` (readable output instead of JSON), `--lang vi|en`.

```bash
cmap events search "ngay van hoa" --from 2026-11-24 --to 2026-11-24
cmap events search --province "Ha Noi" --free --limit 10 --text
cmap events near 21.0285 105.8542 --radius-km 5
cmap event get am-vang-dong-que-9TXHDc --lang en
cmap province get "da nang"
cmap offers search "bao tang"
cmap taxonomies
```

- Searches ignore Vietnamese accents (`ha noi` finds `Hà Nội`). Dates are `YYYY-MM-DD`. `--from`/`--to` keep events whose dates overlap the range.
- Output is pretty-printed JSON on stdout. Errors exit with code 1 and print `{ "error": { "code", "message" } }` on stderr (codes `NOT_FOUND`, `VALIDATION`, `UPSTREAM`, `SYNC_REJECTED`, `NO_SNAPSHOT`); usage mistakes exit with code 2 and print help.
- The first call syncs everything (about 2 to 6 seconds); later calls read the cache.

## MCP server

Ten read-only tools, one per library method: `search_events`, `get_event`, `events_near`, `list_provinces`, `get_province`, `list_taxonomies`, `search_offers`, `get_offer`, `list_places`, `get_sync_status`. Every tool has input and output schemas and returns `structuredContent`; library errors come back as tool results with `isError: true`.

Claude Code:

```bash
claude mcp add cmap -- npx -y cmap-mcp mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.cmap]
command = "npx"
args = ["-y", "cmap-mcp", "mcp"]
```

Any MCP client that takes a JSON config:

```json
{
  "mcpServers": {
    "cmap": { "command": "npx", "args": ["-y", "cmap-mcp", "mcp"] }
  }
}
```

**HTTP mode** (Streamable HTTP, stateless): `cmap mcp --http 127.0.0.1:8787` serves `POST /mcp` and `GET /healthz`. Use `--http :8787` to bind all interfaces, for example in a container:

```bash
docker run -p 8787:8787 -v cmap-cache:/data ghcr.io/cuongtranba/cmap-mcp
```

The image runs as a non-root user, keeps the cache in `/data` (`CMAP_CACHE_DIR=/data`) and has a health check on `GET /healthz`.

In stdio mode the server writes only protocol messages to stdout; logs go to stderr. It loads the cache at start (syncing first when there is none) and re-syncs in the background every `CMAP_REFRESH_MIN` minutes, keeping the last good data if a sync fails.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CMAP_BASE_URL` | `https://cmap.vn` | Upstream origin |
| `CMAP_CACHE_DIR` | `~/.cache/cmap-mcp` | Directory of `snapshot.json` |
| `CMAP_MAX_AGE_MIN` | `60` | CLI re-syncs when the cache is older than this many minutes |
| `CMAP_CONCURRENCY` | `4` | Simultaneous upstream requests |
| `CMAP_REFRESH_MIN` | `10` | MCP server background refresh interval, in minutes |

## How it works

A sync fetches the taxonomies, then **events once per province** (34 requests of up to 100 events), plus offers and places, validates every record with zod, removes duplicates and swaps the result in atomically (`snapshot.json`). Searches run on that snapshot, so they are instant, work without accents, and keep working when cmap.vn is slow. A failed or suspicious sync (more than 10% invalid records) keeps the previous snapshot. Only the long text of one event or offer is fetched on demand, by id.

The site's own list paging loses about 20 events (its sort order is unstable) and its `resolve`, `map` and `facets` endpoints have the same bug, so none of them is used for correctness. Details and the investigation are in [docs/design.md](docs/design.md).

## Development

Bun is the only toolchain.

```bash
bun install
bun run lint          # Biome
bun run typecheck     # tsc --noEmit
bun test              # offline, against a fake upstream (test/fake-cmap.ts)
bun run build         # dist/cli.js, runs on Node 22+
bun run build:bin     # standalone binary for this machine, dist/cmap
bun run build:binaries    # all five release binaries + SHA256SUMS in dist/bin
bun run test:live     # checks the real cmap.vn: schemas, key shape, 34 provinces, <=100 events each
bun run fixtures:record   # re-record test/fixtures from the live API
bun run contract:record   # re-record test/contract/shape.json after an intended upstream change
```

Read [AGENTS.md](AGENTS.md) before changing code.

## CI and releasing

GitHub Actions use Bun only (`oven-sh/setup-bun`, with the Bun version taken from `packageManager` in `package.json`).

- **`ci`** runs on every pull request and on pushes to `main`: `bun install --frozen-lockfile`, lint, typecheck, `bun test`, `bun run build`, then smoke tests (`node dist/cli.js --version` and `--help` on the runner's own Node, the linux-x64 binary's `--version`), `bun pm pack --dry-run` and a check that `bunx skills add ./ --list` lists `cmap`. It is the required status check for `main`.
- **`live-e2e`** runs the live tests (`bun run test:live`) against the real cmap.vn every day at 07:00 Vietnam time (00:00 UTC), on demand, and on pull requests that touch `src/upstream`, `src/snapshot`, `test/live` or `test/contract`. When a scheduled or manual run on `main` fails, it opens an issue labelled `upstream-drift` ("cmap.vn upstream changed: live e2e failing") with the run link and the last 150 lines of output, or comments on the one that is already open. When a later run passes, it closes that issue. After an intended upstream change, run `bun run contract:record` and commit the new `test/contract/shape.json`.
- **`release`** runs when a `v*` tag is pushed.

To release:

```bash
bun pm version patch   # or minor / major: bumps package.json, commits and tags vX.Y.Z
git push --follow-tags
```

The `release` workflow then:

1. **verify** fails unless the tag equals the `package.json` version, and runs the full `ci` checks again.
2. **npm** publishes with `bun publish --access public`, using the `NPM_TOKEN` repository secret. Set it once with `gh secret set NPM_TOKEN -R cuongtranba/cmap-mcp` (an npm automation token). `bun publish` cannot create provenance statements or use npm trusted publishing yet, so the package is published without provenance.
3. **binaries** attaches `cmap-linux-x64`, `cmap-linux-arm64`, `cmap-darwin-x64`, `cmap-darwin-arm64`, `cmap-windows-x64.exe` and `SHA256SUMS` to a GitHub Release with generated notes.
4. **docker** pushes `ghcr.io/cuongtranba/cmap-mcp` for `linux/amd64` and `linux/arm64` with the tags `<version>`, `<major>.<minor>` and `latest` (pre-release tags such as `v1.0.0-rc.1` do not move `latest`), using the built-in `GITHUB_TOKEN`.

Dependabot opens weekly update pull requests for GitHub Actions and Bun dependencies, grouping minor and patch updates.

## License

MIT, see [LICENSE](LICENSE). The data served by cmap.vn is not covered by this license.
