/** Human-readable renderings for `--text`. JSON stays the default, stable output for agents. */
import type {
  CmapStatus,
  EventDetail,
  EventSummary,
  OfferDetail,
  OfferSummary,
  Page,
  PlaceSummary,
  ProvinceDetail,
  ProvinceSummary,
  SyncReport,
  Taxonomies,
  TaxonomyEntry,
} from "../index.ts";

const day = (value: string | null): string => (value === null ? "?" : value.slice(0, 10));

function dateRange(start: string | null, end: string | null): string {
  return day(start) === day(end) ? day(start) : `${day(start)} to ${day(end)}`;
}

function join(parts: readonly (string | null | undefined | false)[], separator = " | "): string {
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(separator);
}

function pageHeader<T>(page: Page<T>, noun: string): string {
  if (page.total === 0) return `No ${noun} found.`;
  const first = page.offset + 1;
  const last = page.offset + page.items.length;
  return `${noun}: ${first}-${last} of ${page.total}`;
}

export function eventLine(e: EventSummary): string {
  const meta = join([
    e.province?.name,
    e.type?.name,
    e.free ? "free" : "paid",
    e.highlight && "highlight",
    e.distanceKm !== undefined && `${e.distanceKm} km`,
  ]);
  return `${dateRange(e.startDate, e.endDate)}  ${e.name}\n    ${meta}\n    ${e.url}`;
}

export function eventsPageText(page: Page<EventSummary>): string {
  return join([pageHeader(page, "events"), ...page.items.map(eventLine)], "\n\n");
}

export function eventsListText(events: readonly EventSummary[]): string {
  return events.length === 0 ? "No events found." : events.map(eventLine).join("\n\n");
}

function field(label: string, value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : `${label}: ${value}`;
}

export function eventDetailText(e: EventDetail): string {
  return join(
    [
      e.name,
      field("Dates", dateRange(e.startDate, e.endDate)),
      field("Province", e.province?.name),
      field("Type", e.type?.name),
      field("Categories", e.categories.map((c) => c.name).join(", ")),
      field("Address", e.address),
      field("Organizer", e.organizer),
      field("Price", e.free ? "free" : "paid"),
      field("Ticket", e.ticket),
      field("Contact", e.contact),
      field("Transport", e.transport),
      field("Link", e.link),
      field("URL", e.url),
      e.content === "" ? undefined : `\n${e.content}`,
    ],
    "\n",
  );
}

export function offerLine(o: OfferSummary): string {
  const meta = join([o.province?.name, o.kind]);
  return `${dateRange(o.startDate, o.endDate)}  ${o.name}\n    ${meta}\n    ${o.url}`;
}

export function offersPageText(page: Page<OfferSummary>): string {
  return join([pageHeader(page, "offers"), ...page.items.map(offerLine)], "\n\n");
}

export function offerDetailText(o: OfferDetail): string {
  return join(
    [
      o.name,
      field("Dates", dateRange(o.startDate, o.endDate)),
      field("Province", o.province?.name),
      field("Address", o.address),
      field("Ticket", o.ticket),
      field("URL", o.url),
      o.content === "" ? undefined : `\n${o.content}`,
    ],
    "\n",
  );
}

export function provincesText(provinces: readonly ProvinceSummary[]): string {
  const width = Math.max(0, ...provinces.map((p) => p.name.length));
  return provinces
    .map((p) => `${p.name.padEnd(width)}  ${String(p.eventCount).padStart(3)} events`)
    .join("\n");
}

export function provinceDetailText(p: ProvinceDetail): string {
  return join(
    [
      `${p.name} (${p.eventCount} events, ${p.upcomingEventCount} upcoming)`,
      p.description,
      p.url,
      p.upcomingEvents.length === 0
        ? undefined
        : `\nUpcoming:\n${p.upcomingEvents.map(eventLine).join("\n\n")}`,
    ],
    "\n",
  );
}

export function placesText(places: readonly PlaceSummary[]): string {
  if (places.length === 0) return "No places found.";
  return places
    .map(
      (p) =>
        `${p.name}\n    ${join([p.province?.name, p.types.map((t) => t.name).join(", ")])}\n    ${p.url}`,
    )
    .join("\n\n");
}

function entries(title: string, rows: readonly TaxonomyEntry[]): string {
  return [`${title}:`, ...rows.map((r) => `  ${r.name}  (${r.slug})`)].join("\n");
}

export function taxonomiesText(t: Taxonomies): string {
  return [
    entries("Event types", t.eventTypes),
    entries("Event categories", t.eventCategories),
    entries("Place types", t.positionTypes),
  ].join("\n\n");
}

export function statusText(s: CmapStatus): string {
  return join(
    [
      field("Upstream", s.baseUrl),
      field("Cache file", s.snapshotPath),
      field("Last sync", s.syncedAt ?? "never"),
      s.ageMinutes === null
        ? undefined
        : `Age: ${Math.round(s.ageMinutes)} min${s.stale ? " (stale)" : ""}`,
      s.counts === null
        ? "No snapshot yet: run `cmap sync`."
        : `Counts: ${s.counts.events} events, ${s.counts.offers} offers, ${s.counts.positions} places, ${s.counts.provinces} provinces`,
      ...s.warnings.map((w) => `Warning: ${w}`),
      s.lastError === null ? undefined : `Last error (${s.lastError.at}): ${s.lastError.message}`,
    ],
    "\n",
  );
}

export function syncText(r: SyncReport): string {
  return join(
    [
      `Synced at ${r.syncedAt} in ${(r.durationMs / 1000).toFixed(1)} s`,
      `${r.counts.events} events, ${r.counts.offers} offers, ${r.counts.positions} places, ${r.counts.provinces} provinces`,
      `${r.rejected} rejected, ${r.duplicates} duplicates`,
      ...r.warnings.map((w) => `Warning: ${w}`),
    ],
    "\n",
  );
}
