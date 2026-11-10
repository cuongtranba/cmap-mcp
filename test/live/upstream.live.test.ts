/**
 * Live contract check against the real https://cmap.vn (`bun run test:live`, never part of
 * `bun test`). A daily CI job runs it and pastes failures into a GitHub issue, so every failure
 * message says what changed upstream and what to look at.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import {
  compareShapes,
  contractShapeSchema,
  fetchEventDetails,
  getRawJson,
  sampleIds,
  shapesFrom,
} from "../../scripts/contract-shape.ts";
import { type Cmap, createCmap, isCmapError, type SyncReport } from "../../src/index.ts";

setDefaultTimeout(180_000);

const BASE_URL = process.env.CMAP_BASE_URL ?? "https://cmap.vn";
const ROOT = join(import.meta.dir, "..", "..");
const MAX_REJECTED = 5;
const EXPECTED_PROVINCES = 34;
const MIN_EVENTS = 300;
const PAGE_SIZE = 100;
const DETAIL_SAMPLE = 3;
const RESOLVE_SAMPLE = 20;

let cacheDir: string;
let cmap: Cmap;
let sync: { report: SyncReport } | { error: string };

beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "cmap-live-"));
  cmap = createCmap({ baseUrl: BASE_URL, cacheDir });
  try {
    sync = { report: await cmap.sync() };
  } catch (error) {
    sync = { error: isCmapError(error) ? `${error.code}: ${error.message}` : String(error) };
  }
});

afterAll(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

/** The sync report, or a failure that explains why every dependent check cannot run. */
function syncReport(): SyncReport {
  if ("error" in sync) {
    throw new Error(
      `Sync against ${BASE_URL} failed, so the upstream API contract has probably changed: ${sync.error}\n` +
        "Check which endpoint changed (see the message), compare with src/upstream/schemas.ts and docs/design.md.",
    );
  }
  return sync.report;
}

async function snapshotJson(): Promise<unknown> {
  return JSON.parse(await readFile((await cmap.status()).snapshotPath, "utf8"));
}

async function allEvents(): Promise<{ slug: string }[]> {
  const events: { slug: string }[] = [];
  for (let offset = 0; ; offset += 50) {
    const { items, total } = await cmap.searchEvents({ limit: 50, offset });
    events.push(...items);
    if (offset + 50 >= total) return events;
  }
}

