import { CmapError } from "../errors.ts";
import type { Snapshot } from "../snapshot/snapshot.ts";
import type { UpstreamEvent, UpstreamOffer, UpstreamPosition } from "../upstream/schemas.ts";
import { normalize } from "./normalize.ts";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface EventFilters {
  query?: string | undefined;
  /** Province id, slug, code or name (diacritics optional). */
  province?: string | undefined;
  /** Event type id, slug or name. */
  type?: string | undefined;
  /** Event category id, slug or name. */
  category?: string | undefined;
  /** Inclusive range start, `YYYY-MM-DD`: keeps events that end on or after it. */
  from?: string | undefined;
  /** Inclusive range end, `YYYY-MM-DD`: keeps events that start on or before it. */
  to?: string | undefined;
  /** `true` keeps free events, `false` keeps paid ones (`charge === true` means paid). */
  free?: boolean | undefined;
  highlight?: boolean | undefined;
}

export interface Paging {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface OfferFilters {
  query?: string | undefined;
  province?: string | undefined;
  kind?: "event" | "position" | undefined;
}

export interface PlaceFilters {
  query?: string | undefined;
  province?: string | undefined;
  /** Position type id, slug or name. */
  type?: string | undefined;
}

export interface NearQuery {
  lat: number;
  lng: number;
  /** Only events with a location within this many kilometres; unlimited when omitted. */
  radiusKm?: number | undefined;
  limit?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface NearHit {
  event: UpstreamEvent;
  distanceKm: number;
}

type Named = { id: string; slug: string; code?: string | null | undefined };

/** The id of a reference that is either a plain id or a nested `{ id }` object. */
export function refId(ref: string | { id: string }): string {
  return typeof ref === "string" ? ref : ref.id;
}

type Ref = string | { id: string };

/** Ids of a `type` field that holds one reference or a list of them (ids or nested objects). */
export function typeIds(type: Ref | Ref[] | null | undefined): string[] {
  if (type === null || type === undefined) return [];
  return (Array.isArray(type) ? type : [type]).map(refId);
}

export function categoryIds(category: readonly Ref[] | null | undefined): string[] {
  return (category ?? []).map(refId);
}

/** Text of an upstream field that is a string, a list of strings, or absent. */
export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(" ");
  return "";
}

function slugStem(slug: string): string {
  return slug.replace(/-[A-Za-z0-9]{6}$/, "").toLowerCase();
}

/**
 * Resolve a user-supplied reference to the ids it names. Matching tiers, first non-empty wins:
 * exact id/slug/code/name, then name or slug containing the folded input. Unknown references are
 * a VALIDATION error that lists the valid choices, so callers never get silent empty results.
 */
export function resolveRefs(
  input: string,
  refs: readonly (Named & { names: string[] })[],
  label: string,
): Set<string> {
  const raw = input.trim();
  const folded = normalize(raw);
  const dashed = folded.replace(/ /g, "-");
  const exact = refs.filter(
    (r) =>
      r.id === raw ||
      r.slug.toLowerCase() === raw.toLowerCase() ||
      slugStem(r.slug) === dashed ||
      (r.code != null && normalize(r.code) === folded) ||
      r.names.some((n) => normalize(n) === folded),
  );
  const matches =
    exact.length > 0
      ? exact
      : refs.filter(
          (r) =>
            folded.length >= 2 &&
            (r.names.some((n) => normalize(n).includes(folded)) ||
              slugStem(r.slug).includes(dashed)),
        );
  if (matches.length === 0) {
    const choices = refs
      .map((r) => r.names[0])
      .filter((n): n is string => n !== undefined)
      .slice(0, 40)
      .join(", ");
    throw new CmapError("VALIDATION", `Unknown ${label} "${input}". Valid ${label}s: ${choices}`);
  }
  return new Set(matches.map((r) => r.id));
}

function provinceRefs(snapshot: Snapshot) {
  return snapshot.provinces.map((p) => ({
    id: p.id,
    slug: p.slug,
    code: p.code,
    names: [p.translations.vi.name, p.translations.en?.name].filter(
      (n): n is string => typeof n === "string",
    ),
  }));
}

function taxonomyRefs(rows: Snapshot["eventTypes"]) {
  return rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    code: t.code,
    names: [t.translations.vi.name, t.translations.en?.name].filter(
      (n): n is string => typeof n === "string",
    ),
  }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(label: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new CmapError("VALIDATION", `${label} must be a date like 2026-11-24, got "${value}"`);
  }
  return value;
}

