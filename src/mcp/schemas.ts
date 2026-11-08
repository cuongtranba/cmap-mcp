/**
 * Zod schemas of the MCP tools. Output schemas mirror the library's result types: the SDK checks
 * every `structuredContent` against them, and the handlers assign library results to the inferred
 * types, so a drift between library and schema fails the typecheck.
 */
import { z } from "zod";

// --- inputs ---------------------------------------------------------------------------

const lang = z
  .enum(["vi", "en"])
  .optional()
  .describe('Language of names and text: "vi" (default) or "en". Falls back to vi when missing.');
const limit = z
  .number()
  .int()
  .min(1)
  .max(50)
  .optional()
  .describe("Results per page, 1-50 (default 20).");
const offset = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Number of results to skip, for paging.");
const province = z
  .string()
  .optional()
  .describe(
    'Province id, slug, code or name, with or without diacritics ("Hà Nội", "ha noi", "da nang").',
  );
const date = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
    .optional()
    .describe(what);

export const searchEventsInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Free text, matched without diacritics against names, descriptions, addresses, organizers and tags.",
    ),
  province,
  type: z
    .string()
    .optional()
    .describe(
      'Event type id, slug or name, e.g. "sinh hoat cong dong" (community activities). See list_taxonomies.',
    ),
  category: z.string().optional().describe("Event category id, slug or name. See list_taxonomies."),
  from: date("Keep events that end on or after this date (YYYY-MM-DD)."),
  to: date("Keep events that start on or before this date (YYYY-MM-DD)."),
  free: z.boolean().optional().describe("true: only free events; false: only ticketed events."),
  highlight: z.boolean().optional().describe("true: only highlighted (featured) events."),
  limit,
  offset,
  lang,
});

export const getEventInput = z.object({
  idOrSlug: z.string().min(1).describe("Event id (UUID) or slug, as returned by search_events."),
  lang,
});

export const eventsNearInput = z.object({
  lat: z.number().min(-90).max(90).describe("Latitude in degrees."),
  lng: z.number().min(-180).max(180).describe("Longitude in degrees."),
  radiusKm: z
    .number()
    .min(0)
    .optional()
    .describe("Only events within this many kilometres (default: no limit)."),
  limit,
  from: date("Keep events that end on or after this date (YYYY-MM-DD)."),
  to: date("Keep events that start on or before this date (YYYY-MM-DD)."),
  lang,
});

export const listProvincesInput = z.object({ lang });

export const getProvinceInput = z.object({
  idOrSlugOrName: z
    .string()
    .min(1)
    .describe(
      'Province id, slug, code or name, with or without diacritics ("Đà Nẵng", "da nang").',
    ),
  lang,
});

export const listTaxonomiesInput = z.object({ lang });

export const searchOffersInput = z.object({
  query: z.string().optional().describe("Free text, matched without diacritics."),
  province,
  kind: z
    .enum(["event", "position"])
    .optional()
    .describe('"event": offers tied to an event; "position": offers tied to a place.'),
  limit,
  offset,
  lang,
});

export const getOfferInput = z.object({
  idOrSlug: z.string().min(1).describe("Offer id or slug, as returned by search_offers."),
  lang,
});

export const listPlacesInput = z.object({
  query: z.string().optional().describe("Free text, matched without diacritics."),
  province,
  type: z
    .string()
    .optional()
    .describe("Place type id, slug or name. See list_taxonomies (positionTypes)."),
  lang,
});

export const emptyInput = z.object({});

// --- outputs --------------------------------------------------------------------------

const namedRef = z.object({ id: z.string(), name: z.string() });
const nullableText = z.string().nullable();

const eventSummary = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().describe("Plain text, truncated to about 300 characters."),
  startDate: nullableText,
  endDate: nullableText,
  province: namedRef.nullable(),
  type: namedRef.nullable(),
  categories: z.array(namedRef),
  address: nullableText,
  organizer: nullableText,
  free: z.boolean(),
  highlight: z.boolean(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  thumbnail: nullableText,
  url: z.string().describe("Page on cmap.vn; cite it as the source."),
  distanceKm: z.number().optional().describe("Only from events_near."),
});

const eventDetail = eventSummary.extend({
  content: z.string().describe("Full description as plain text."),
  ticket: nullableText,
  organizationLevel: nullableText,
  contact: nullableText,
  transport: nullableText,
  audience: nullableText,
  link: nullableText,
  tags: nullableText,
  locations: z.array(z.object({ address: nullableText, lat: z.number(), lng: z.number() })),
  images: z.array(z.string()),
  likes: z.number(),
  views: z.number(),
  source: z.enum(["live", "snapshot"]),
});

const offerSummary = z.object({
  id: z.string(),
  slug: z.string(),
  kind: z.enum(["event", "position"]),
  name: z.string(),
  description: z.string(),
  startDate: nullableText,
  endDate: nullableText,
  province: namedRef.nullable(),
  address: nullableText,
  thumbnail: nullableText,
  url: z.string().describe("Page on cmap.vn; cite it as the source."),
});

const offerDetail = offerSummary.extend({ content: z.string(), ticket: nullableText });

const placeSummary = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  address: nullableText,
  province: namedRef.nullable(),
  types: z.array(namedRef),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  thumbnail: nullableText,
  url: z.string().describe("Page on cmap.vn; cite it as the source."),
});

const provinceSummary = z.object({
  id: z.string(),
  slug: z.string(),
  code: nullableText,
  name: z.string(),
  description: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  eventCount: z.number(),
  url: z.string(),
});

const provinceDetail = provinceSummary.extend({
  upcomingEvents: z.array(eventSummary).describe("Events not yet over, soonest first, at most 20."),
  upcomingEventCount: z.number(),
});

const taxonomyEntry = z.object({ id: z.string(), slug: z.string(), name: z.string() });

const page = <T extends z.ZodType>(item: T) =>
  z.object({ total: z.number(), limit: z.number(), offset: z.number(), items: z.array(item) });

const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

export const eventsPageOutput = page(eventSummary);
export const eventDetailOutput = eventDetail;
export const eventsListOutput = items(eventSummary);
export const provincesOutput = items(provinceSummary);
export const provinceDetailOutput = provinceDetail;
export const taxonomiesOutput = z.object({
  eventTypes: z.array(taxonomyEntry),
  eventCategories: z.array(taxonomyEntry),
  positionTypes: z.array(taxonomyEntry),
});
export const offersPageOutput = page(offerSummary);
export const offerDetailOutput = offerDetail;
export const placesOutput = items(placeSummary);
export const statusOutput = z.object({
  baseUrl: z.string(),
  snapshotPath: z.string(),
  syncedAt: nullableText.describe("ISO time of the last successful sync, null before the first."),
  ageMinutes: z.number().nullable(),
  stale: z.boolean(),
  counts: z
    .object({
      provinces: z.number(),
      events: z.number(),
      offers: z.number(),
      positions: z.number(),
    })
    .nullable(),
  warnings: z.array(z.string()),
  lastError: z.object({ message: z.string(), at: z.string() }).nullable(),
});
