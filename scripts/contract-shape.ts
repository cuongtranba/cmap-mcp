/**
 * The "key shape" of the cmap.vn API: for every endpoint our sync reads, the set of top-level keys
 * and of `translations.vi` / `translations.en` keys, each with the JSON value types seen.
 * `scripts/record-contract.ts` writes it to test/contract/shape.json from live data; the live test
 * compares fresh data against it to detect upstream drift.
 */
import { z } from "zod";

export type JsonType = "string" | "number" | "boolean" | "null" | "array" | "object";
export type KeyTypes = Record<string, JsonType[]>;

export interface EndpointShape {
  keys: KeyTypes;
  vi: KeyTypes;
  en: KeyTypes;
}

export const ENDPOINTS = [
  "province",
  "eventType",
  "eventCategory",
  "positionType",
  "event",
  "offer",
  "position",
  "eventDetail",
] as const;
export type EndpointName = (typeof ENDPOINTS)[number];

const jsonType = z.enum(["string", "number", "boolean", "null", "array", "object"]);
const keyTypes = z.record(z.string(), z.array(jsonType));
const endpointShape = z.object({ keys: keyTypes, vi: keyTypes, en: keyTypes });
export const contractShapeSchema = z.object({
  recordedAt: z.string(),
  endpoints: z.object({
    province: endpointShape,
    eventType: endpointShape,
    eventCategory: endpointShape,
    positionType: endpointShape,
    event: endpointShape,
    offer: endpointShape,
    position: endpointShape,
    eventDetail: endpointShape,
  }),
});
export type ContractShape = z.infer<typeof contractShapeSchema>;
export type Shapes = ContractShape["endpoints"];

/** Keys our schemas require or our code reads. A missing or retyped one fails the live test. */
interface Required {
  keys: readonly string[];
  vi: readonly string[];
  en: readonly string[];
}

const TAXONOMY: Required = { keys: ["id", "slug", "translations"], vi: ["name"], en: [] };
const EVENT_KEYS = [
  "id",
  "slug",
  "translations",
  "province",
  "type",
  "category",
  "start_time",
  "end_time",
  "lat",
  "lng",
  "charge",
  "highlight",
  "thumbnail",
] as const;

export const REQUIRED: Record<EndpointName, Required> = {
  province: {
    keys: ["id", "slug", "code", "lat", "lng", "order", "translations"],
    vi: ["name", "des"],
    en: ["name"],
  },
  eventType: TAXONOMY,
  eventCategory: TAXONOMY,
  positionType: TAXONOMY,
  event: { keys: EVENT_KEYS, vi: ["name", "des", "address", "organizer"], en: ["name", "des"] },
  offer: {
    keys: [...EVENT_KEYS, "kind"],
    vi: ["name", "des", "address", "content"],
    en: [], // offers and places carry no en translation upstream
  },
  position: {
    keys: ["id", "slug", "translations", "province", "type", "lat", "lng", "thumbnail"],
    vi: ["name", "des", "address"],
    en: [],
  },
  eventDetail: {
    keys: [...EVENT_KEYS, "image", "image_list", "more_location_list", "like", "view"],
    vi: ["name", "content", "ticket", "contact", "transport", "audience", "organization_level"],
    en: [], // a few events have no en translation, and the detail sample is only three events
  },
};

function typeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addKeys(into: Map<string, Set<JsonType>>, record: unknown): void {
  if (!isRecord(record)) return;
  for (const [key, value] of Object.entries(record)) {
    const types = into.get(key) ?? new Set<JsonType>();
    types.add(typeOf(value));
    into.set(key, types);
  }
}

function toKeyTypes(map: Map<string, Set<JsonType>>): KeyTypes {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, types]) => [key, [...types].sort()]),
  );
}

/** Union of keys and value types over all records. */
export function describeRecords(records: readonly unknown[]): EndpointShape {
  const keys = new Map<string, Set<JsonType>>();
  const vi = new Map<string, Set<JsonType>>();
  const en = new Map<string, Set<JsonType>>();
  for (const record of records) {
    addKeys(keys, record);
    const translations = isRecord(record) ? record.translations : undefined;
    if (isRecord(translations)) {
      addKeys(vi, translations.vi);
      addKeys(en, translations.en);
    }
  }
  return { keys: toKeyTypes(keys), vi: toKeyTypes(vi), en: toKeyTypes(en) };
}

