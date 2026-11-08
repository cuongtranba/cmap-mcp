# Investigation: events missing from the cmap.vn map

Captured on 2026-11-08 with agent-browser. Details are in [../design.md](../design.md), section 1.

Between 23 and 27 published events are missing at any moment from `/fe_api/event/map`, `/fe_api/event/facets` and `/fe_api/event/resolve/{slug}`. The site builds those from its backend 200 rows at a time, and the backend's sort order is unstable inside groups of events that share a start date (2026-11-18 and 2026-11-23 on that day). Which events go missing changes each time the index is rebuilt.

| Screenshot | What it shows |
|---|---|
| [1-direct-url-404.png](1-direct-url-404.png) | Opening a missing event's URL directly returns the site's 404 page. |
| [2-listing-card.png](2-listing-card.png) | The same event still appears as a card in the `/su-kien` listing (Hà Nội, page 4). |
| [3-after-click-from-listing.png](3-after-click-from-listing.png) | Clicking the card opens the event, because in-app navigation skips the failing slug lookup. |
