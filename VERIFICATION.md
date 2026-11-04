# Verification — November 3, 2026

## Current data checks

- All nine configured source checks succeeded across repeated polling cycles.
- AP via NPR: 433 House races, 35 Senate races and 36 governor races; all await poll close. TX-18 and WI-08 are absent from the source and remain uncalled.
- Direct NC: 15 federal races; VA: 12 federal races; AZ: nine House races and governor; CA: 52 House races and governor.
- Official Sherwood: mayor, Council Ward 1 Position 1, Council Ward 2 Position 1. All three responses match the current Arkansas general-election ID.
- Open America House/Senate/Governor feeds identify 2026 but currently contain no races; they are supplemental and do not invent zero-result seats.
- The served dashboard contains 507 unique races across 50 states, with nine Arkansas races.

## Behavior checks

- `python3 -m unittest test_feeds.py`: 14 tests pass. Tests first failed on missing parsers, then passed after implementation. A live integration exposed NPR's Louisiana and special-election type names; a new assertion reproduced the rejection before the parser accepted those actual source values.
- Count tests check precinct/county aggregation without double counting, negative/invalid votes, wrong-election and test data, special-seat identity, live calls versus leads/runoffs, Senate holdovers, cached data on outage, downward corrections and no history entries on unchanged polls.
- `python3 -m py_compile feeds.py server.py start.py` passes.
- `node --check static/app.js` passes.
- HTTP `/`, `/app.js`, `/styles.css`, `/api/results` return 200 with expected content types; `/data/feed-npr.json` and `/../README.md` return 404.
- Safari desktop: national chamber totals, call-only flip empty state, all source statuses and race cards render; Arkansas filter shows nine races; pinning and watchlist filtering work; pinned Arkansas Senate survives reload.
- Responsive CSS reviewed for 900px and 600px breakpoints. Mobile viewport rendering has not been exercised; Safari's browser-control bridge is unavailable, so desktop checks used native accessibility and screenshots.

## Limits

No votes or calls had arrived during verification, so positive call/flip and correction paths use synthetic unit-test fixtures that never enter the live cache. This is a verified local pre-close build, not a claim of observed election-night operation. AP/NPR's public website feed can change; failures preserve cached counts and mark the source delayed. The Mac must remain awake for polling.

The simplify pass removed one redundant candidate sort and retained the external-source Senate baseline comment; all tests stayed green.

## Review fixes

- Removed the ambiguous single majority marker from the two-ended chamber bars. Explicit 218-seat and 51-seat labels remain; Safari confirms the labels and marker removal.
- Split NPR loading by office. A regression test checks that a governor-feed outage retains prior governor rows while new House/Senate calls still arrive, and that a total outage follows the existing failure path. The test failed before the change and passed afterward.
- Preserve the focused pin, details summary, source link or show-more button across race-grid refreshes, using stable element keys and `preventScroll`. Safari confirmed that an open Arkansas Senate summary kept focus after automatic refresh during the server restart; Space still closed that same summary. The outage warning appeared while saved counts remained visible.

## Background service

At 4:00 p.m. Central, `python3 start.py` launched detached process 91140 on `127.0.0.1:8767`. All nine source checks succeeded, serving 507 unique races, 36 governor races and nine Arkansas races. A second launcher call reused the existing process. Safari confirmed auto-refresh, nine healthy sources, the corrected Arkansas Senate candidate order and the Arizona results-start label. The server remains running for tonight.

## Review receipt

`ce-code-review mode:agent base:433f3b5 plan:CONTRACT.md` completed with status `complete`, run `20261103-155410-fa5fdbfe`. Receipt: `/tmp/compound-engineering-501/ce-code-review/20261103-155410-fa5fdbfe/review.json`. Nine review lenses returned three confirmed P2 findings. Root applied findings 1–3 inline and verified each as described above; no justified finding remains unresolved. The receipt covers the saved pre-fix snapshot, and the checks here cover the subsequent fixes.