function clampLimit(limit: number | undefined, fallback: number = DEFAULT_LIMIT): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) throw new CmapError("VALIDATION", "limit must be a number");
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function checkOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (!Number.isFinite(offset) || offset < 0) {
    throw new CmapError("VALIDATION", "offset must be a non-negative number");
  }
  return Math.floor(offset);
}

function paginate<T>(rows: T[], paging: Paging): Page<T> {
  const limit = clampLimit(paging.limit);
  const offset = checkOffset(paging.offset);
  return { total: rows.length, limit, offset, items: rows.slice(offset, offset + limit) };
}

// --- search index (folded text per record), cached per snapshot object ---------------------

interface Index {
  events: Map<string, string>;
  offers: Map<string, string>;
}
const indexes = new WeakMap<Snapshot, Index>();

function eventText(snapshot: Snapshot, e: UpstreamEvent | UpstreamOffer): string {
  const vi = e.translations.vi;
  const en = e.translations.en;
  const province = snapshot.provinces.find((p) => p.id === refId(e.province));
  const parts = [
    vi.name,
    vi.name_en,
    vi.des,
    vi.address,
    vi.organizer,
    textOf(vi.tags),
    en?.name,
    en?.des,
    en?.address,
    province?.translations.vi.name,
    ...(e.more_location_list ?? []).map((l) => l.translations?.vi?.address),
  ];
  return normalize(parts.filter((p) => typeof p === "string").join(" "));
}

function indexFor(snapshot: Snapshot): Index {
  let index = indexes.get(snapshot);
  if (!index) {
    index = {
      events: new Map(snapshot.events.map((e) => [e.id, eventText(snapshot, e)])),
      offers: new Map(snapshot.offers.map((o) => [o.id, eventText(snapshot, o)])),
    };
    indexes.set(snapshot, index);
  }
  return index;
}

function matchesQuery(haystack: string | undefined, query: string | undefined): boolean {
  if (query === undefined) return true;
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return haystack !== undefined && tokens.every((t) => haystack.includes(t));
}

function overlaps(
  record: { start_time?: string | null | undefined; end_time?: string | null | undefined },
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (from === undefined && to === undefined) return true;
  const start = record.start_time ?? record.end_time ?? undefined;
  const end = record.end_time ?? record.start_time ?? undefined;
  if (start === undefined || end === undefined) return false;
  if (to !== undefined && start.slice(0, 10) > to) return false;
  if (from !== undefined && end.slice(0, 10) < from) return false;
  return true;
}

function byStartThenName(
  a: UpstreamEvent | UpstreamOffer,
  b: UpstreamEvent | UpstreamOffer,
): number {
  const byDate = (a.start_time ?? "").localeCompare(b.start_time ?? "");
  return byDate !== 0 ? byDate : a.translations.vi.name.localeCompare(b.translations.vi.name, "vi");
}

// --- public query functions ------------------------------------------------------------

export function filterEvents(snapshot: Snapshot, filters: EventFilters): UpstreamEvent[] {
  const provinces =
    filters.province === undefined
      ? undefined
      : resolveRefs(filters.province, provinceRefs(snapshot), "province");
  const types =
    filters.type === undefined
      ? undefined
      : resolveRefs(filters.type, taxonomyRefs(snapshot.eventTypes), "event type");
  const categories =
    filters.category === undefined
      ? undefined
      : resolveRefs(filters.category, taxonomyRefs(snapshot.eventCategories), "event category");
  const from = checkDate("from", filters.from);
  const to = checkDate("to", filters.to);
  const index = indexFor(snapshot);

  return snapshot.events
    .filter(
      (e) =>
        (provinces === undefined || provinces.has(refId(e.province))) &&
        (types === undefined || typeIds(e.type).some((t) => types.has(t))) &&
        (categories === undefined || categoryIds(e.category).some((c) => categories.has(c))) &&
        overlaps(e, from, to) &&
        (filters.free === undefined || (e.charge !== true) === filters.free) &&
        (filters.highlight === undefined ||
          (e.highlight === true || e.highlight_community === true) === filters.highlight) &&
        matchesQuery(index.events.get(e.id), filters.query),
    )
    .sort(byStartThenName);
}

