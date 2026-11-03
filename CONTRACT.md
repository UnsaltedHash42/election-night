# Election Night

Local personal dashboard for the November 3, 2026 U.S. general election. Public data only; no credentials or publication. Bind the server to 127.0.0.1:8767. Python standard library backend, buildless HTML/CSS/JavaScript frontend. Native implementation selected; no existing work or checkout configuration.

## Interface

GET /api/results returns JSON:

```
{
  "electionDate": "2026-11-03", "generatedAt": "UTC ISO timestamp", "refreshSeconds": 30,
  "sources": [{"id":"nc","label":"North Carolina Board of Elections","url":"https://www.ncsbe.gov/results-data/election-results","status":"ok|error|loading","lastAttempt":null,"lastSuccess":null,"sourceUpdatedAt":null,"error":null,"coverage":"Federal and statewide races"}],
  "races": [{"id":"nc-senate","state":"NC","office":"Senate|House|Governor|Other","name":"U.S. Senate","sourceId":"nc","sourceUrl":"https://...","updatedAt":"UTC ISO timestamp","candidates":[{"id":"candidate-id","name":"Candidate Name","party":"DEM|REP|LIB|IND|OTHER","votes":0}],"totalVotes":0,"reporting":null,"status":"awaiting|reporting","history":[{"at":"UTC ISO timestamp","totalVotes":0,"marginVotes":0}]}],
  "links": [{"label":"AP national results","url":"https://apnews.com/projects/elections-2026/","description":"National results and race calls"}],
  "pollClosings": [{"state":"NC","label":"North Carolina","at":"2026-11-04T00:30:00Z","note":"Scheduled close; extensions may delay results","url":"https://..."}]
}
```

`reporting`, when supplied by the source: `{ "count": 12, "total": 100, "label": "precincts" }`; not a percent of votes counted. Zero totals mean awaiting returns, never a leader/winner. All vote counts are unofficial. No locally generated race calls. `updatedAt` reflects the last change to a race, not fetch time. `lastSuccess` is a source check time, not an indication that officials published new counts. Failures retain cached race data and clearly mark stale sources. History describes reported count changes, not votes being cast in real time. Gaps in covered states never imply zero votes nationally.

## Work and checks

- Backend: verify public data adapters, aggregate candidates across precincts, cache and retain data on failure, expose HTTP API; meaningful fixture tests for totals, wrong-election rejection and failure retention.
- Frontend: responsive source-aware watchlist; state/office/search filters, pinning in local storage, totals and margins, polling, source health and source links; browser verification at desktop and phone sizes.
- Integration: compare served totals against a current source, test startup and refresh, inspect UI states, and leave a running local service with a restart command.

Frontend worker owns only `static/index.html`, `static/app.js`, `static/styles.css`. Parent owns all other files. Workers do not mutate Git or install dependencies.

## Final scope

National House/Senate control, major governorships, called party changes, Arkansas focus and Sherwood local races. National source is AP via NPR's public 2026 JSON. A candidate's explicit winner marker determines a call; votes or reporting percentages never do. NPR's fixed 2026 Senate holdover baseline is 32 Democrats, 31 Republicans, and 2 independents caucusing with Democrats. House has no holdovers. Public feed currently omits TX-18 and WI-08; absent feeds never become assumed wins.

`chambers` contains office, total, majority, dem, rep, other, uncalled, loaded, expected, source, sourceId, url, asOf, status and note. `dem` in Senate means caucus seats. Race objects may include called, winnerParty, winnerName, previousParty, flip, keyRace, caucusWith, sourceAsOf and callAt. `flips` contains only called party changes. NPR takes precedence over direct state feeds for overlapping national races; direct sources take precedence over Open America. Local Sherwood races have office Other. Source `pollIntervalSeconds` controls freshness checks; upstream polling respects provider caches. The browser polls cached results every 30 seconds.
