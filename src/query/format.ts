import type { Snapshot } from "../snapshot/snapshot.ts";
import type {
  UpstreamEvent,
  UpstreamEventDetail,
  UpstreamOffer,
  UpstreamPosition,
  UpstreamProvince,
  UpstreamTaxonomy,
} from "../upstream/schemas.ts";
import { categoryIds, isPoint, refId, textOf, typeIds } from "./search.ts";

export type Language = "vi" | "en";

/** Public pages live on cmap.vn whatever API origin is configured. */
export const SITE_URL = "https://cmap.vn";
const DESCRIPTION_LIMIT = 300;

export interface NamedRef {
  id: string;
  name: string;
}

export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  province: NamedRef | null;
  type: NamedRef | null;
  categories: NamedRef[];
  address: string | null;
  organizer: string | null;
  free: boolean;
  highlight: boolean;
  lat: number | null;
  lng: number | null;
  thumbnail: string | null;
  url: string;
  distanceKm?: number;
}

export interface EventLocation {
  address: string | null;
  lat: number;
  lng: number;
}

export interface EventDetail extends EventSummary {
  content: string;
  ticket: string | null;
  organizationLevel: string | null;
  contact: string | null;
  transport: string | null;
  audience: string | null;
  link: string | null;
  tags: string | null;
  locations: EventLocation[];
  images: string[];
  likes: number;
  views: number;
  /** `live` when fetched from cmap.vn just now, `snapshot` when the live detail was unavailable. */
  source: "live" | "snapshot";
}

export interface OfferSummary {
  id: string;
  slug: string;
  kind: "event" | "position";
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  province: NamedRef | null;
  address: string | null;
  thumbnail: string | null;
  url: string;
}

export interface OfferDetail extends OfferSummary {
  content: string;
  ticket: string | null;
}

export interface PlaceSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  address: string | null;
  province: NamedRef | null;
  types: NamedRef[];
  lat: number | null;
  lng: number | null;
  thumbnail: string | null;
  url: string;
}

export interface ProvinceSummary {
  id: string;
  slug: string;
  code: string | null;
  name: string;
  description: string;
  lat: number | null;
  lng: number | null;
  eventCount: number;
  url: string;
}

export interface ProvinceDetail extends ProvinceSummary {
  /** Events not yet over, soonest first (at most 20). */
  upcomingEvents: EventSummary[];
  upcomingEventCount: number;
}

export interface Taxonomies {
  eventTypes: TaxonomyEntry[];
  eventCategories: TaxonomyEntry[];
  positionTypes: TaxonomyEntry[];
}

export interface TaxonomyEntry {
  id: string;
  slug: string;
  name: string;
}

// --- text helpers ---------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** Convert upstream HTML to readable plain text, keeping paragraph and list breaks. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(text: string, limit: number = DESCRIPTION_LIMIT): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function plainOrNull(text: string | null | undefined): string | null {
  const value = htmlToText(text);
  return value === "" ? null : value;
}

function coordinate(value: number | null | undefined, limit: number): number | null {
  return typeof value === "number" && Math.abs(value) <= limit ? value : null;
}

// --- lookups --------------------------------------------------------------------------

function pick(lang: Language, vi: string | null | undefined, en: string | null | undefined) {
  const preferred = lang === "en" ? en : vi;
  return preferred ? preferred : (vi ?? "");
}

function taxonomyName(row: UpstreamTaxonomy, lang: Language): string {
  return pick(lang, row.translations.vi.name, row.translations.en?.name);
}

function refFrom(
  rows: readonly UpstreamTaxonomy[],
  id: string | undefined,
  lang: Language,
): NamedRef | null {
  if (id === undefined) return null;
  const row = rows.find((r) => r.id === id);
  return row ? { id, name: taxonomyName(row, lang) } : null;
}

function provinceName(row: UpstreamProvince, lang: Language): string {
  return pick(lang, row.translations.vi.name, row.translations.en?.name);
}

function provinceRef(
  snapshot: Snapshot,
  ref: string | { id: string },
  lang: Language,
): NamedRef | null {
  const id = refId(ref);
  const row = snapshot.provinces.find((p) => p.id === id);
  return row ? { id, name: provinceName(row, lang) } : null;
}

function isCommunityType(snapshot: Snapshot, typeId: string | undefined): boolean {
  const type = snapshot.eventTypes.find((t) => t.id === typeId);
  return type?.slug.startsWith("sinh-hoat-cong-dong") ?? false;
}

/** The cmap.vn page of an event; community activities live under /sinh-hoat-cong-dong. */
export function eventUrl(snapshot: Snapshot, event: Pick<UpstreamEvent, "slug" | "type">): string {
  const section = isCommunityType(snapshot, typeIds(event.type)[0])
    ? "sinh-hoat-cong-dong"
    : "su-kien";
  return `${SITE_URL}/${section}/${event.slug}`;
}

// --- formatters -----------------------------------------------------------------------

export function formatEvent(
  snapshot: Snapshot,
  event: UpstreamEvent,
  lang: Language,
  distanceKm?: number,
): EventSummary {
  const vi = event.translations.vi;
  const en = event.translations.en;
  const summary: EventSummary = {
    id: event.id,
    slug: event.slug,
    name: pick(lang, vi.name, en?.name),
    description: truncate(htmlToText(pick(lang, vi.des, en?.des))),
    startDate: event.start_time ?? null,
    endDate: event.end_time ?? null,
    province: provinceRef(snapshot, event.province, lang),
    type: refFrom(snapshot.eventTypes, typeIds(event.type)[0], lang),
    categories: categoryIds(event.category)
      .map((id) => refFrom(snapshot.eventCategories, id, lang))
      .filter((c): c is NamedRef => c !== null),
    address: plainOrNull(pick(lang, vi.address, en?.address)),
    organizer: plainOrNull(vi.organizer),
    free: event.charge !== true,
    highlight: event.highlight === true || event.highlight_community === true,
    lat: coordinate(event.lat, 90),
    lng: coordinate(event.lng, 180),
    thumbnail: event.thumbnail ?? null,
    url: eventUrl(snapshot, event),
  };
  if (distanceKm !== undefined) summary.distanceKm = Math.round(distanceKm * 10) / 10;
  return summary;
}

