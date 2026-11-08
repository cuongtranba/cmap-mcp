/**
 * Public library API of cmap-mcp: a cached, searchable copy of the cmap.vn culture-map data.
 *
 *     const cmap = createCmap();
 *     await cmap.sync();
 *     const { items } = await cmap.searchEvents({ query: "ha noi", from: "2026-11-24" });
 */
import { type CmapConfig, loadConfig, snapshotPath } from "./config.ts";
import { CmapError, isCmapError } from "./errors.ts";
import {
  type EventDetail,
  type EventSummary,
  formatEvent,
  formatEventDetail,
  formatOffer,
  formatOfferDetail,
  formatPlace,
  formatProvince,
  formatTaxonomies,
  type Language,
  type OfferDetail,
  type OfferSummary,
  type PlaceSummary,
  type ProvinceDetail,
  type ProvinceSummary,
  type Taxonomies,
} from "./query/format.ts";
import {
  type EventFilters,
  filterPlaces,
  nearEvents,
  type OfferFilters,
  type Page,
  type Paging,
  type PlaceFilters,
  provinceRefs,
  refId,
  resolveRefs,
  searchEvents as searchSnapshotEvents,
  searchOffers as searchSnapshotOffers,
} from "./query/search.ts";
import type { Snapshot, SyncReport } from "./snapshot/snapshot.ts";
import { SnapshotStore } from "./snapshot/store.ts";
import { runSync } from "./snapshot/sync.ts";
import { UpstreamClient } from "./upstream/client.ts";
import { TtlCache } from "./upstream/detail-cache.ts";
import { eventDetailSchema, type UpstreamEventDetail } from "./upstream/schemas.ts";

export type { CmapConfig } from "./config.ts";
export { loadConfig, snapshotPath } from "./config.ts";
export type { CmapErrorCode } from "./errors.ts";
export { CmapError, isCmapError } from "./errors.ts";
export type {
  EventDetail,
  EventLocation,
  EventSummary,
  Language,
  NamedRef,
  OfferDetail,
  OfferSummary,
  PlaceSummary,
  ProvinceDetail,
  ProvinceSummary,
  Taxonomies,
  TaxonomyEntry,
} from "./query/format.ts";
export type { Page } from "./query/search.ts";
export type { SyncReport } from "./snapshot/snapshot.ts";
export { VERSION } from "./version.ts";

export interface CmapOptions {
  /** Upstream origin; default `CMAP_BASE_URL` or https://cmap.vn. */
  baseUrl?: string;
  /** Directory for `snapshot.json`; default `CMAP_CACHE_DIR` or ~/.cache/cmap-mcp. */
  cacheDir?: string;
  /** Re-sync before answering when the snapshot is older than this many minutes (default 60). */
  maxAgeMin?: number;
  /** Maximum simultaneous upstream requests (default 4). */
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  /** First retry backoff in milliseconds (default 1000, doubling with jitter). */
  retryDelayMs?: number;
  /** How long a fetched event detail stays cached (default 10 minutes). */
  detailTtlMs?: number;
  /** Clock override for tests. */
  now?: () => Date;
}

export interface LanguageOption {
  lang?: Language;
}

export interface SearchEventsParams extends EventFilters, Paging, LanguageOption {}
export interface SearchOffersParams extends OfferFilters, Paging, LanguageOption {}
export interface ListPlacesParams extends PlaceFilters, LanguageOption {}

export interface EventsNearParams extends LanguageOption {
  lat: number;
  lng: number;
  /** Only events with a location within this many kilometres. */
  radiusKm?: number;
  limit?: number;
  from?: string;
  to?: string;
}

export interface CmapStatus {
  baseUrl: string;
  snapshotPath: string;
  /** ISO time of the last successful sync, or null before the first one. */
  syncedAt: string | null;
  ageMinutes: number | null;
  /** True when there is no snapshot or it is older than `maxAgeMin`. */
  stale: boolean;
  counts: SyncReport["counts"] | null;
  warnings: string[];
  /** The most recent failed sync since the last success, if any. */
  lastError: { message: string; at: string } | null;
}