The review's two additional coverage suggestions were also addressed: fixtures now check NPR calls/flips surviving overlapping direct/aggregated counts, missing House races remaining uncalled, unavailable national totals remaining null, and independent Senate winners with either caucus or an unknown caucus. The public-feed stability and pre-close validation limits remain documented above.

## Public edition and adjustable home state

- `python3 -m unittest test_feeds.py test_public.py`: 17 tests pass. Both JavaScript files pass `node --check`.
- Focused DOM checks cover home-state defaults, saved choices, query overrides, filter clearing, pins, pagination, six-frame limits, stable frame reuse, and resize origin/source/height validation. Network failures and invalid directory responses retain prior cards; initial invalid JSON shows an error; Retry restores the directory.
- Safari with the actual Pages preview headers: home-state selection persists after reopening, home focus clears filters, pinning and watchlist filtering work, and watch.vote cards render with source attribution. Layout checked at desktop and 574px width; a phone viewport remains untested.
- The public directory contains 507 seat records with no votes, candidates or calls. Only `public/` is deployed. The private cache URL returns 404. National control and party changes link to NPR/AP.
- The simplify pass removed three redundant comments. The provider's reduced-motion/data refresh exception is stated on the page.
- `ce-code-review mode:agent base:c442de6` completed with zero findings across seven review lenses. Receipt: `/tmp/compound-engineering-501/ce-code-review/20261103-174344-c7413e26/review.json`. The bounded text/label fixes and failure/retry checks were included in the review.
- The personal service restarted with the home-state source-link metadata; all nine sources report healthy and 508 races are served at 5:49 p.m. Central. Earlier pre-close observations above remain point-in-time records.

## Public release

Commit `c646b02` was published to `UnsaltedHash42/election-night` on `feat/election-night`. Cloudflare Pages deployment `c980f44f` serves `https://election-night-959.pages.dev/`. The home page, JavaScript and 507-row directory return HTTP 200 with the configured CSP; `/data/feed-npr.json` and `/api/results` return 404. Safari loads the hosted Arkansas Senate, governor and House race embeds with provider attribution. The preview server was stopped; the personal service remains running as process 62804.

At 5:55 p.m. Central, `https://election.blaketownsend.com/` passed HTTPS verification. Its HTML, JavaScript, stylesheet, race directory and 404 page match the release bytes; the private cache and local API paths return 404. The GitHub repository's website link points to the custom domain.

## Public call alerts

- `python3 -m unittest test_feeds.py test_public.py`: 17 tests pass. `node --test test_call_alerts.cjs`: 12 tests pass. The public UI harness, JavaScript syntax checks and whitespace checks pass.
- Core fixtures cover explicit calls, quiet first observations, reload deduplication, changed winners, withdrawn calls, malformed or stale responses, retained prior calls, null results, rate limits, pause/visibility, fair request spacing and removed races.
- A Safari integration check found valid candidates with `party: null` in the provider feed. A regression failed before accepting this documented value, then passed with both nonwinning write-ins and a winner whose party is not listed; numeric party values remain invalid.
- UI checks cover saved and national key-race selection, call announcements, replacement of corrected outcomes, pause/resume, and the existing directory, pinning, pagination and iframe boundaries.
- Safari with actual Pages preview headers reached all 20 key races through the public JSON API. Saved-only mode watched one saved race; pinning Arkansas Senate raised that to two, and removing it restored one. Key-race mode restored 20. The sound button switched on and off without an automatic permission prompt.
- Layout checked at desktop and approximately 580px width. A phone viewport remains untested. The browser showed a named warning for an unavailable Pennsylvania governor response, then cleared it on the next automatic cycle at 6:37 p.m. Central: all 20 races checked with no warnings. Failures do not clear prior calls.
- The simplify pipeline completed with no worthwhile cleanup and no source changes. Positive calls and corrections use test fixtures; no actual positive provider call or audible call alert was observed during these checks. Fixture data never entered the live cache.
- Review found two defects: an in-flight response could consume an alert after hiding or pausing, and separate tabs could overwrite shared call history. Both regressions failed before the fixes and pass afterward. Inactive responses now preserve the prior baseline; per-tab session storage keeps reload history without allowing another tab to replace it. Home state, saved races and the key-race preference remain in local storage.
- `ce-code-review mode:agent base:6878327` completed with seven review lenses and two confirmed P2 findings. Receipt: `/tmp/compound-engineering-501/ce-code-review/20261103-183509-e343a19d/review.json`. Root applied findings #1 and #2 inline, with no skipped or unresolved findings. The receipt covers the pre-fix snapshot; the regression tests and final checks above cover the fixes. Safari reloaded the final build with key-race monitoring active and sound off.

