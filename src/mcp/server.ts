/**
 * MCP adapter over the cmap library: ten read-only tools, served over stdio or stateless
 * Streamable HTTP. Tools hold no logic of their own; each one calls one library method.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { z } from "zod";
import { type Cmap, createCmap, isCmapError, loadConfig, VERSION } from "../index.ts";
import {
  emptyInput,
  eventDetailOutput,
  eventsListOutput,
  eventsNearInput,
  eventsPageOutput,
  getEventInput,
  getOfferInput,
  getProvinceInput,
  listPlacesInput,
  listProvincesInput,
  listTaxonomiesInput,
  offerDetailOutput,
  offersPageOutput,
  placesOutput,
  provinceDetailOutput,
  provincesOutput,
  searchEventsInput,
  searchOffersInput,
  statusOutput,
  taxonomiesOutput,
} from "./schemas.ts";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const INSTRUCTIONS = `Data about cultural events, festivals, exhibitions, performances, sports and community activities, offers (deals), places and provinces in Vietnam, from cmap.vn (the culture map of Vietnam). The data is a cached copy refreshed every few minutes. Search with search_events (diacritics are optional), open one record with get_event, and always cite the "url" field of the records you use as the source (cmap.vn).`;

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function failure(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function asRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

/**
 * Run a library call; library errors become tool errors the agent can read and recover from.
 * `schema` is only used for typing: the library result must be assignable to the output schema.
 */