describe("cmap.vn upstream contract", () => {
  test("every endpoint used by sync parses with the zod schemas", () => {
    const report = syncReport();

    expect(
      report.rejected,
      `${report.rejected} upstream records failed the zod schemas in src/upstream/schemas.ts ` +
        `(allowed: ${MAX_REJECTED}). Warnings: ${report.warnings.slice(0, 5).join(" | ")}`,
    ).toBeLessThanOrEqual(MAX_REJECTED);
  });

  test("the key shape of every endpoint still matches test/contract/shape.json", async () => {
    syncReport();
    const recorded = contractShapeSchema.parse(
      JSON.parse(await readFile(join(ROOT, "test", "contract", "shape.json"), "utf8")),
    );
    const snapshot = await snapshotJson();
    const ids = z
      .object({ events: z.array(z.object({ id: z.string() })) })
      .parse(snapshot)
      .events.map((e) => e.id);
    const details = await fetchEventDetails(BASE_URL, sampleIds(ids, DETAIL_SAMPLE));

    const { failures, warnings } = compareShapes(recorded.endpoints, shapesFrom(snapshot, details));

    for (const warning of warnings) console.warn(`[contract] ${warning}`);
    expect(
      failures,
      `The cmap.vn API changed in a way our code depends on (recorded ${recorded.recordedAt}):\n` +
        `${failures.join("\n")}\n` +
        "If the change is intended, adapt src/upstream/schemas.ts and run `bun run contract:record`.",
    ).toEqual([]);
  });

  test("34 provinces, at least 300 events and at most 100 events per province", async () => {
    const report = syncReport();
    const provinces = await cmap.listProvinces();

    expect(
      Math.abs(provinces.length - EXPECTED_PROVINCES),
      `Expected about ${EXPECTED_PROVINCES} provinces (+-2), got ${provinces.length}. ` +
        "Upstream restructured its provinces; review the per-province sync in src/snapshot/sync.ts.",
    ).toBeLessThanOrEqual(2);
    expect(
      report.counts.events,
      `Only ${report.counts.events} events synced, expected at least ${MIN_EVENTS}.`,
    ).toBeGreaterThanOrEqual(MIN_EVENTS);

    const tooBig = provinces.filter((p) => p.eventCount > PAGE_SIZE);
    // Only per-province event paging breaks the assumption. Offers (103 on 2026-11-10) and
    // other lists page stably and the sync pages through them.
    const paged = report.warnings.filter((w) =>
      /^\/fe_api\/event\/event .* spans \d+ pages/.test(w),
    );
    expect(
      [...tooBig.map((p) => `${p.name} has ${p.eventCount} events`), ...paged],
      `The per-province paging assumption (at most ${PAGE_SIZE} events per province, one request each) no longer holds. ` +
        "This is the key upstream-change signal: review docs/design.md section 1 and the sync in src/snapshot/sync.ts.",
    ).toEqual([]);
  });

  test("getEvent by id returns non-empty content for three sampled events", async () => {
    syncReport();
    const { total } = await cmap.searchEvents({ limit: 1 });
    const offsets = [0, Math.floor(total / 2), total - 1];
    const empty: string[] = [];
    for (const offset of offsets) {
      const { items } = await cmap.searchEvents({ limit: 1, offset });
      const id = items[0]?.id ?? "";
      const event = await cmap.getEvent(id);
      if (event.source === "snapshot") console.warn(`[detail] ${id} fell back to the snapshot`);
      if (event.content.trim() === "" || event.name.trim() === "") empty.push(id);
    }

    expect(
      empty,
      `getEvent returned empty content for event ids: ${empty.join(", ")}. ` +
        "Check GET /fe_api/event/{id}?language=vi and formatEventDetail in src/query/format.ts.",
    ).toEqual([]);
  });

  test("the CLI and the MCP server both answer a search against the synced data", async () => {
    syncReport();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env))
      if (value !== undefined) env[key] = value;
    env.CMAP_BASE_URL = BASE_URL;
    env.CMAP_CACHE_DIR = cacheDir;

    const cli = Bun.spawn(["bun", "src/cli.ts", "events", "search", "ha noi", "--limit", "3"], {
      cwd: ROOT,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ]);
    expect(code, `CLI failed (exit ${code}): ${stderr}`).toBe(0);
    const page = z.object({ items: z.array(z.object({ id: z.string() })) });
    expect(page.parse(JSON.parse(stdout)).items.length).toBeGreaterThanOrEqual(1);

    const client = new Client({ name: "cmap-live", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["src/cli.ts", "mcp"],
        cwd: ROOT,
        env,
        stderr: "ignore",
      }),
    );
    try {
      const result = await client.callTool({
        name: "search_events",
        arguments: { query: "ha noi", limit: 3 },
      });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(page.parse(result.structuredContent).items.length).toBeGreaterThanOrEqual(1);
    } finally {
      await client.close();
    }
  });

  test("informational: is the upstream slug resolve bug still present?", async () => {
    syncReport();
    const all = await allEvents();
    const stride = Math.max(1, Math.floor(all.length / RESOLVE_SAMPLE));
    const slugs = all
      .filter((_, i) => i % stride === 0)
      .slice(0, RESOLVE_SAMPLE)
      .map((e) => e.slug);
    let notFound = 0;
    let unknown = 0;
    for (const slug of slugs) {
      const { status } = await getRawJson(
        `${BASE_URL}/fe_api/event/resolve/${encodeURIComponent(slug)}`,
      );
      if (status === 404) notFound++;
      else if (status !== 200) unknown++;
    }
    console.log(
      `[resolve-bug] ${notFound} of ${slugs.length} sampled snapshot slugs 404 on /fe_api/event/resolve` +
        `${unknown > 0 ? ` (${unknown} inconclusive)` : ""}: the upstream resolve bug is ` +
        `${notFound > 0 ? "still present" : "not visible in this sample"}.`,
    );
    expect(slugs.length).toBeGreaterThan(0);
  });
});
