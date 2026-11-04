# Public edition

Polymarket's [official widgets](https://help.polymarket.com/en/articles/13364174-how-to-use-embeds) show House/Senate control odds and four selected Senate/governor markets. Three lazy-loaded frames preserve provider attribution, disable buy buttons, and offer source links and manual refresh. Their market prices never enter the map, calls or alert monitor. The provider owns widget updates; the dashboard does not invent an odds timestamp. CSP permits only the added `https://embed.polymarket.com` frame origin, with no extra parent-page API permission or credentials.

Decision Desk HQ's public forecast page is framed whole at its own URL with its branding, sign-in and update times intact. DDHQ's [terms](https://votes-docs.decisiondeskhq.com/terms-of-service) prohibit scraping and republishing its content; framing the live page displays it without copying, and no forecast numbers are read, stored or mixed into results, calls or odds. The frame reloads every five minutes while the tab is visible, and a manual refresh is offered. CSP adds only the `https://votes.decisiondeskhq.com` frame origin.

Wrangler deploys `public/` and compiles the single Pages function at `functions/api/map-results.js`. The public edition contains a race directory, a geographic election map, watch.vote's permitted embeds, and a browser call monitor using that provider's public widget JSON. It does not run the personal Python service, read its cache, copy NPR/AP results, calculate full national control, or count flips. National control and party changes link to NPR/AP. The provider identifies the source, freshness and call status within each race card.

The map calls `/api/map-results?office=senate|house|governors`. This function reads watch.vote's documented bulk results API, checks its election and result fields, and caches successful responses for 60 seconds. It accepts only those three office values; it cannot proxy arbitrary URLs. No credentials or database are needed. `_routes.json` limits function execution to this endpoint, leaving static assets and private-path 404s outside it. The browser refreshes the active office about once per minute while visible; a failed refresh retains the last successful map and shows a warning. Upstream rate limits delay retries.

State and House district paths are bundled as static geometry, with no map tiles or browser map dependency. See [map sources](MAP_SOURCES.md) for the 2026 district snapshot, background state boundaries, build steps and licenses. The map distinguishes explicit calls, reported leads, tied votes, missing data and states without a race; named candidates without positive vote shares do not become leads. It displays source check times and flags checks over ten minutes old. AP's public page is linked rather than framed; its [terms](https://apnews.com/termsofservice) require permission for framing.

Home state and watchlist choices stay in the visitor's browser. A shared `?state=AR` link sets an initial home state. No address or browser location permission is needed. Each page loads at most six race cards; their provider controls result updates.

Call alerts check saved races and, by default, the 20 national featured races. Requests run one at a time, at least two seconds apart and no more often than every two minutes per race. Large watchlists take longer. Checks pause while the page is hidden or alerts are paused; responses completed while inactive leave the prior baseline for the next active check. A rate-limit response pauses the monitor for the provider's retry interval, or five minutes when that header is unavailable. Sound is opt-in. Calls and recent changes stay in each tab's session storage and survive reloads; separate tabs cannot overwrite each other's history. No notification subscription or server-side results cache is created.

Only explicit `called` or `certified` states with exactly one winner qualify. New races establish a silent baseline. Later calls and changed or withdrawn call flags produce alerts; missing, malformed, delayed, stale or older responses preserve the last accepted state and show a warning. Detection time is local, not the provider's call time. API availability and called-result coverage vary; no actual positive provider call was available during initial implementation checks.

## Preview and check

```sh
python3 -m unittest test_feeds.py test_public.py
node --test test_call_alerts.cjs
node --test test_map_api.cjs test_map_ui.cjs test_map_client.cjs
node test_public_ui.cjs
node --check public/app.js
npx wrangler@4.157.0 pages dev public --port 8788
```

Open `http://localhost:8788`. Check national links, home state, filters, paging and saved races. Counts come from third-party frames; a blocked frame always has an external race link.

## Publish to Cloudflare Pages

```sh
npx wrangler@4.157.0 login --scopes account:read user:read pages:write zone:read --use-keyring
npx wrangler@4.157.0 pages project create election-night --production-branch feat/election-night
npx wrangler@4.157.0 pages deploy public --project-name election-night --branch feat/election-night
```

Reuse the existing Pages project after its first creation. Use the production URL returned by Cloudflare; a local preview URL does not prove publication. Direct Upload does not create automatic GitHub deployments.

This project's production address is `https://election-night-959.pages.dev`. Wrangler 4.157.0 initially tried to create a Worker instead of the configured Pages project. Creation succeeded with `--force`, which selects Pages for that first creation; normal deployments to the existing project do not need that flag.

## Custom domain

Add `election.blaketownsend.com` under the Pages project's Custom domains. Then add the exact CNAME target Cloudflare supplies at the domain's DNS provider. For a subdomain, Cloudflare Pages does not require moving the whole domain's nameservers. Do not create the DNS record before associating the domain with Pages. Verify both DNS and HTTPS after activation.

The custom domain is registered with Pages. Its DNS record is `election CNAME election-night-959.pages.dev`, DNS only, in the `blaketownsend.com` Cloudflare zone. The domain owner moved the nameservers from Squarespace to Cloudflare during setup.

## Sources

- [watch.vote publisher terms](https://watch.vote/docs/embeds/for-publishers) permit editorial/civic embeds with attribution intact.
- [Race widget contract](https://watch.vote/docs/embeds/race) defines race slugs, source labels and result updates.
- [Widget JSON API](https://watch.vote/docs/api-reference/widgets) permits publisher layouts and documents CORS, cache and rate limits; [OpenAPI](https://watch.vote/api/public/openapi.json) defines explicit call states and winner flags.
- The directory has names of offices and seats, not candidates or results: [FEC 2026 election calendar](https://www.fec.gov/resources/cms-content/documents/2026pdates.pdf), [Census House apportionment](https://www2.census.gov/programs-surveys/decennial/2020/data/apportionment/apportionment-2020-table01.pdf), and [NGA governor elections](https://www.nga.org/governors/elections/).
- [Decision Desk HQ forecast](https://votes.decisiondeskhq.com/forecast/2026) with [methodology](https://votes-docs.decisiondeskhq.com/forecast-methodology); framing keeps their terms' no-scraping, no-republishing limits.
- The 507 directory entries comprise 435 House seats, 35 Senate races, 36 state governor races and the D.C. delegate. This is a directory, not a claim that every provider widget currently reports results. Territorial races other than D.C. are not included. Featured races are a browsing shortcut, not ratings or forecasts.
- [Cloudflare Pages direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) and [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) describe deployment and DNS setup.