## National map

- The map uses watch.vote's documented bulk results route through a Cloudflare Pages function, rather than framing AP's public page. Its source notes and geometry licenses are in `MAP_SOURCES.md`.
- Geometry contains 51 state/D.C. shapes and 436 House/delegate shapes. IDs match the public directory exactly; all bounds and paths are finite, the source inputs and versions are recorded, and two rebuilds produced identical bytes. The 2026 House snapshot uses the provider's documented Missouri exception. Rendered inspection confirmed the geographic projection and district outlines.
- `python3 -m unittest test_feeds.py test_public.py`: 18 tests pass. `node --test test_call_alerts.cjs test_map_api.cjs test_map_ui.cjs test_map_client.cjs`: 27 tests pass. The public UI harness, JavaScript syntax and whitespace checks pass.
- New API and result-classification tests failed before implementation. The client tests characterize the implemented map's stale-office response handling, retained results during an outage, recovery, focus preservation, zoom and selection, hidden-page polling, and rate-limit delays.
- Live Pages preview initially returned 502 because workerd rejects `redirect: 'error'`. A regression reproduced that failure before switching to `manual`; redirects still fail rather than following another host. The fixed live endpoint returned HTTP 200 with 35 Senate rows and the configured cache headers. Temporary diagnostic output was removed.
- Safari verified live Senate, House and governor views: 13, 142 and 12 races respectively had results during the checks. Reported Georgia leaders and vote shares appeared with source links and source check times; no observed lead was shown as a call. Missing rows remained gray.
- Clicking a state or district selects its detail panel; the state picker zooms to House districts. A browser check found that opening House District 1 also matched Districts 10–14 in the race desk. The strengthened test failed with two matches, then passed after full race names took precedence; Safari confirmed one card for Georgia House District 1.
- Desktop and approximately 580px layouts were checked in Safari, including stacked details, legend wrapping and controls. A phone viewport remains untested. The test suite covers positive calls, certification and ties with fixtures; no positive live provider call was observed.
- The simplify pipeline replaced repeated per-region race scans with one lookup; all proof tests remained unchanged and the full check set passed.
- `ce-code-review mode:agent base:5c7f8fb` completed across nine review lenses, with one confirmed P2 finding. Receipt: `/tmp/compound-engineering-501/ce-code-review/20261103-191318-7a579e57/review.json`. Root applied #1 inline: failed polls now redraw retained results so stale styling, accessible labels and source-age text advance during an outage. The strengthened test failed after eleven minutes of simulated failures, then passed after the fix while preserving results and focus; no finding was skipped or remains unresolved.
- The review's geometry-retry coverage suggestion is covered by a characterization test: an initial HTTP failure shows Retry, recovery loads the map, and only one result polling loop starts. Final validation passed 18 Python tests, 28 Node tests, the public UI harness and whitespace checks. The review receipt covers the pre-fix snapshot; these checks cover the subsequent fix.

## Market odds

