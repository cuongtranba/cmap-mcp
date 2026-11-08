import { z } from "zod";
import {
  eventSchema,
  offerSchema,
  positionSchema,
  provinceSchema,
  taxonomySchema,
} from "../upstream/schemas.ts";

/** Bump when the on-disk shape changes; older files are ignored and re-synced. */
export const SNAPSHOT_VERSION = 1;

export const snapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  syncedAt: z.string(),
  baseUrl: z.string(),
  warnings: z.array(z.string()),
  provinces: z.array(provinceSchema),
  eventTypes: z.array(taxonomySchema),
  eventCategories: z.array(taxonomySchema),
  positionTypes: z.array(taxonomySchema),
  events: z.array(eventSchema),
  offers: z.array(offerSchema),
  positions: z.array(positionSchema),
});

/**
 * The whole dataset, replaced in one swap by the sync job. Wards are deliberately absent: there
 * are 3 309 of them over 34 pages, so ward ids are not resolved to names (see docs).
 */
export type Snapshot = z.infer<typeof snapshotSchema>;

export interface SyncReport {
  syncedAt: string;
  durationMs: number;
  counts: {
    provinces: number;
    events: number;
    offers: number;
    positions: number;
  };
  /** Records dropped because they failed schema validation. */
  rejected: number;
  /** Duplicate event rows removed (same id seen twice, e.g. an event listed in two provinces). */
  duplicates: number;
  warnings: string[];
}
