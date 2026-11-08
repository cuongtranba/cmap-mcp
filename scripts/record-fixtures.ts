/**
 * Records trimmed real responses from cmap.vn into test/fixtures/*.json for the offline tests.
 * Re-run (`bun run fixtures:record`) when the upstream contract changes.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { UpstreamClient } from "../src/upstream/client.ts";

const BASE_URL = process.env.CMAP_BASE_URL ?? "https://cmap.vn";
const OUT_DIR = join(import.meta.dir, "..", "test", "fixtures");
const TARGET_EVENTS = 10;
const PROVINCES_KEPT = 3;

const client = new UpstreamClient({ baseUrl: BASE_URL, concurrency: 4 });

const record = z.looseObject({ id: z.string() });
const events = z.looseObject({
  id: z.string(),
  slug: z.string(),
  province: z.string(),
  type: z.string().nullish(),
  charge: z.boolean().nullish(),
  start_time: z.string().nullish(),
  lat: z.number().nullish(),
  more_location_list: z.array(z.unknown()).nullish(),
  translations: z.looseObject({ vi: z.looseObject({ name: z.string() }) }),
});
const eventPage = z.looseObject({
  total_pages: z.number(),
  results: z.array(events),
});
const listPage = z.looseObject({ results: z.array(record) });
const offers = z.looseObject({
  results: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
});

async function list(path: string, params: Record<string, string | number>): Promise<unknown[]> {
  const page = await client.get(path, params, listPage);
  return page.results;
}

async function write(name: string, data: unknown): Promise<void> {
  await Bun.write(join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
}

await mkdir(OUT_DIR, { recursive: true });
for (const file of await readdir(OUT_DIR)) await rm(join(OUT_DIR, file));

const [provinces, eventTypes, eventCategories, positionTypes, positions] = await Promise.all([
  list("/fe_api/province/province", {}),
  list("/fe_api/event/type", {}),
  list("/fe_api/event/category", {}),
  list("/fe_api/position/type", {}),
  list("/fe_api/position/position", { all: 1, language: "vi" }),
]);

// Per-province crawl: the only reliable way to enumerate every event (see docs/design.md §1).
const provinceIds = provinces.map((p) => record.parse(p).id);
const perProvince = await Promise.all(
  provinceIds.map(async (province) => {
    const page = await client.get(
      "/fe_api/event/event",
      { get_all: 1, page_size: 100, province },
      eventPage,
    );
    if (page.total_pages > 1) console.warn(`province ${province} has ${page.total_pages} pages`);
    return page.results;
  }),
);
const allEvents = perProvince.flat();

const keptProvinces = perProvince
  .map((results, index) => ({ id: provinceIds[index] ?? "", count: results.length }))
  .sort((a, b) => b.count - a.count)
  .slice(0, PROVINCES_KEPT)
  .map((p) => p.id);
const pool = allEvents.filter((e) => keptProvinces.includes(e.province));

const communityType = eventTypes
  .map((t) => z.looseObject({ id: z.string(), slug: z.string() }).parse(t))
  .find((t) => t.slug.startsWith("sinh-hoat-cong-dong"))?.id;

const picked = new Map<string, (typeof pool)[number]>();
function pick(predicate: (e: (typeof pool)[number]) => boolean): void {
  const found = pool.find((e) => predicate(e) && !picked.has(e.id));
  if (found) picked.set(found.id, found);
}
pick((e) => e.type === communityType);
pick((e) => e.charge === true);
pick((e) => (e.more_location_list?.length ?? 0) > 0);
pick((e) => typeof e.lat === "number" && Math.abs(e.lat) > 90);
// Fill the rest round-robin over provinces, spreading start dates.
const byDate = [...pool].sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
const stride = Math.max(1, Math.floor(byDate.length / TARGET_EVENTS));
for (let i = 0; picked.size < TARGET_EVENTS && i < byDate.length; i += stride) {
  const candidate = byDate[i];
  if (candidate) picked.set(candidate.id, candidate);
}
const keptEvents = [...picked.values()];
const keptIds = new Set(keptEvents.map((e) => e.id));

const offerPage = await client.get("/fe_api/offer/list", { page: 1, page_size: 100 }, offers);
const keptOffers = offerPage.results.filter((o) => o.kind === "position" || keptIds.has(o.id));

const paidEvent = keptEvents.find((e) => e.charge === true);
const otherEvent = keptEvents.find((e) => e.id !== paidEvent?.id && e.type !== communityType);
const detailEvents = [paidEvent, otherEvent].filter(
  (e): e is (typeof keptEvents)[number] => e !== undefined,
);
for (const event of detailEvents) {
  const detail = await client.get(`/fe_api/event/${event.id}`, { language: "vi" }, z.unknown());
  await write(`event-detail-${event.id}.json`, detail);
}
const firstPosition = positions[0] ? record.parse(positions[0]) : undefined;
if (firstPosition) {
  const detail = await client.get(
    `/fe_api/position/${firstPosition.id}`,
    { language: "vi" },
    z.unknown(),
  );
  await write("position-detail.json", detail);
}

const keptProvinceRecords = provinces.filter((p) => keptProvinces.includes(record.parse(p).id));
await write("provinces.json", keptProvinceRecords);
await write("event-types.json", eventTypes);
await write("event-categories.json", eventCategories);
await write("position-types.json", positionTypes);
await write("events.json", keptEvents);
await write("offers.json", keptOffers);
await write("positions.json", positions);
await write("meta.json", {
  recordedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  totalUpstreamEvents: allEvents.length,
});

console.log(
  `recorded ${keptEvents.length} events across ${keptProvinceRecords.length} provinces, ` +
    `${keptOffers.length} offers, ${positions.length} positions, ${detailEvents.length} event details`,
);
