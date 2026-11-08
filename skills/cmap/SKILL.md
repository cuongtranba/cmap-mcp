---
name: cmap
description: Look up Vietnamese cultural events, festivals, exhibitions, performances, sports events, community activities, deals/offers, places and museums in Vietnam using data from cmap.vn (the culture map of Vietnam). Use when the user asks what is happening in a Vietnamese city or province, about festivals or events on a date (for example Ngày Văn hóa Việt Nam 24/11), free events, events near a location, offers or discounts at cultural venues, or mentions cmap.vn, "bản đồ văn hóa", lễ hội, triển lãm, sự kiện, sinh hoạt cộng đồng, or địa điểm văn hóa.
---

# cmap: cultural events and places in Vietnam

`cmap` is a command line tool over the public data of [cmap.vn](https://cmap.vn), the culture map of Vietnam: about 550 events (festivals, exhibitions, performances, sports, community activities), about 100 offers, places and the 34 provinces. Data is a cached copy of cmap.vn, refreshed automatically.

## How to run

```bash
npx -y cmap-mcp <command> [flags]     # Node 22+
bunx cmap-mcp <command> [flags]       # Bun
```

The first call syncs everything from cmap.vn (about 2 to 6 seconds). Later calls answer from the cache in `~/.cache/cmap-mcp/snapshot.json` and re-sync when it is older than 60 minutes (`--max-age <minutes>`, `--refresh` to force). Run `cmap --help` or `cmap <command> --help` for the full reference.

Output is pretty JSON on stdout. Add `--text` for a readable listing. Errors exit with code 1 and print `{ "error": { "code", "message" } }` on stderr; codes are `NOT_FOUND`, `VALIDATION` (message lists valid choices), `UPSTREAM`, `SYNC_REJECTED`, `NO_SNAPSHOT`. Usage mistakes exit with code 2.

## Commands

| Command | Purpose | Example |
|---|---|---|
| `events search [query]` | Search events with filters | `events search "ngay van hoa" --from 2026-11-24 --to 2026-11-24` |
| `events near <lat> <lng>` | Events nearest a coordinate | `events near 21.0285 105.8542 --radius-km 5` |
| `event get <id\|slug>` | Full detail of one event | `event get am-vang-dong-que-9TXHDc` |
| `offers search [query]` | Search offers and deals | `offers search "bao tang" --province "Ha Noi"` |
| `offer get <id\|slug>` | Full detail of one offer | `offer get <id>` |
| `provinces` | The 34 provinces with event counts | `provinces --text` |
| `province get <ref>` | One province and its upcoming events | `province get "da nang"` |
| `places [query]` | Museums, monuments, islands | `places --province "Ha Noi"` |
| `taxonomies` | Valid event types, categories, place types | `taxonomies` |
| `sync` / `status` | Refresh the cache / show cache age and counts | `status --text` |

Filters for `events search`: `--province`, `--type`, `--category`, `--from`, `--to` (dates `YYYY-MM-DD`), `--free` or `--paid`, `--highlight`, `--limit` (1-50, default 20), `--offset`. All commands that return text accept `--lang vi|en`.

## Output fields you will use

- Lists: `{ total, limit, offset, items: [...] }` (`events near`, `provinces`, `places` return `{ items }`).
- Event: `id`, `slug`, `name`, `description` (about 300 characters), `startDate`, `endDate`, `province { id, name }`, `type`, `categories`, `address`, `organizer`, `free`, `highlight`, `lat`, `lng`, `url`; `events near` adds `distanceKm`.
- `event get` adds `content` (full text), `ticket`, `contact`, `transport`, `audience`, `link`, `tags`, `locations`, `images`, and `source` (`live` or `snapshot`).
- Offer: `kind` (`event` or `position`), `name`, dates, `province`, `url`; `offer get` adds `content` and `ticket`.
- Province: `name`, `eventCount`, `url`; `province get` adds `upcomingEvents` and `upcomingEventCount`.

## Tips

- Search works without Vietnamese accents: `ha noi` finds `Hà Nội`, `am vang dong que` finds `Âm vang đồng quê`.
- Filter by province name, slug or id (`--province "Da Nang"`). Unknown provinces, types or categories fail with `VALIDATION` and list the valid choices; run `cmap taxonomies` to see types and categories. Community activities are the type `sinh hoat cong dong`.
- `--from` and `--to` select events whose dates overlap the range. For one day use the same date twice. Vietnam Culture Day is 24 November.
- Many events run for months, so combine `--from` with `--limit` instead of reading everything.
- Search results carry a short `description`; call `event get` for the full text, ticket and contact details.
- Always cite the `url` field (a cmap.vn page) and name cmap.vn as the source. Tell the user the data is a cached copy (`cmap status` shows its age).
- Negative coordinates: flags first, then `--`, then the numbers: `cmap events near --limit 5 -- -33.8 151.2`.

## Use as an MCP server instead

The same data is available as ten MCP tools (`search_events`, `get_event`, `events_near`, `list_provinces`, `get_province`, `list_taxonomies`, `search_offers`, `get_offer`, `list_places`, `get_sync_status`).

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

Any other MCP client:

```json
{
  "mcpServers": {
    "cmap": { "command": "npx", "args": ["-y", "cmap-mcp", "mcp"] }
  }
}
```

For a shared server use HTTP mode: `cmap mcp --http 0.0.0.0:8787` (endpoint `POST /mcp`, health check `GET /healthz`).

## Install this skill

```bash
npx skills add cuongtranba/cmap-mcp     # or: bunx skills add cuongtranba/cmap-mcp
```