export interface Cmap {
  /** Fetch everything from cmap.vn and swap it in. Throws `CmapError`; the old snapshot stays. */
  sync(): Promise<SyncReport>;
  status(): Promise<CmapStatus>;
  searchEvents(params?: SearchEventsParams): Promise<Page<EventSummary>>;
  getEvent(idOrSlug: string, options?: LanguageOption): Promise<EventDetail>;
  eventsNear(params: EventsNearParams): Promise<EventSummary[]>;
  listProvinces(options?: LanguageOption): Promise<ProvinceSummary[]>;
  getProvince(idOrSlugOrName: string, options?: LanguageOption): Promise<ProvinceDetail>;
  listTaxonomies(options?: LanguageOption): Promise<Taxonomies>;
  searchOffers(params?: SearchOffersParams): Promise<Page<OfferSummary>>;
  getOffer(idOrSlug: string, options?: LanguageOption): Promise<OfferDetail>;
  listPlaces(params?: ListPlacesParams): Promise<PlaceSummary[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPCOMING_LIMIT = 20;
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Today's date in Vietnam (UTC+7), `YYYY-MM-DD`. */
function vietnamToday(now: Date): string {
  return new Date(now.getTime() + VIETNAM_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function resolveConfig(options: CmapOptions): CmapConfig {
  const config = loadConfig();
  return {
    ...config,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
    ...(options.maxAgeMin === undefined ? {} : { maxAgeMin: options.maxAgeMin }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
  };
}

export function createCmap(options: CmapOptions = {}): Cmap {
  const config = resolveConfig(options);
  const now = options.now ?? (() => new Date());
  const client = new UpstreamClient({
    baseUrl: config.baseUrl,
    concurrency: config.concurrency,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
  });
  const store = new SnapshotStore(snapshotPath(config), now);
  const details = new TtlCache<UpstreamEventDetail>(options.detailTtlMs ?? 10 * 60_000, 200, () =>
    now().getTime(),
  );

  let diskLoad: Promise<boolean> | undefined;
  const loadDisk = (): Promise<boolean> => {
    diskLoad ??= store.loadFromDisk();
    return diskLoad;
  };

  let inFlight: Promise<SyncReport> | undefined;
  const sync = (): Promise<SyncReport> => {
    inFlight ??= (async () => {
      await loadDisk();
      try {
        const { snapshot, report } = await runSync(client, now);
        const persistWarning = await store.swap(snapshot);
        if (persistWarning !== undefined) report.warnings.push(persistWarning);
        return report;
      } catch (error) {
        store.recordError(error);
        throw error;
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  async function snapshot(): Promise<Snapshot> {
    await loadDisk();
    await store.ensureFresh({ maxAgeMin: config.maxAgeMin, refresh: sync });
    const current = store.current;
    if (!current) throw new CmapError("NO_SNAPSHOT", "No snapshot available; run sync first");
    return current;
  }

  return {
    sync,

    async status() {
      await loadDisk();
      const current = store.current;
      const lastError = store.lastError;
      return {
        baseUrl: config.baseUrl,
        snapshotPath: store.path,
        syncedAt: current?.syncedAt ?? null,
        ageMinutes: store.ageMinutes() ?? null,
        stale: !store.isFresh(config.maxAgeMin),
        counts: current
          ? {
              provinces: current.provinces.length,
              events: current.events.length,
              offers: current.offers.length,
              positions: current.positions.length,
            }
          : null,
        warnings: current?.warnings ?? [],
        lastError: lastError ? { message: lastError.message, at: lastError.at } : null,
      };
    },

    async searchEvents(params = {}) {
      const snap = await snapshot();
      const lang = params.lang ?? "vi";
      const page = searchSnapshotEvents(snap, params, params);
      return { ...page, items: page.items.map((e) => formatEvent(snap, e, lang)) };
    },

    async getEvent(idOrSlug, { lang = "vi" } = {}) {
      const snap = await snapshot();
      const row = snap.events.find((e) => e.id === idOrSlug || e.slug === idOrSlug);
      // Slugs resolve only from the snapshot (upstream /resolve loses events); ids may be live.
      const id = row?.id ?? (UUID.test(idOrSlug) ? idOrSlug : undefined);
      if (id === undefined) throw new CmapError("NOT_FOUND", `Event "${idOrSlug}" not found`);

      const key = `${id}:${lang}`;
      try {
        let detail = details.get(key);
        if (detail === undefined) {
          detail = await client.get(`/fe_api/event/${id}`, { language: lang }, eventDetailSchema);
          details.set(key, detail);
        }
        return formatEventDetail(snap, detail, lang, "live");
      } catch (error) {
        if (row !== undefined && isCmapError(error)) {
          return formatEventDetail(snap, row, lang, "snapshot");
        }
        if (isCmapError(error) && error.code === "NOT_FOUND") {
          throw new CmapError("NOT_FOUND", `Event "${idOrSlug}" not found`);
        }
        throw error;
      }
    },

    async eventsNear(params) {
      const snap = await snapshot();
      const lang = params.lang ?? "vi";
      return nearEvents(snap, params).map((hit) =>
        formatEvent(snap, hit.event, lang, hit.distanceKm),
      );
    },

    async listProvinces({ lang = "vi" } = {}) {
      const snap = await snapshot();
      const counts = countByProvince(snap);
      return [...snap.provinces]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((p) => formatProvince(p, counts.get(p.id) ?? 0, lang));
    },

    async getProvince(idOrSlugOrName, { lang = "vi" } = {}) {
      const snap = await snapshot();
      const ids = resolveRefs(idOrSlugOrName, provinceRefs(snap), "province");
      const matches = snap.provinces.filter((p) => ids.has(p.id));
      const province = matches[0];
      if (province === undefined || matches.length > 1) {
        const names = matches.map((p) => p.translations.vi.name).join(", ");
        throw new CmapError(
          "VALIDATION",
          `"${idOrSlugOrName}" matches several provinces: ${names}`,
        );
      }
      const today = vietnamToday(now());
      const upcoming = snap.events
        .filter(
          (e) => refId(e.province) === province.id && (e.end_time ?? e.start_time ?? "") >= today,
        )
        .sort(
          (a, b) =>
            (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
            a.translations.vi.name.localeCompare(b.translations.vi.name, "vi"),
        );
      return {
        ...formatProvince(province, countByProvince(snap).get(province.id) ?? 0, lang),
        upcomingEvents: upcoming.slice(0, UPCOMING_LIMIT).map((e) => formatEvent(snap, e, lang)),
        upcomingEventCount: upcoming.length,
      };
    },

    async listTaxonomies({ lang = "vi" } = {}) {
      return formatTaxonomies(await snapshot(), lang);
    },

    async searchOffers(params = {}) {
      const snap = await snapshot();
      const lang = params.lang ?? "vi";
      const page = searchSnapshotOffers(snap, params, params);
      return { ...page, items: page.items.map((o) => formatOffer(snap, o, lang)) };
    },

    /** The offer list record already carries the full content, so no live detail call is needed. */
    async getOffer(idOrSlug, { lang = "vi" } = {}) {
      const snap = await snapshot();
      const offer = snap.offers.find((o) => o.id === idOrSlug || o.slug === idOrSlug);
      if (offer === undefined) throw new CmapError("NOT_FOUND", `Offer "${idOrSlug}" not found`);
      return formatOfferDetail(snap, offer, lang);
    },

    async listPlaces(params = {}) {
      const snap = await snapshot();
      const lang = params.lang ?? "vi";
      return filterPlaces(snap, params).map((p) => formatPlace(snap, p, lang));
    },
  };
}

function countByProvince(snap: Snapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of snap.events) {
    const id = refId(event.province);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