const snapshotRecords = z.looseObject({
  provinces: z.array(z.unknown()),
  eventTypes: z.array(z.unknown()),
  eventCategories: z.array(z.unknown()),
  positionTypes: z.array(z.unknown()),
  events: z.array(z.unknown()),
  offers: z.array(z.unknown()),
  positions: z.array(z.unknown()),
});

/**
 * Shapes of every endpoint. List endpoints are described from the synced snapshot (its records
 * keep every upstream key); `details` are raw `/fe_api/event/{id}` responses.
 */
export function shapesFrom(snapshotJson: unknown, details: readonly unknown[]): Shapes {
  const s = snapshotRecords.parse(snapshotJson);
  return {
    province: describeRecords(s.provinces),
    eventType: describeRecords(s.eventTypes),
    eventCategory: describeRecords(s.eventCategories),
    positionType: describeRecords(s.positionTypes),
    event: describeRecords(s.events),
    offer: describeRecords(s.offers),
    position: describeRecords(s.positions),
    eventDetail: describeRecords(details),
  };
}

export interface Comparison {
  /** Required keys that vanished or changed type. */
  failures: string[];
  /** Keys that are new upstream (informational). */
  warnings: string[];
}

function compareKeys(
  label: string,
  required: readonly string[],
  recorded: KeyTypes,
  current: KeyTypes,
  out: Comparison,
): void {
  for (const key of required) {
    const was = recorded[key];
    const now = current[key];
    if (now === undefined) {
      out.failures.push(
        `${label}.${key}: REQUIRED key is missing from live data (recorded types: ${was?.join("|") ?? "none"})`,
      );
      continue;
    }
    const wasNonNull = (was ?? []).filter((t) => t !== "null");
    const unexpected = now.filter((t) => t !== "null" && !wasNonNull.includes(t));
    if (wasNonNull.length > 0 && unexpected.length > 0) {
      out.failures.push(
        `${label}.${key}: REQUIRED key changed type from ${wasNonNull.join("|")} to ${now.join("|")}`,
      );
    }
  }
  for (const key of Object.keys(current)) {
    if (recorded[key] === undefined) {
      out.warnings.push(`${label}.${key}: new key upstream (${current[key]?.join("|")})`);
    }
  }
}

export function compareShapes(recorded: Shapes, current: Shapes): Comparison {
  const out: Comparison = { failures: [], warnings: [] };
  for (const endpoint of ENDPOINTS) {
    const required = REQUIRED[endpoint];
    compareKeys(endpoint, required.keys, recorded[endpoint].keys, current[endpoint].keys, out);
    compareKeys(
      `${endpoint}.translations.vi`,
      required.vi,
      recorded[endpoint].vi,
      current[endpoint].vi,
      out,
    );
    compareKeys(
      `${endpoint}.translations.en`,
      required.en,
      recorded[endpoint].en,
      current[endpoint].en,
      out,
    );
  }
  return out;
}

/** Deterministic spread of `count` ids across the sorted list (first, middle, last, ...). */
export function sampleIds(ids: readonly string[], count: number): string[] {
  const sorted = [...ids].sort();
  if (sorted.length <= count) return sorted;
  const picks = new Set<string>();
  for (let i = 0; i < count; i++) {
    const id = sorted[Math.round((i * (sorted.length - 1)) / (count - 1))];
    if (id !== undefined) picks.add(id);
  }
  return [...picks];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Raw GET of an upstream JSON endpoint with a few polite retries on 429/5xx. */
export async function getRawJson(url: string): Promise<{ status: number; body: unknown }> {
  let last = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "cmap-mcp-contract-check" },
      signal: AbortSignal.timeout(20_000),
    });
    last = response.status;
    if (response.ok) return { status: 200, body: await response.json() };
    if (response.status !== 429 && response.status < 500) return { status: last, body: null };
    await sleep(1000 * 2 ** attempt);
  }
  return { status: last, body: null };
}

/** Event detail responses for `ids`, fetched one after the other. */
export async function fetchEventDetails(
  baseUrl: string,
  ids: readonly string[],
): Promise<unknown[]> {
  const details: unknown[] = [];
  for (const id of ids) {
    const { status, body } = await getRawJson(`${baseUrl}/fe_api/event/${id}?language=vi`);
    if (status !== 200) {
      throw new Error(
        `GET /fe_api/event/${id} answered HTTP ${status}; the detail endpoint changed`,
      );
    }
    details.push(body);
  }
  return details;
}