- Polymarket's documented widget embeds were checked before integration: all six market URLs returned HTTP 200 with no `X-Frame-Options` or framing CSP, buy buttons were disabled, and each rendered its own question text (`/tmp/polymarket-embeds-verified.json` records the checks). The panel adds two control markets and a selector for four Senate/governor markets, with source links and a manual refresh.
- The in-progress agent quality review was cut off by a usage limit and produced no findings; the change was reviewed directly instead. The local Pages preview showed all three frames rendering live market data ("Will the Democratic Party control the House after the 2026 Midterm elections?" with prices and volume) in a real browser. Earlier Safari attempts failed only because that session's computer-use bridge was down.
- `test_markets.cjs` covers selector-driven frame URL, title and source-link alignment, read-only embed parameters and refresh behavior; the allowed-origins and file-allowlist assertions in `test_public.py` were extended. Full suite: 18 Python tests, 29 Node tests, public UI harness, syntax and whitespace checks pass.

## Decision desk forecast

- AP's map stays a link: its terms bar displaying or retransmitting AP content without written permission and permit only link sharing, and its paid customer dashboard is the sole embed channel. The dashboard's own watch.vote map remains the continuously refreshed in-page map.
- Decision Desk HQ publishes a live 2026 forecast (House, Senate, governor) with update times and methodology pages. Its terms prohibit scraping and republishing; the integration frames the public page whole at its own URL, reads nothing from it, and keeps DDHQ's branding and sign-in intact. A headless-browser check confirmed the page renders inside a third-party frame even though plain HTTP clients hit a Vercel checkpoint.
- The local Pages preview served the updated `frame-src` CSP and rendered the section: the frame showed DDHQ's live balance of power and forecast text inside the dashboard. The Refresh forecast button reloaded the frame and set the status line; the unit test covers manual reload, the five-minute visible-only tick, and hidden-page suppression. The 580-pixel layout keeps the frame at 460 pixels with no horizontal overflow.
- Full suite after the change: 18 Python tests, 30 Node tests, the public UI harness, syntax and whitespace checks pass.

## Crash-out watch

- Truth Social cannot be embedded or read: its pages send `frame-ancestors 'none'`, its JSON API returns 403 even from its own origin in a real browser, and X's syndication timeline endpoint rate-limits every client tried. Every Bluesky mirror of Trump's Truths found by search had stopped posting (latest: August 2026). The working sources are Bluesky's public App View API: PatriotTakes (quotes Trump's Truth Social posts, active tonight), Catturd (posting tonight), MeidasTouch (posting live race calls) and the Trump Action Tracker (active tonight).
- The local preview loaded 16 live posts and rendered 12, newest first, each with author, handle, relative time and an Open-on-Bluesky link; the first card was MeidasTouch's house-control call nine minutes old. `test_crashout.cjs` covers merge order, literal text rendering of `<script>` content, repost and non-post filtering, per-feed failure warnings, retained posts, hidden-page suppression and visibility resume.

## AP cross-check

- At 02:18Z the user reported the map showing a red Texas while other outlets had Talarico ahead. Upstream watch.vote and this dashboard's API both carried `2026-tx-senate` as Paxton (Republican) 52.0–46.1, `not-called`, no precinct data; AP via NPR's public JSON at the same minute showed Talarico (Democratic) 58.2–40.3 with 4,114 precincts reporting. The pipeline mirrored its provider faithfully; the provider row was wrong, and watch.vote corrected it minutes later (Talarico 54.3–43.9 by 02:24Z).
- The map now cross-checks every race against AP counts via NPR's public JSON each cycle. Disagreements keep the watch.vote fill but add a dashed outline, a ⚠ comparison naming AP's leader and share in the detail panel with a link to NPR, and a per-office count in the status line. Unit tests cover NPR row normalization (test rows, invalid states, specials, at-large districts, aggregate-candidate exclusion) and conflict rules (opposite lead, AP-called-opposite, unlisted-party leads never conflict); a client test proves the disputed class, status count and detail warning render and that agreeing races stay unmarked.
- Live verification after the fix: watch.vote's corrected Texas rendered blue with no dispute, while Arkansas Senate — where watch.vote showed Shoffner +11.7 with 0.0% precincts reporting against AP's Cotton 52.4% — appeared with the dashed outline and the ⚠ comparison. Full suite: 18 Python tests, 35 Node tests, the public UI harness, syntax and whitespace checks pass.

