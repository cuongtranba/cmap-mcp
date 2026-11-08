/**
 * Deterministic fake of cmap.vn's /fe_api, serving the recorded fixtures. It reproduces the two
 * upstream bugs this project works around:
 *  1. the global event list returns overlapping pages and never reaches the last events;
 *  2. /fe_api/event/resolve/{slug} answers 404 for some events that exist (every event that has
 *     a recorded detail fixture).
 * It can also be told to answer 500 for a path prefix, to simulate a failing sync.
 */
import { join } from "node:path";
import { z } from "zod";

const FIXTURES = join(import.meta.dir, "fixtures");
const record = z.looseObject({ id: z.string(), slug: z.string() });
const event = record.extend({ province: z.string() });
const records = z.array(record);

async function load<S extends z.ZodType>(name: string, schema: S): Promise<z.output<S>> {
  return schema.parse(await Bun.file(join(FIXTURES, name)).json());
}

export interface FakeCmap {
  /** Origin to pass as `baseUrl`. */
  url: string;
  /** Every request path (with query) the fake has served, oldest first. */
  requests: string[];
  /** Ids and slugs of events whose upstream `resolve` returns 404. */
  resolve404Slugs: string[];
  /** Ids of events that have a recorded detail response. */
  detailIds: string[];
  /** Answer 500 to every request whose path starts with `prefix`; `null` clears the failure. */
  failOn(prefix: string | null): void;
  stop(): Promise<void>;
}

function page(results: readonly unknown[], pageSize: number, pageNumber: number, total: number) {
  return {
    page_size: pageSize,
    total_objects: total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    current_page_number: pageNumber,
    next: null,
    previous: null,
    results,
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function startFakeCmap(): Promise<FakeCmap> {
  const [provinces, types, categories, positionTypes, events, offers, positions] =
    await Promise.all([
      load("provinces.json", records),
      load("event-types.json", records),
      load("event-categories.json", records),
      load("position-types.json", records),
      load("events.json", z.array(event)),
      load("offers.json", records),
      load("positions.json", records),
    ]);
  const detailIds = events
    .map((e) => e.id)
    .filter((id) => Bun.file(join(FIXTURES, `event-detail-${id}.json`)).size > 0);
  const detailSlugs = events.filter((e) => detailIds.includes(e.id)).map((e) => e.slug);
  const requests: string[] = [];
  let failing: string | null = null;

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    requests.push(`${path}${url.search}`);
    if (failing !== null && path.startsWith(failing)) return json({ detail: "boom" }, 500);

    const pageSize = Number(url.searchParams.get("page_size") ?? "100");
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const slice = (rows: readonly unknown[]) =>
      json(
        page(
          rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
          pageSize,
          pageNumber,
          rows.length,
        ),
      );

    switch (path) {
      case "/fe_api/province/province":
        return slice(provinces);
      case "/fe_api/event/type":
        return slice(types);
      case "/fe_api/event/category":
        return slice(categories);
      case "/fe_api/position/type":
        return slice(positionTypes);
      case "/fe_api/offer/list":
        return slice(offers);
      case "/fe_api/position/position":
        return json(page(positions, positions.length, 1, positions.length));
      case "/fe_api/event/event": {
        const province = url.searchParams.get("province");
        if (province !== null) {
          return slice(events.filter((e) => e.province === province));
        }
        // Upstream bug: every page starts two rows earlier than the previous one ended, so pages
        // overlap and the final rows are unreachable by paging.
        const start = Math.max(0, (pageNumber - 1) * pageSize - (pageNumber - 1) * 2);
        return json(
          page(events.slice(start, start + pageSize), pageSize, pageNumber, events.length),
        );
      }
      default:
    }

    const resolve = /^\/fe_api\/event\/resolve\/(.+)$/.exec(path);
    if (resolve) {
      const slug = decodeURIComponent(resolve[1] ?? "");
      const found = events.find((e) => e.slug === slug);
      return found && !detailSlugs.includes(slug)
        ? json({ id: found.id })
        : json({ detail: "Not found." }, 404);
    }
    const detail = /^\/fe_api\/event\/([0-9a-f-]{36})$/.exec(path);
    if (detail) {
      const file = Bun.file(join(FIXTURES, `event-detail-${detail[1]}.json`));
      return (await file.exists()) ? json(await file.json()) : json({ detail: "Not found." }, 404);
    }
    return json({ detail: "Not found." }, 404);
  }

  const server = Bun.serve({ port: 0, fetch: handle });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    resolve404Slugs: detailSlugs,
    detailIds,
    failOn(prefix) {
      failing = prefix;
    },
    async stop() {
      await server.stop(true);
    },
  };
}
