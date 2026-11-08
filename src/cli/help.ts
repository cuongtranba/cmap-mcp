/** Help texts. Written for an AI agent that reads `cmap --help` once and must then use the tool. */

export const MAIN_HELP = `cmap - search the culture map of Vietnam (cmap.vn) from the command line

Events, festivals, exhibitions, performances, sports and community activities, deals (offers),
places and provinces. Data comes from the public API of https://cmap.vn, is cached on disk
(~/.cache/cmap-mcp/snapshot.json) and refreshed automatically when older than 60 minutes. The
first call syncs everything (about 2-6 seconds); later calls answer instantly from the cache.
Always credit cmap.vn as the source and cite each record's "url" field.

USAGE
  cmap <command> [arguments] [flags]

COMMANDS
  events search [query]     Search events (query is matched without Vietnamese accents)
  events near <lat> <lng>   Events closest to a coordinate, nearest first
  event get <id|slug>       Full detail of one event (content, ticket, contact, locations)
  offers search [query]     Search offers/deals
  offer get <id|slug>       Full detail of one offer
  provinces                 All 34 provinces with their event counts
  province get <ref>        One province (id, slug, code or name) with its upcoming events
  places [query]            Places (museums, monuments, islands...)
  taxonomies                Valid event types, categories and place types for filters
  sync                      Fetch everything from cmap.vn now and refresh the cache
  status                    Cache age, record counts, last sync error
  mcp [--http host:port]    Run as an MCP server (stdio, or Streamable HTTP with --http)

EVENT FILTERS (events search)
  --province <ref>     Province id, slug, code or name: "Ha Noi", "da nang", "Hà Nội"
  --type <ref>         Event type, see "cmap taxonomies" (e.g. "sinh hoat cong dong")
  --category <ref>     Event category, see "cmap taxonomies"
  --from <YYYY-MM-DD>  Keep events that end on or after this date
  --to <YYYY-MM-DD>    Keep events that start on or before this date
  --free | --paid      Only free events / only ticketed events
  --highlight          Only highlighted (featured) events
  --limit <n>          Results per page, 1-50 (default 20)
  --offset <n>         Skip n results (paging)

OTHER FLAGS
  --lang <vi|en>       Language of names and text (default vi; falls back to vi if no translation)
  --refresh            Force a sync from cmap.vn before running the command
  --max-age <minutes>  Re-sync first when the cache is older than this (default 60)
  --text               Human-readable output instead of JSON
  --help, -h           Help for a command: cmap events search --help
  --version, -v        Print the version

OUTPUT
  JSON on stdout (pretty-printed). Lists look like { "total", "limit", "offset", "items": [...] }.
  Errors: exit code 1 and { "error": { "code", "message" } } on stderr. Codes: NOT_FOUND,
  VALIDATION, UPSTREAM, SYNC_REJECTED, NO_SNAPSHOT. Usage mistakes exit with code 2.

EXAMPLES
  cmap events search "ngay van hoa" --from 2026-11-24 --to 2026-11-24
  cmap events search --province "Ha Noi" --free --limit 10
  cmap events search festival --lang en --text
  cmap events near 21.0285 105.8542 --radius-km 5
  cmap event get am-vang-dong-que-9TXHDc
  cmap province get "da nang"
  cmap offers search "bao tang"
  cmap taxonomies

ENVIRONMENT
  CMAP_CACHE_DIR      Cache directory (default ~/.cache/cmap-mcp)
  CMAP_MAX_AGE_MIN    Default for --max-age (default 60)
  CMAP_BASE_URL       Upstream origin (default https://cmap.vn)
  CMAP_CONCURRENCY    Parallel upstream requests (default 4)
  CMAP_REFRESH_MIN    MCP server background refresh interval in minutes (default 10)

Negative coordinates: give the flags first, then "--", then the numbers:
  cmap events near --limit 5 -- -33.8 151.2
`;

const DATA_FLAGS = `
  --lang <vi|en>       Language of names and text (default vi)
  --refresh            Force a sync from cmap.vn first
  --max-age <minutes>  Re-sync first when the cache is older than this (default 60)
  --text               Human-readable output instead of JSON`;