function imageUrls(images: readonly unknown[] | null | undefined): string[] {
  const urls: string[] = [];
  for (const item of images ?? []) {
    if (typeof item === "string") urls.push(item);
    else if (typeof item === "object" && item !== null) {
      for (const key of ["image", "url", "path", "src"]) {
        const value: unknown = Reflect.get(item, key);
        if (typeof value === "string") {
          urls.push(value);
          break;
        }
      }
    }
  }
  return urls;
}

/**
 * Full event record. `record` is the live detail when available, otherwise the snapshot row
 * (which lacks the long `content`/`ticket` text only on the vi side of the list endpoint).
 */
export function formatEventDetail(
  snapshot: Snapshot,
  record: UpstreamEventDetail,
  lang: Language,
  source: "live" | "snapshot",
): EventDetail {
  const vi = record.translations.vi;
  const en = record.translations.en;
  const images = [record.image, ...imageUrls(record.image_list)];
  return {
    ...formatEvent(snapshot, record, lang),
    content: htmlToText(pick(lang, vi.content, en?.content)),
    ticket: plainOrNull(vi.ticket),
    organizationLevel: plainOrNull(vi.organization_level),
    contact: plainOrNull(vi.contact),
    transport: plainOrNull(vi.transport),
    audience: plainOrNull(vi.audience),
    link: record.link ?? null,
    tags: textOf(vi.tags) || null,
    locations: [
      ...(typeof record.lat === "number" && typeof record.lng === "number"
        ? [{ address: plainOrNull(vi.address), lat: record.lat, lng: record.lng }]
        : []),
      ...(record.more_location_list ?? []).flatMap((l) =>
        typeof l.lat === "number" && typeof l.lng === "number"
          ? [{ address: plainOrNull(l.translations?.vi?.address), lat: l.lat, lng: l.lng }]
          : [],
      ),
    ].filter((l) => isPoint(l.lat, l.lng)),
    images: [...new Set(images.filter((i): i is string => typeof i === "string" && i !== ""))],
    likes: record.like ?? 0,
    views: record.view ?? 0,
    source,
  };
}

export function formatOffer(
  snapshot: Snapshot,
  offer: UpstreamOffer,
  lang: Language,
): OfferSummary {
  const vi = offer.translations.vi;
  const en = offer.translations.en;
  return {
    id: offer.id,
    slug: offer.slug,
    kind: offer.kind,
    name: pick(lang, vi.name, en?.name),
    description: truncate(htmlToText(pick(lang, vi.des, en?.des))),
    startDate: offer.start_time ?? null,
    endDate: offer.end_time ?? null,
    province: provinceRef(snapshot, offer.province, lang),
    address: plainOrNull(pick(lang, vi.address, en?.address)),
    thumbnail: offer.thumbnail ?? null,
    url: offer.kind === "position" ? `${SITE_URL}/uu-dai/${offer.slug}` : eventUrl(snapshot, offer),
  };
}

export function formatOfferDetail(
  snapshot: Snapshot,
  offer: UpstreamOffer,
  lang: Language,
): OfferDetail {
  const vi = offer.translations.vi;
  const en = offer.translations.en;
  return {
    ...formatOffer(snapshot, offer, lang),
    content: htmlToText(pick(lang, vi.content, en?.content)),
    ticket: plainOrNull(vi.ticket),
  };
}

export function formatPlace(
  snapshot: Snapshot,
  place: UpstreamPosition,
  lang: Language,
): PlaceSummary {
  const vi = place.translations.vi;
  const en = place.translations.en;
  return {
    id: place.id,
    slug: place.slug,
    name: pick(lang, vi?.name, en?.name),
    description: truncate(htmlToText(pick(lang, vi?.des, en?.des))),
    address: plainOrNull(pick(lang, vi?.address, en?.address)),
    province: provinceRef(snapshot, place.province, lang),
    types: typeIds(place.type)
      .map((id) => refFrom(snapshot.positionTypes, id, lang))
      .filter((t): t is NamedRef => t !== null),
    lat: coordinate(place.lat, 90),
    lng: coordinate(place.lng, 180),
    thumbnail: place.thumbnail ?? null,
    url: `${SITE_URL}/uu-dai/${place.slug}`,
  };
}

export function formatProvince(
  province: UpstreamProvince,
  eventCount: number,
  lang: Language,
): ProvinceSummary {
  return {
    id: province.id,
    slug: province.slug,
    code: province.code ?? null,
    name: provinceName(province, lang),
    description: truncate(
      htmlToText(pick(lang, province.translations.vi.des, province.translations.en?.des)),
    ),
    lat: coordinate(province.lat, 90),
    lng: coordinate(province.lng, 180),
    eventCount,
    url: `${SITE_URL}/cac-diem-den/${province.id}`,
  };
}

export function formatTaxonomies(snapshot: Snapshot, lang: Language): Taxonomies {
  const entries = (rows: readonly UpstreamTaxonomy[]): TaxonomyEntry[] =>
    rows.map((r) => ({ id: r.id, slug: r.slug, name: taxonomyName(r, lang) }));
  return {
    eventTypes: entries(snapshot.eventTypes),
    eventCategories: entries(snapshot.eventCategories),
    positionTypes: entries(snapshot.positionTypes),
  };
}
