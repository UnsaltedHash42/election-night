# Public edition

Only `public/` goes to Cloudflare Pages. It contains a race directory and an interface for watch.vote's permitted embeds. It does not run the personal Python service, read its cache, copy NPR/AP results, calculate national control, or count flips. National control and party changes link to NPR/AP. The provider identifies the source, freshness and call status within each race card.

Home state and watchlist choices stay in the visitor's browser. A shared `?state=AR` link sets an initial home state. No address or browser location permission is needed. Each page loads at most six race cards; their provider controls result updates.

## Preview and check

```sh
python3 -m unittest test_feeds.py test_public.py
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
- The directory has names of offices and seats, not candidates or results: [FEC 2026 election calendar](https://www.fec.gov/resources/cms-content/documents/2026pdates.pdf), [Census House apportionment](https://www2.census.gov/programs-surveys/decennial/2020/data/apportionment/apportionment-2020-table01.pdf), and [NGA governor elections](https://www.nga.org/governors/elections/).
- The 507 directory entries comprise 435 House seats, 35 Senate races, 36 state governor races and the D.C. delegate. This is a directory, not a claim that every provider widget currently reports results. Territorial races other than D.C. are not included. Featured races are a browsing shortcut, not ratings or forecasts.
- [Cloudflare Pages direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) and [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) describe deployment and DNS setup.
