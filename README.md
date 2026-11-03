# Election Night

[Open the public dashboard](https://election.blaketownsend.com/) · [Start with Arkansas](https://election.blaketownsend.com/?state=AR)

Election-night dashboard for November 3, 2026. Run locally at **http://127.0.0.1:8767** with Python 3.9 or newer.

The public Cloudflare edition is in `public/`: adjustable home state, a saved watchlist and permitted race embeds, with NPR/AP links for national control and flips. See [deployment instructions](DEPLOYMENT.md). It is separate from the personal data service below.

Start or reopen the service:

```sh
cd election-night
python3 start.py
```

Open the address in Safari or another browser. The service runs in the background while this Mac is awake; reopening the page does not require this chat. No packages, keys or account setup required. A restart of the Mac requires running the command again. Local only; it is not hosted for access from a phone or another computer.

## What to watch

- House and Senate control: AP calls via NPR, with 65 Senate seats not up tonight included; the Democratic caucus includes two independent holdovers. An independent winner with no stated caucus stays in Other.
- Flipped seats and governorships: only called races where the winner's party differs from the previous holder. This tracks party changes, which may differ from caucus changes.
- Key races and all 36 governor elections; a saved home state and personal watchlist.
- Sherwood mayor and the two contested city council races, from Arkansas's official feed.
- Source check times, source update times, and last good data retained through failures.

The page checks the local service every 30 seconds. NPR and most official feeds are fetched every two minutes; NC/VA every minute. The supplemental Open America feed is checked every ten minutes while empty, and every minute while counting. Refresh reloads the latest cached data without bypassing upstream cache intervals. If one NPR office feed fails, the other offices keep updating; the failed office retains its previous results with a warning.

## Sources and limits

The current AP/NPR adapter is for personal use. Publishing this code does not grant rights to redistribute its source data: [NPR's terms](https://www.npr.org/about-npr/179876898/terms-of-use) restrict scraping to republish, and [AP's terms](https://www.ap.org/terms-and-conditions/) reserve distribution rights. A public hosted version needs licensed national data or a permitted embed. The ignored `data/` directory must stay out of published source and deployment artifacts.

- [AP via NPR](https://apps.npr.org/2026-election-results/) supplies national votes and calls. Its public website JSON is not a contracted API. The current feed contains 433 of 435 House races (TX-18 and WI-08 were absent when checked), all 35 Senate races and all 36 governor races. Missing House feeds remain uncalled; the source may add them later.
- [Arkansas official results](https://arkansas.tally-enr.com/) supplies Sherwood results. [Pulaski County](https://votepulaskiar.gov/election-results/) and [DDHQ local results](https://votes.decisiondeskhq.com/elections/2026-11-03/arkansas/pulaski) cover additional local races.
- NC, VA, AZ and CA direct official feeds provide supplementary coverage. NPR takes precedence on overlapping national races so vote totals and calls stay attributed to one source.
- [Official state election offices via Open America](https://openamerica.io/elections/api/) supplies additional results from its documented 22-state coverage. It makes no calls; its timestamp is the newest update across each office feed, not each race.

All election-night counts are unofficial. An AP call is distinct from certification. Zero votes mean no returns yet; a lead alone never becomes a call. Reporting units are not a measure of votes remaining. Candidate “Other candidates” rows are source aggregates. No predictions or synthetic live results.

Public source metadata and the last 60 changed count snapshots per race are kept in `data/`, ignored by Git. This directory is not served over HTTP. Diagnostics: `data/server.log`; process ID: `data/server.pid` when started by `start.py`.

## Checks

```sh
python3 -m unittest test_feeds.py
python3 -m py_compile feeds.py server.py start.py
node --check static/app.js
```

Tests cover count aggregation, wrong-election/test-feed rejection, call-only flips, runoffs, Senate holdovers, and retaining counts through failures. Browser checks and current source verification are recorded in `VERIFICATION.md`.
