/**
 * Zod schemas for every /fe_api response this project reads: the single definition of the
 * upstream contract. Objects are loose (unknown extra keys pass through) so the upstream can add
 * fields without breaking us; required keys are the ones the library depends on.
 */
import { z } from "zod";

const id = z.string().min(1);
const nullableString = z.string().nullish();

/** Coordinates arrive as numbers or null; out-of-range values are filtered at query time. */
const coordinate = z.number().nullish();

const nameDes = z.looseObject({
  name: z.string(),
  des: nullableString,
});

const eventTranslationVi = z.looseObject({
  name: z.string(),
  name_en: nullableString,
  des: nullableString,
  content: nullableString,
  content_en: nullableString,
  address: nullableString,
  organization_level: nullableString,
  organizer: nullableString,
  transport: nullableString,
  contact: nullableString,
  basis: nullableString,
  audience: nullableString,
  audio: z.unknown().optional(),
  tags: z.unknown().optional(),
  ticket: nullableString,
});

const eventTranslationEn = z.looseObject({
  name: nullableString,
  des: nullableString,
  address: nullableString,
  content: nullableString,
});

export const eventTranslationsSchema = z.looseObject({
  vi: eventTranslationVi,
  en: eventTranslationEn.nullish(),
});

/** Provinces and wards appear as an id in lists and as a nested object in some responses. */
const entityRef = z.union([id, z.looseObject({ id })]);

/** `type` is one reference on events and offers but a list on positions. */
const typeRef = z.union([entityRef, z.array(entityRef)]);

export const moreLocationSchema = z.looseObject({
  translations: z
    .looseObject({ vi: z.looseObject({ address: nullableString }).nullish() })
    .nullish(),
  ward: entityRef.nullish(),
  lat: coordinate,
  lng: coordinate,
});

const eventBase = {
  id,
  slug: z.string().min(1),
  translations: eventTranslationsSchema,
  thumbnail: nullableString,
  image: nullableString,
  start_time: nullableString,
  end_time: nullableString,
  link: nullableString,
  lat: coordinate,
  lng: coordinate,
  charge: z.boolean().nullish(),
  highlight: z.boolean().nullish(),
  highlight_community: z.boolean().nullish(),
  order: z.number().nullish(),
  province: entityRef,
  ward: entityRef.nullish(),
  more_location_list: z.array(moreLocationSchema).nullish(),
  type: typeRef.nullish(),
  category: z.array(entityRef).nullish(),
  service: z.array(z.unknown()).nullish(),
  like: z.number().nullish(),
  view: z.number().nullish(),
};

export const eventSchema = z.looseObject(eventBase);
export type UpstreamEvent = z.infer<typeof eventSchema>;

export const eventDetailSchema = z.looseObject({
  ...eventBase,
  allow_comment: z.boolean().nullish(),
  checkin: z.unknown().optional(),
  image_list: z.array(z.unknown()).nullish(),
});
export type UpstreamEventDetail = z.infer<typeof eventDetailSchema>;

export const offerSchema = z.looseObject({
  ...eventBase,
  kind: z.enum(["event", "position"]),
});
export type UpstreamOffer = z.infer<typeof offerSchema>;

const positionTranslation = z.looseObject({
  name: z.string(),
  des: nullableString,
  content: nullableString,
  address: nullableString,
  ticket: nullableString,
  open_time: nullableString,
  rule: nullableString,
  audio: z.unknown().optional(),
  tags: z.unknown().optional(),
});

export const positionSchema = z.looseObject({
  id,
  slug: z.string().min(1),
  translations: z.looseObject({
    vi: positionTranslation.nullish(),
    en: positionTranslation.nullish(),
  }),
  thumbnail: nullableString,
  image: nullableString,
  lat: coordinate,
  lng: coordinate,
  price: z.unknown().optional(),
  province: entityRef,
  ward: entityRef.nullish(),
  type: typeRef.nullish(),
  category: z.array(z.unknown()).nullish(),
  charge: z.boolean().nullish(),
  highlight: z.boolean().nullish(),
  highlight_province: z.boolean().nullish(),
  like: z.number().nullish(),
  view: z.number().nullish(),
  start_time: nullableString,
  end_time: nullableString,
  service: z.array(z.unknown()).nullish(),
});
export type UpstreamPosition = z.infer<typeof positionSchema>;

export const provinceSchema = z.looseObject({
  id,
  slug: z.string().min(1),
  code: nullableString,
  lat: coordinate,
  lng: coordinate,
  thumbnail: nullableString,
  image: nullableString,
  order: z.number().nullish(),
  translations: z.looseObject({
    vi: z.looseObject({ name: z.string(), des: nullableString }),
    en: z.looseObject({ name: nullableString, des: nullableString }).nullish(),
  }),
});
export type UpstreamProvince = z.infer<typeof provinceSchema>;

/** Taxonomies (event type/category, position type) share one shape; names may lack an `en`. */
export const taxonomySchema = z.looseObject({
  id,
  slug: z.string().min(1),
  code: nullableString,
  order: z.number().nullish(),
  translations: z.looseObject({
    vi: nameDes,
    en: z.looseObject({ name: nullableString, des: nullableString }).nullish(),
  }),
});
export type UpstreamTaxonomy = z.infer<typeof taxonomySchema>;

/** The paginated wrapper used by every list endpoint. */
const pageMeta = {
  page_size: z.number(),
  total_objects: z.number(),
  total_pages: z.number(),
  current_page_number: z.number(),
  next: nullableString,
  previous: nullableString,
};

/**
 * A list page whose records are validated individually by the caller, so one bad record does not
 * discard the page (the sync rejects the snapshot only past a 10% invalid ratio).
 */
export const rawPageSchema = z.looseObject({
  ...pageMeta,
  results: z.array(z.unknown()),
});
export type RawPage = z.infer<typeof rawPageSchema>;