## Balance strip, in-map odds and phone pass

- The crash-out watch now sits below the race desk and reading note; the preview showed it as the last content section, still streaming posts.
- Live checking caught three defects in the AP reader added with the cross-check, all invisible to fixtures written from guesses. NPR marks winners with the candidate field `winner: 'X'`, not a race-level `winnerId`. NPR sends `seatNumber` as a string. AP can call a race before any votes are counted. Together these hid every AP call from the cross-check's "AP already called this" rule and kept all but at-large House districts out of it. Fixtures now use the real field shapes, and a stale `winnerId` is proven to count for nothing. After the fix, the House cross-check found 7 disagreements it had missed.
- The balance strip matched an independent Python tally of the same NPR files at 9:09 p.m. Central: Senate 11 D / 4 R new calls on the 34/31 baseline (D 45 · R 35), House D 101 · R 60 (including Louisiana's nonpartisan LA-2), governors D 9 · R 2. `test_balance.cjs` covers the baseline, at-large and D.C. handling, third-party winners, majority markers, accessible labels, retention after a failed read and hidden-page suppression.
- Polymarket's market API returns `outcomes` and `outcomePrices` as JSON-encoded strings. The first browser check showed no price until the parser decoded them; fixtures now use that real format. The live Texas detail then showed "Polymarket price: Democratic win 99¢" with its market link. Closed markets, malformed JSON and non-Yes/No books show nothing.
- Phone pass at 390 × 844 (2× touch emulation): no element overflows horizontally. The map pickers and key-race market selector were 17–19px tall with 11–12px text (below tap-target guidance, and iOS zooms on focus below 16px). Every visible control is now at least 44px with 16px text on narrow screens; the alerts checkbox is 22px inside a 44px row. Desktop sizes are unchanged. This was Chromium emulation, not a physical phone.
- Full suite: 18 Python tests, 39 Node tests, the public UI harness, syntax and whitespace checks pass.

## AP gap fill (Mississippi, Michigan)

- Reported: Mississippi results were online, but the map showed none; Michigan likewise. watch.vote returned `result: null` for every Mississippi race (marking the Secretary of State feed unread) and for Michigan. Its other rows were fetched within a minute, so the gaps came from missing coverage, not stale caching. AP via NPR at the same time had Mississippi Senate at 71.6% of expected vote (Hyde-Smith 50.3, Colom 47.5) and all four Mississippi House seats called.
- National measurement at 9:35 p.m. Central: watch.vote lacked 17 Senate, 18 governor and 220 House races that AP reported, and had not marked 5 Senate, 4 governor and 49 House races that AP had called.
- The map now fills missing races from AP and uses AP's call where watch.vote's row is uncalled; watch.vote calls are never replaced. Client tests cover fill labeling, vote shares computed from raw totals, expected-vote counting, no dispute marking on AP-filled rows, watch.vote counts kept when AP has only a lead, AP-call precedence over uncalled rows, and watch.vote calls kept.
- Live preview after the change: Mississippi Senate, Michigan Senate (El-Sayed 53.3%), Michigan governor (Benson 55.5%), MS-2 (Thompson, called by AP) and MI-7 all showed AP data with the source note. Called totals on the map matched the AP balance strip exactly: Senate 15, House 186 (119 D + 67 R), governors 11. Full suite: 18 Python tests, 41 Node tests, the public UI harness, syntax and whitespace checks pass.
