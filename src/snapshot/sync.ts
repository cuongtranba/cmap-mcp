import type { z } from "zod";
import { CmapError } from "../errors.ts";
import type { UpstreamClient } from "../upstream/client.ts";
import {
  eventSchema,
  offerSchema,
  positionSchema,
  provinceSchema,
  taxonomySchema,
} from "../upstream/schemas.ts";
import { SNAPSHOT_VERSION, type Snapshot, type SyncReport } from "./snapshot.ts";

/** Reject the whole sync when more than this share of records fail validation. */
export const MAX_INVALID_RATIO = 0.1;
const PAGE_SIZE = 100;

interface Validated<T> {
  records: T[];
  rejected: number;
}

/** Fetch every page of a list endpoint; warns when more than one page was needed. */
async function fetchAll(
  client: UpstreamClient,
  path: string,
  params: Record<string, string | number | boolean>,
  warnings: string[],
): Promise<unknown[]> {
  const first = await client.getPage(path, params);
  const records = [...first.results];
  if (first.total_pages > 1) {
    warnings.push(`${path} ${JSON.stringify(params)} spans ${first.total_pages} pages; paging`);
    for (let page = 2; page <= first.total_pages; page++) {
      const next = await client.getPage(path, { ...params, page });
      records.push(...next.results);
    }
  }
  if (records.length < first.total_objects) {
    warnings.push(
      `${path} ${JSON.stringify(params)} returned ${records.length} of ${first.total_objects} records`,
    );
  }
  return records;
}

function validate<S extends z.ZodType>(
  records: readonly unknown[],
  schema: S,
  label: string,
  warnings: string[],
): Validated<z.output<S>> {
  const valid: z.output<S>[] = [];
  let rejected = 0;
  for (const record of records) {
    const parsed = schema.safeParse(record);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      rejected++;
      if (rejected <= 3) {
        warnings.push(
          `${label}: rejected a record (${parsed.error.issues[0]?.message ?? "invalid"})`,
        );
      }
    }
  }
  return { records: valid, rejected };
}

function dedupeById<T extends { id: string }>(
  records: readonly T[],
): { unique: T[]; duplicates: number } {
  const seen = new Map<string, T>();
  for (const record of records) if (!seen.has(record.id)) seen.set(record.id, record);
  return { unique: [...seen.values()], duplicates: records.length - seen.size };
}

/**
 * Build a complete snapshot from the upstream API.
 *
 * Events are fetched once per province (never the global list: its paging is unstable). Any
 * request failure, an empty dataset, or more than 10% invalid records rejects the whole sync so
 * the caller keeps its previous snapshot.
 */
export async function runSync(
  client: UpstreamClient,
  now: () => Date = () => new Date(),
): Promise<{ snapshot: Snapshot; report: SyncReport }> {
  const started = now();
  const warnings: string[] = [];

  const [provinceRows, typeRows, categoryRows, positionTypeRows] = await Promise.all([
    fetchAll(client, "/fe_api/province/province", { page_size: PAGE_SIZE }, warnings),
    fetchAll(client, "/fe_api/event/type", { page_size: PAGE_SIZE }, warnings),
    fetchAll(client, "/fe_api/event/category", { page_size: PAGE_SIZE }, warnings),
    fetchAll(client, "/fe_api/position/type", { page_size: PAGE_SIZE }, warnings),
  ]);
  const provinces = validate(provinceRows, provinceSchema, "province", warnings);
  const eventTypes = validate(typeRows, taxonomySchema, "event type", warnings);
  const eventCategories = validate(categoryRows, taxonomySchema, "event category", warnings);
  const positionTypes = validate(positionTypeRows, taxonomySchema, "position type", warnings);
  if (provinces.records.length === 0) {
    throw new CmapError("SYNC_REJECTED", "Sync rejected: upstream returned no valid provinces");
  }

  const eventRowsPerProvince = await Promise.all(
    provinces.records.map((province) =>
      fetchAll(
        client,
        "/fe_api/event/event",
        { get_all: 1, page_size: PAGE_SIZE, province: province.id },
        warnings,
      ),
    ),
  );
  const [offerRows, positionRows] = await Promise.all([
    fetchAll(client, "/fe_api/offer/list", { page_size: PAGE_SIZE }, warnings),
    fetchAll(client, "/fe_api/position/position", { all: 1, language: "vi" }, warnings),
  ]);

  const events = validate(eventRowsPerProvince.flat(), eventSchema, "event", warnings);
  const offers = validate(offerRows, offerSchema, "offer", warnings);
  const positions = validate(positionRows, positionSchema, "position", warnings);

  const { unique: uniqueEvents, duplicates } = dedupeById(events.records);
  if (uniqueEvents.length === 0) {
    throw new CmapError("SYNC_REJECTED", "Sync rejected: upstream returned no valid events");
  }

  const datasets = [
    provinces,
    eventTypes,
    eventCategories,
    positionTypes,
    events,
    offers,
    positions,
  ];
  const rejected = datasets.reduce((sum, d) => sum + d.rejected, 0);
  const total = datasets.reduce((sum, d) => sum + d.records.length + d.rejected, 0);
  if (rejected / total > MAX_INVALID_RATIO) {
    throw new CmapError(
      "SYNC_REJECTED",
      `Sync rejected: ${rejected} of ${total} records failed validation (limit ${MAX_INVALID_RATIO * 100}%). ${warnings.slice(0, 3).join("; ")}`,
    );
  }

  const finished = now();
  const snapshot: Snapshot = {
    version: SNAPSHOT_VERSION,
    syncedAt: finished.toISOString(),
    baseUrl: client.baseUrl,
    warnings,
    provinces: provinces.records,
    eventTypes: eventTypes.records,
    eventCategories: eventCategories.records,
    positionTypes: positionTypes.records,
    events: uniqueEvents,
    offers: dedupeById(offers.records).unique,
    positions: dedupeById(positions.records).unique,
  };
  const report: SyncReport = {
    syncedAt: snapshot.syncedAt,
    durationMs: finished.getTime() - started.getTime(),
    counts: {
      provinces: snapshot.provinces.length,
      events: snapshot.events.length,
      offers: snapshot.offers.length,
      positions: snapshot.positions.length,
    },
    rejected,
    duplicates,
    warnings,
  };
  return { snapshot, report };
}