export function searchEvents(
  snapshot: Snapshot,
  filters: EventFilters,
  paging: Paging,
): Page<UpstreamEvent> {
  return paginate(filterEvents(snapshot, filters), paging);
}

export function searchOffers(
  snapshot: Snapshot,
  filters: OfferFilters,
  paging: Paging,
): Page<UpstreamOffer> {
  const provinces =
    filters.province === undefined
      ? undefined
      : resolveRefs(filters.province, provinceRefs(snapshot), "province");
  const index = indexFor(snapshot);
  const rows = snapshot.offers
    .filter(
      (o) =>
        (provinces === undefined || provinces.has(refId(o.province))) &&
        (filters.kind === undefined || o.kind === filters.kind) &&
        matchesQuery(index.offers.get(o.id), filters.query),
    )
    .sort(byStartThenName);
  return paginate(rows, paging);
}

export function filterPlaces(snapshot: Snapshot, filters: PlaceFilters): UpstreamPosition[] {
  const provinces =
    filters.province === undefined
      ? undefined
      : resolveRefs(filters.province, provinceRefs(snapshot), "province");
  const types =
    filters.type === undefined
      ? undefined
      : resolveRefs(filters.type, taxonomyRefs(snapshot.positionTypes), "place type");
  return snapshot.positions.filter((p) => {
    const text = normalize(
      [p.translations.vi?.name, p.translations.vi?.des, p.translations.vi?.address]
        .filter((t): t is string => typeof t === "string")
        .join(" "),
    );
    return (
      (provinces === undefined || provinces.has(refId(p.province))) &&
      (types === undefined || typeIds(p.type).some((t) => types.has(t))) &&
      matchesQuery(text, filters.query)
    );
  });
}

// --- geo ------------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A usable coordinate pair: finite and inside the valid range (upstream has a corrupt lat). */
export function isPoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export function eventPoints(event: UpstreamEvent): { lat: number; lng: number }[] {
  const candidates = [
    { lat: event.lat, lng: event.lng },
    ...(event.more_location_list ?? []).map((l) => ({ lat: l.lat, lng: l.lng })),
  ];
  const points: { lat: number; lng: number }[] = [];
  for (const { lat, lng } of candidates) {
    if (typeof lat === "number" && typeof lng === "number" && isPoint(lat, lng)) {
      points.push({ lat, lng });
    }
  }
  return points;
}

export function nearEvents(snapshot: Snapshot, query: NearQuery): NearHit[] {
  if (!isPoint(query.lat, query.lng)) {
    throw new CmapError("VALIDATION", "lat must be within [-90, 90] and lng within [-180, 180]");
  }
  if (query.radiusKm !== undefined && !(query.radiusKm >= 0)) {
    throw new CmapError("VALIDATION", "radiusKm must be a non-negative number");
  }
  const from = checkDate("from", query.from);
  const to = checkDate("to", query.to);
  const limit = clampLimit(query.limit, 10);
  const hits: NearHit[] = [];
  for (const event of snapshot.events) {
    if (!overlaps(event, from, to)) continue;
    let best = Number.POSITIVE_INFINITY;
    for (const p of eventPoints(event)) {
      best = Math.min(best, haversineKm(query.lat, query.lng, p.lat, p.lng));
    }
    if (best === Number.POSITIVE_INFINITY) continue;
    if (query.radiusKm !== undefined && best > query.radiusKm) continue;
    hits.push({ event, distanceKm: best });
  }
  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  return hits.slice(0, limit);
}

export { provinceRefs, resolveRefs as resolveReference, taxonomyRefs };
