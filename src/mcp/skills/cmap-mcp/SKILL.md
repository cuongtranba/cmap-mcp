---
name: cmap-mcp
description: How to answer questions about cultural events, festivals, exhibitions, performances, sports, community activities, offers (deals), places and provinces in Vietnam with the tools of this cmap MCP server (data from cmap.vn, the culture map of Vietnam). Use when the user asks what is happening in a Vietnamese city or province, about events on a date (for example Ngày Văn hóa Việt Nam 24/11), free events, events near a location, offers at cultural venues, museums or monuments, or mentions cmap.vn, "bản đồ văn hóa", lễ hội, triển lãm, sự kiện, sinh hoạt cộng đồng or địa điểm văn hóa.
---

# Using the cmap MCP server

This server answers from a cached copy of [cmap.vn](https://cmap.vn) (about 550 events, about 100 offers, places and the 34 provinces of Vietnam), refreshed in the background every few minutes. Every tool is read-only and returns JSON in `structuredContent` (the same JSON is also in the text content).

## Pick the tool

| The user asks | Call |
|---|---|
| What is on, festivals, exhibitions, concerts, sports, anything by topic, date or province | `search_events` |
| The full text, tickets, contact, transport or schedule of one event | `get_event` with the `id` or `slug` from a search |
| What is on near a place or coordinates | `events_near` (`lat`, `lng`, optional `radiusKm`) |
| Which provinces have events, or a province's exact id | `list_provinces` |
| What is coming up in one province | `get_province` (returns the next 20 `upcomingEvents`) |
| Which event types, categories or place types exist | `list_taxonomies` |
| Deals, discounts, promotions | `search_offers`, then `get_offer` for the full text |
| Museums, monuments, islands and other places | `list_places` |
| How fresh the data is, or why something is missing | `get_sync_status` |

## Workflows

- **Topic or date question.** `search_events` with `query` and/or `province`, `from`, `to`. Read the short `description` of each item, then call `get_event` only for the events you will describe in detail.
- **One day.** Set `from` and `to` to the same `YYYY-MM-DD`. Both keep events whose dates overlap the range, so a festival running for months is included. Vietnam Culture Day is `2026-11-24`.
- **Filter by type or category.** If you do not know the exact value, call `list_taxonomies` first and pass the `name`, `slug` or `id` you find. Community activities are type `sinh hoat cong dong`.
- **Near a landmark or city.** Get coordinates from `list_places` (for a landmark) or `list_provinces` / `get_province` (for a city), then call `events_near`. Results are nearest first with `distanceKm`.
- **Free or featured only.** `search_events` with `free: true` (or `false` for ticketed) and `highlight: true`.
- **Many results.** Lists return `{ total, limit, offset, items }`. `limit` is 1 to 50 (default 20); page with `offset` only when the user wants more. Prefer narrowing with `from`, `province` or `query` over reading every page.

## Arguments

- Text matching ignores Vietnamese diacritics: `ha noi` finds `Hà Nội`, `am vang dong que` finds `Âm vang đồng quê`. Pass the user's words as they are.
- `province` (and `get_province`'s `idOrSlugOrName`) takes an id, slug, code or name, with or without diacritics.
- Dates are `YYYY-MM-DD`.
- `lang` is `vi` (default) or `en`. English text falls back to Vietnamese when cmap.vn has no translation, so answer in the user's language yourself.

## Errors

A failed call returns `isError: true` with text `CODE: message`. Recover instead of giving up:

- `VALIDATION`: an unknown or ambiguous province, type or category. The message lists the valid choices; retry with one of them.
- `NOT_FOUND`: no event or offer with that id or slug. Search again and use an `id` from the results.
- `UPSTREAM`, `SYNC_REJECTED` or `NO_SNAPSHOT`: cmap.vn could not be reached or returned data the server refused, and there is no usable cached copy. Call `get_sync_status` (it shows the last sync error), tell the user, and retry later.
- `INTERNAL`: a bug in the server. Tell the user; retrying the same call will not help.

## Answering

- Cite the `url` field (a cmap.vn page) of every record you use and name cmap.vn as the source.
- Say the data is a cached copy. `get_sync_status` gives `ageMinutes` when the user asks how current it is.
- `get_event` returns `source: "live"` when it fetched cmap.vn just now and `source: "snapshot"` when only the cached copy was available.
- Give dates, the province and the address, and say whether the event is free (`free`).
