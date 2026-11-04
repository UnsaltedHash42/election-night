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