export const COMMAND_HELP: Readonly<Record<string, string>> = {
  "events search": `cmap events search [query] [flags]

Search events (cultural events, festivals, exhibitions, performances, sports, community
activities). The query is matched against names, descriptions, addresses, organizers and tags,
ignoring Vietnamese accents ("ha noi" finds "Hà Nội"). All filters combine with AND.

FLAGS
  --province <ref>     Province id, slug, code or name
  --type <ref>         Event type id, slug or name (see "cmap taxonomies")
  --category <ref>     Event category id, slug or name
  --from <YYYY-MM-DD>  Events that end on or after this date
  --to <YYYY-MM-DD>    Events that start on or before this date
  --free | --paid      Only free / only ticketed events
  --highlight          Only highlighted events
  --limit <n>          1-50, default 20
  --offset <n>         Paging offset${DATA_FLAGS}

OUTPUT  { total, limit, offset, items: [{ id, slug, name, description, startDate, endDate,
  province, type, categories, address, organizer, free, highlight, lat, lng, thumbnail, url }] }

EXAMPLES
  cmap events search "am vang dong que"
  cmap events search --province "Ha Noi" --from 2026-11-24 --to 2026-11-30 --limit 5
  cmap events search --type "sinh hoat cong dong" --free
`,

  "events near": `cmap events near <lat> <lng> [--radius-km <km>] [--limit <n>] [flags]

Events with a location near a coordinate, nearest first. Each item has a "distanceKm" field.
Without --radius-km there is no distance limit. For negative numbers put the flags first, then "--": cmap events near --limit 5 -- -33.8 151.2

FLAGS
  --radius-km <km>     Only events within this many kilometres
  --limit <n>          1-50, default 20
  --from / --to        Date range filter, YYYY-MM-DD (same meaning as in events search)${DATA_FLAGS}

EXAMPLE
  cmap events near 21.0285 105.8542 --radius-km 5 --limit 10
`,

  "event get": `cmap event get <id|slug> [--lang vi|en] [flags]

Full detail of one event: everything in the search result plus content (plain text), ticket,
organizationLevel, contact, transport, audience, link, tags, all locations, images, likes, views.
"source" is "live" (fetched from cmap.vn now) or "snapshot" (cached, when cmap.vn was unreachable).
Accepts the event id (UUID) or its slug. Exit code 1 with NOT_FOUND when unknown.${DATA_FLAGS}

EXAMPLE
  cmap event get am-vang-dong-que-9TXHDc --lang en
`,

  "offers search": `cmap offers search [query] [flags]

Search offers (deals and promotions linked to events and places).

FLAGS
  --province <ref>     Province id, slug, code or name
  --kind <event|position>  Offer attached to an event, or to a place
  --limit <n>          1-50, default 20
  --offset <n>         Paging offset${DATA_FLAGS}

EXAMPLE
  cmap offers search "bao tang" --province "Ha Noi"
`,

  "offer get": `cmap offer get <id|slug> [flags]

Full detail of one offer, including content and ticket text. Exit code 1 with NOT_FOUND when unknown.${DATA_FLAGS}
`,

  provinces: `cmap provinces [flags]

All provinces (34), ordered as on cmap.vn, each with "eventCount" and a cmap.vn "url".${DATA_FLAGS}
`,

  "province get": `cmap province get <id|slug|code|name> [flags]

One province with its description, coordinates, "upcomingEventCount" and the next 20
"upcomingEvents" (not yet over, soonest first). Names work with or without accents.
An ambiguous reference is a VALIDATION error that lists the candidates.${DATA_FLAGS}

EXAMPLE
  cmap province get "Hue"
`,

  places: `cmap places [query] [--province <ref>] [--type <ref>] [flags]

Places such as museums, monuments and islands. Filter by province and place type (see
"cmap taxonomies" for the types).

FLAGS
  --province <ref>     Province id, slug, code or name
  --type <ref>         Place type id, slug or name${DATA_FLAGS}

EXAMPLE
  cmap places --province "Ha Noi"
`,

  taxonomies: `cmap taxonomies [flags]

The valid values for the --type and --category event filters and for the place --type filter:
{ eventTypes, eventCategories, positionTypes }, each entry { id, slug, name }.${DATA_FLAGS}
`,

  sync: `cmap sync

Fetch everything from cmap.vn (one request per province, plus offers, places and taxonomies, at
most 4 in parallel) and replace the cache. Prints the sync report: counts, duration, rejected
records, warnings. If the sync fails the previous cache is kept.
`,

  status: `cmap status [--text]

Cache location, when it was last synced, its age in minutes, whether it is stale, record counts,
warnings and the last sync error. Does not contact cmap.vn.
`,

  mcp: `cmap mcp [--http <host:port>]

Run the MCP server exposing the same data as tools: search_events, get_event, events_near,
list_provinces, get_province, list_taxonomies, search_offers, get_offer, list_places and
get_sync_status.

  (no flag)            stdio transport; logs go to stderr, stdout carries only the protocol
  --http 127.0.0.1:8787  Streamable HTTP, stateless: POST /mcp, GET /healthz
  --http :8787         Same, bound to 0.0.0.0 (use this in containers)

The server loads the cache at start (syncing first when missing) and re-syncs in the background
every CMAP_REFRESH_MIN minutes (default 10), keeping the last good data when a sync fails.

CLIENT SETUP
  claude mcp add cmap -- npx -y cmap-mcp mcp
`,
};

export const GROUP_HELP: Readonly<Record<string, readonly string[]>> = {
  events: ["events search", "events near"],
  event: ["event get"],
  offers: ["offers search"],
  offer: ["offer get"],
  province: ["province get"],
};