async function toolResult<S extends z.ZodType<object, object>>(
  _schema: S,
  run: () => Promise<z.input<S>>,
): Promise<ToolResult> {
  try {
    const output = await run();
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: asRecord(output),
    };
  } catch (error) {
    if (isCmapError(error)) return failure(`${error.code}: ${error.message}`);
    log(
      `unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return failure(`INTERNAL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Build a server whose tools read from `cmap`. Cheap: HTTP mode makes one per request. */
export function createMcpServer(cmap: Cmap): McpServer {
  const server = new McpServer(
    { name: "cmap-mcp", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "search_events",
    {
      title: "Search events",
      description:
        'Search cultural events, festivals, exhibitions, performances, sports events and community activities in Vietnam (from cmap.vn). Use this first for any "what is happening" question. The query matches names, descriptions, addresses, organizers and tags and works without Vietnamese diacritics ("ha noi" finds "Hà Nội"). All filters combine; "from"/"to" keep events whose dates overlap that range (use the same date twice for one day, e.g. 2026-11-24 for Vietnam Culture Day). "province" takes an id, slug, code or name; "type" and "category" take values from list_taxonomies (community activities are type "sinh hoat cong dong"). Returns { total, limit, offset, items }; each item has name, dates, province, type, address, free/paid, coordinates and a "url" to cite. Use get_event for the full text of one event.',
      inputSchema: searchEventsInput,
      outputSchema: eventsPageOutput,
      annotations: READ_ONLY,
    },
    (args) => toolResult(eventsPageOutput, () => cmap.searchEvents(args)),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get event",
      description:
        'Full detail of one event: description (plain text), ticket info, organizer, contact, transport, audience, official link, tags, every location and images. Accepts the event "id" (UUID) or "slug" from search_events or events_near. "source" is "live" when fetched from cmap.vn just now, "snapshot" when only the cached copy was available. Fails with NOT_FOUND for an unknown id or slug.',
      inputSchema: getEventInput,
      outputSchema: eventDetailOutput,
      annotations: READ_ONLY,
    },
    ({ idOrSlug, lang }) => toolResult(eventDetailOutput, () => cmap.getEvent(idOrSlug, { lang })),
  );

  server.registerTool(
    "events_near",
    {
      title: "Events near a point",
      description:
        'Events that have a location near a latitude/longitude, nearest first, each with "distanceKm". Use it for "what is on near me / near this landmark" once you know the coordinates (for example from list_provinces or list_places). "radiusKm" limits the distance; "from"/"to" limit the dates (YYYY-MM-DD). Returns { items }.',
      inputSchema: eventsNearInput,
      outputSchema: eventsListOutput,
      annotations: READ_ONLY,
    },
    (args) => toolResult(eventsListOutput, async () => ({ items: await cmap.eventsNear(args) })),
  );

  server.registerTool(
    "list_provinces",
    {
      title: "List provinces",
      description:
        'All 34 provinces and cities of Vietnam on cmap.vn with id, slug, code, name, coordinates, description and "eventCount". Use it to see where events are concentrated or to look up the exact id of a province. Returns { items }.',
      inputSchema: listProvincesInput,
      outputSchema: provincesOutput,
      annotations: READ_ONLY,
    },
    ({ lang }) =>
      toolResult(provincesOutput, async () => ({ items: await cmap.listProvinces({ lang }) })),
  );

  server.registerTool(
    "get_province",
    {
      title: "Get province",
      description:
        'One province with its description, coordinates, "upcomingEventCount" and the next 20 "upcomingEvents" (not yet over, soonest first). Accepts an id, slug, code or name, with or without diacritics ("Đà Nẵng", "da nang"). An ambiguous name fails with VALIDATION and lists the candidates.',
      inputSchema: getProvinceInput,
      outputSchema: provinceDetailOutput,
      annotations: READ_ONLY,
    },
    ({ idOrSlugOrName, lang }) =>
      toolResult(provinceDetailOutput, () => cmap.getProvince(idOrSlugOrName, { lang })),
  );

  server.registerTool(
    "list_taxonomies",
    {
      title: "List event types, categories and place types",
      description:
        'The valid values for the "type" and "category" filters of search_events and the "type" filter of list_places: { eventTypes, eventCategories, positionTypes }, each entry { id, slug, name }. Call it when you need to filter by type or category and do not know the exact names.',
      inputSchema: listTaxonomiesInput,
      outputSchema: taxonomiesOutput,
      annotations: READ_ONLY,
    },
    ({ lang }) => toolResult(taxonomiesOutput, () => cmap.listTaxonomies({ lang })),
  );

  server.registerTool(
    "search_offers",
    {
      title: "Search offers",
      description:
        'Search offers (deals and promotions) attached to events and places in Vietnam. The query works without diacritics; "province" takes an id, slug, code or name; "kind" is "event" or "position". Returns { total, limit, offset, items } with a "url" to cite. Use get_offer for the full text.',
      inputSchema: searchOffersInput,
      outputSchema: offersPageOutput,
      annotations: READ_ONLY,
    },
    (args) => toolResult(offersPageOutput, () => cmap.searchOffers(args)),
  );

  server.registerTool(
    "get_offer",
    {
      title: "Get offer",
      description:
        'Full detail of one offer including content and ticket text. Accepts the offer "id" or "slug" from search_offers. Fails with NOT_FOUND when unknown.',
      inputSchema: getOfferInput,
      outputSchema: offerDetailOutput,
      annotations: READ_ONLY,
    },
    ({ idOrSlug, lang }) => toolResult(offerDetailOutput, () => cmap.getOffer(idOrSlug, { lang })),
  );

  server.registerTool(
    "list_places",
    {
      title: "List places",
      description:
        'Places on cmap.vn such as museums, monuments and islands, with address, coordinates, type and a "url". Filter by free-text "query", "province" (id, slug, code or name) and place "type" (see list_taxonomies, positionTypes). Returns { items }.',
      inputSchema: listPlacesInput,
      outputSchema: placesOutput,
      annotations: READ_ONLY,
    },
    (args) => toolResult(placesOutput, async () => ({ items: await cmap.listPlaces(args) })),
  );

  server.registerTool(
    "get_sync_status",
    {
      title: "Data freshness",
      description:
        "How fresh the cached cmap.vn data is: last sync time, age in minutes, record counts (events, offers, places, provinces), warnings and the last sync error. Use it to tell the user how current the answers are or to diagnose missing data.",
      inputSchema: emptyInput,
      outputSchema: statusOutput,
      annotations: READ_ONLY,
    },
    () => toolResult(statusOutput, () => cmap.status()),
  );

  return server;
}

// --- lifecycle ------------------------------------------------------------------------

/** Logs go to stderr: in stdio mode stdout carries only the protocol. */
function log(message: string): void {
  process.stderr.write(`cmap mcp: ${message}\n`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function syncInBackground(cmap: Cmap, reason: string): void {
  cmap.sync().then(
    (report) => log(`${reason} sync ok: ${report.counts.events} events in ${report.durationMs} ms`),
    (error: unknown) =>
      log(`${reason} sync failed, keeping the last snapshot: ${describeError(error)}`),
  );
}

/**
 * Load the disk snapshot (syncing when there is none) and keep it fresh in the background. Tool
 * calls that arrive during the first sync wait for it, because the library shares one sync.
 */
async function keepFresh(cmap: Cmap, refreshMin: number): Promise<void> {
  const status = await cmap.status();
  if (status.syncedAt === null) {
    syncInBackground(cmap, "initial");
  } else {
    log(`loaded snapshot from ${status.snapshotPath} (${status.counts?.events ?? 0} events)`);
    if ((status.ageMinutes ?? 0) > refreshMin) syncInBackground(cmap, "startup");
  }
  setInterval(() => syncInBackground(cmap, "scheduled"), refreshMin * 60_000).unref();
}

/** The server answers from its snapshot; only the background timer refreshes it. */
function createServerCmap(): { cmap: Cmap; refreshMin: number } {
  const config = loadConfig();
  return {
    cmap: createCmap({ maxAgeMin: Number.MAX_SAFE_INTEGER }),
    refreshMin: config.refreshMin,
  };
}

export interface ListenAddress {
  host: string;
  port: number;
}

/** Run until stdin closes (stdio) or the process is signalled (HTTP). */
export async function startMcp(listen?: ListenAddress): Promise<void> {
  // A closed stderr (client gone) must not take the server down.
  process.stderr.on("error", () => undefined);
  const { cmap, refreshMin } = createServerCmap();
  if (listen === undefined) {
    await createMcpServer(cmap).connect(new StdioServerTransport());
    log(`stdio server ready (cmap-mcp ${VERSION})`);
  } else {
    await serveHttp(cmap, listen);
  }
  await keepFresh(cmap, refreshMin);
}

// --- HTTP -----------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function toWebRequest(req: IncomingMessage, url: URL, body: Buffer | undefined): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && body !== undefined;
  return new Request(url, {
    method: req.method ?? "GET",
    headers,
    ...(hasBody ? { body: body.toString("utf8") } : {}),
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  res.on("close", () => void reader.cancel().catch(() => undefined));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Stateless Streamable HTTP: a fresh server and transport answer each POST /mcp. */
async function handleMcp(
  cmap: Cmap,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const body = await readBody(req);
  if (body === undefined) {
    sendJson(res, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } });
    return;
  }
  const server = createMcpServer(cmap);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await sendWebResponse(res, await transport.handleRequest(toWebRequest(req, url, body)));
}

async function serveHttp(cmap: Cmap, listen: ListenAddress): Promise<void> {
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const route =
      url.pathname === "/mcp"
        ? handleMcp(cmap, req, res, url)
        : url.pathname === "/healthz" && req.method === "GET"
          ? cmap
              .status()
              .then((status) => sendJson(res, 200, { ok: true, version: VERSION, status }))
          : Promise.resolve(
              sendJson(res, 404, {
                error: { code: "NOT_FOUND", message: "Use POST /mcp or GET /healthz" },
              }),
            );
    route.catch((error: unknown) => {
      log(`request failed: ${describeError(error)}`);
      if (!res.headersSent)
        sendJson(res, 500, { error: { code: "INTERNAL", message: describeError(error) } });
      else res.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(listen.port, listen.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address() as AddressInfo;
  log(`listening on http://${address.address}:${address.port}/mcp`);

  const shutdown = (): void => {
    httpServer.close(() => process.exit(0));
    httpServer.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
