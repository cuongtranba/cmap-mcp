import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCmap } from "../src/index.ts";
import { type FakeCmap, startFakeCmap } from "./fake-cmap.ts";

// Fixture events (test/fixtures/events.json), identified by the first 8 characters of their id.
const EVENT_COUNT = 10;
const AM_VANG_DONG_QUE = "1c1939af"; // Hà Nội, 2026-02-01..2026-12-31
const COMMUNITY_EVENT = "d7cde370"; // Hà Nội, community activity
const CORRUPT_LAT_EVENT = "a5a98ca3"; // lat 210107 upstream: geo search must ignore it
const HANOI_EVENTS = ["d7cde370", "1c1939af", "a5a98ca3", "37bbcd0e"];
const HANOI = { lat: 21.0285, lng: 105.8542 };

let fake: FakeCmap;
const tempDirs: string[] = [];

beforeAll(async () => {
  fake = await startFakeCmap();
});

afterAll(async () => {
  await fake.stop();
});

afterEach(async () => {
  fake.failOn(null);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

async function newCmap() {
  const cacheDir = await mkdtemp(join(tmpdir(), "cmap-test-"));
  tempDirs.push(cacheDir);
  return createCmap({ baseUrl: fake.url, cacheDir, retries: 1, retryDelayMs: 1 });
}

const shortId = (id: string): string => id.slice(0, 8);

describe("cmap library", () => {
  test("sync returns every event exactly once although the global list pages overlap (regression: unstable upstream paging)", async () => {
    const cmap = await newCmap();

    const report = await cmap.sync();
    const { total, items } = await cmap.searchEvents({ limit: 50 });

    expect(report.counts.events).toBe(EVENT_COUNT);
    expect(total).toBe(EVENT_COUNT);
    expect(new Set(items.map((e) => e.id)).size).toBe(EVENT_COUNT);
  });

  test("searchEvents finds accented events from an unaccented query and narrows by province, type and date", async () => {
    const cmap = await newCmap();
    await cmap.sync();

    const unaccented = await cmap.searchEvents({ query: "am vang dong que" });
    expect(unaccented.items.map((e) => shortId(e.id))).toEqual([AM_VANG_DONG_QUE]);
    expect(unaccented.items[0]?.name).toBe("Âm vang đồng quê");

    const hanoi = await cmap.searchEvents({ province: "ha noi", limit: 50 });
    expect(hanoi.total).toBe(HANOI_EVENTS.length);
    expect(hanoi.items.every((e) => e.province?.name === "Hà Nội")).toBe(true);

    const community = await cmap.searchEvents({ type: "sinh hoat cong dong" });
    expect(community.items.map((e) => shortId(e.id))).toEqual([COMMUNITY_EVENT]);
    expect(community.items[0]?.url).toContain("/sinh-hoat-cong-dong/");

    const onThe24th = await cmap.searchEvents({ from: "2026-11-24", to: "2026-11-24", limit: 50 });
    expect(onThe24th.total).toBe(4);
    expect(onThe24th.items.every((e) => (e.endDate ?? "") >= "2026-11-24")).toBe(true);
    expect(onThe24th.items.every((e) => (e.startDate ?? "") <= "2026-11-24")).toBe(true);

    const paid = await cmap.searchEvents({ free: false, limit: 50 });
    expect(paid.items.length).toBeGreaterThan(0);
    expect(paid.items.every((e) => !e.free)).toBe(true);
  });

  test("a sync that fails mid-way keeps the previous snapshot and status reports the error", async () => {
    const cmap = await newCmap();
    const first = await cmap.sync();

    fake.failOn("/fe_api/offer/list");
    await expect(cmap.sync()).rejects.toMatchObject({ code: "UPSTREAM" });

    const status = await cmap.status();
    expect(status.lastError?.message).toContain("/fe_api/offer/list");
    expect(status.syncedAt).toBe(first.syncedAt);
    expect(status.counts).toEqual(first.counts);
    expect((await cmap.searchEvents({ limit: 50 })).total).toBe(EVENT_COUNT);
  });

  test("getEvent by slug works for an event whose upstream resolve returns 404 (regression: upstream resolve bug)", async () => {
    const cmap = await newCmap();
    await cmap.sync();
    expect(fake.resolve404Slugs.length).toBeGreaterThan(0);

    for (const slug of fake.resolve404Slugs) {
      const event = await cmap.getEvent(slug);

      expect(event.slug).toBe(slug);
      expect(event.source).toBe("live");
      expect(event.content.length).toBeGreaterThan(0);
    }
    expect(fake.requests.some((r) => r.startsWith("/fe_api/event/resolve/"))).toBe(false);
  });

  test("eventsNear orders by distance, respects radiusKm and ignores corrupt coordinates", async () => {
    const cmap = await newCmap();
    await cmap.sync();

    const everywhere = await cmap.eventsNear({ ...HANOI, limit: 50 });
    const distances = everywhere.map((e) => e.distanceKm ?? Number.NaN);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(everywhere.some((e) => shortId(e.id) === CORRUPT_LAT_EVENT)).toBe(false);

    const withinRadius = await cmap.eventsNear({ ...HANOI, radiusKm: 30, limit: 50 });
    expect(withinRadius.length).toBeGreaterThan(0);
    expect(withinRadius.length).toBeLessThan(everywhere.length);
    expect(withinRadius.every((e) => (e.distanceKm ?? Number.POSITIVE_INFINITY) <= 30)).toBe(true);
    expect(withinRadius.every((e) => HANOI_EVENTS.includes(shortId(e.id)))).toBe(true);
  });
});
