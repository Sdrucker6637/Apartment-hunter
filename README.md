# Apartment Hunter

One search across NYC roommate and room-rental sites. It collects real
listings from each source that legitimately permits it, extracts what a
roommate-seeker needs, removes duplicates, and shows everything in one
photo-first interface. The fields it extracts are:

- your monthly share
- where the place is
- what kind of listing it is: room in a shared apartment, entire
  apartment, sublet, lease takeover, or unknown
- how many roommates already live there (only when the listing says so)
- when you can move in
- laundry
- whether it's furnished
- photos

Every extracted fact records **how we know it**:

| Label | Meaning |
| --- | --- |
| **From listing** | Taken from the source's own structured data |
| **Stated** | Written in the listing text |
| **Calculated** | Derived from stated facts. For example, total rent ÷ people, but only when the post says the rent is split evenly. |
| **Estimated** | Apartment Hunter's inference, e.g. borough from map coordinates. Roommate counts are **never** estimated: if a listing doesn't state them, the card says "Roommates not stated". |
| **Likely your share** | The post gives one price but doesn't say it's per person |
| **Needs confirmation** | Only a total rent is known, so your share is unknown |

## Sources

Each source was evaluated against its robots.txt and terms of use, and tested
live from GitHub Actions on 2026-09-25 (scripts are in `probe/`).

| Source | Status | How | Photos |
| --- | --- | --- | --- |
| **June Homes** | ✅ Live | Public pages with schema.org JSON-LD. robots.txt allows the crawl, and the terms have no scraping clause. | Yes, hotlinkable |
| **Roomster** | ✅ Live | Public pages with JSON-LD. robots.txt allows the crawl, and the terms have no scraping clause. Messaging needs a Roomster account. | Yes, hotlinkable |
| **Reddit** (r/RoommatesNYC, r/NYCapartments) | 🔑 Needs credentials | Official Data API only. Scraping reddit.com is prohibited, and new apps need Reddit's approval. | Post images, when attached |
| **Diggz**, **Roomies.com** | ⏸ Disabled | Their public pages have good structured data, but their terms pages block automated readers, so permission can't be confirmed. You can enable them with `ENABLE_SOURCES=diggz,roomies` after reading their terms. | Yes |
| **Facebook groups** | ✋ Manual only | robots.txt disallows everything, and Meta's terms require written permission. Paste posts in with **+ Add a post** when running locally. | Only photos you add |
| Craigslist, SpareRoom, Listings Project, StreetEasy, Roomi, Leasebreak, PadMapper, Zumper, Bungalow | ⛔ Not permitted | Their terms explicitly prohibit scraping (the exact clauses are in `scraper/sources/index.js`) | – |
| RentHop, Outpost Club, HotPads | ⛔ Blocked | Anti-bot challenge (HTTP 403) on every page | – |

The scraper always identifies itself honestly
(`ApartmentHunterBot/0.2 (+repo URL)`). It checks robots.txt before every
request and waits at least 1.5 s between requests to the same site. It never
tries to get around a block. On both live sites, robots.txt forbids the
paginated URLs, so the crawler walks each site's per-neighborhood pages
instead.

## Quick start (local)

Requires Node 20 or newer. No dependencies are needed.

```bash
npm run scrape   # fetch every enabled source → public/data/{listings,status}.json
npm start        # http://localhost:3000
```

Running it locally also enables **+ Add a post**, which saves pasted posts to
`data/manual.json`.

Reddit needs an approved Reddit Data API app. Set `REDDIT_CLIENT_ID` and
`REDDIT_CLIENT_SECRET`.

## Architecture

```
scraper/sources/<site>.js   one adapter per source → partial listing
scraper/schema.js           normalized listing: every field is { value, basis }
scraper/extract.js          the extraction layer: text → fields (deterministic rules today;
                            any replacement, e.g. a model, must keep this interface)
scraper/parse.js            the rules behind it (price, listing type, roommates, dates, laundry…)
scraper/photos.js           checks photos load for an anonymous visitor
scraper/dedupe.js           cross-source duplicates (URL, shared photo, contact, text+price)
scraper/index.js            pipeline + per-source status → public/data/*.json
public/                     static site (no build step)
probe/                      source feasibility probes (robots, terms, live fetch)
```

**Price rules.** Total rent is never divided by bedrooms. "$3,000 2BR,
looking for a roommate" gives your share as *unknown*. "$3,000 total, split
evenly" gives $1,500, labeled *Calculated*. "Room available for $1,400" gives
$1,400, labeled *Stated*.

Every listing carries a price model: *your share*, *total apartment*, how the
split is known (whole unit / even split stated / room price stated) and a
status (`known`, `needs_confirmation`, `not_listed`).

**Adding a source.** Write an adapter in `scraper/sources/` that exports
`meta` (id, label, `uniqueIds`, `requiresEnable`…) and `fetch()` returning
partial listings, and register it in `scraper/sources/index.js`. Filters,
source checkboxes, counts and the quality report pick it up automatically.

**Photos.** The site links to each source's own image URL and never re-hosts
images. The pipeline drops photos that don't load anonymously. In the browser,
a photo that fails to load is replaced with a drawn placeholder that says so.
It's never a stock photo.

## Privacy and the scheduled scraper

`.github/workflows/scrape.yml` runs every 3 hours, but its first step checks
whether the repository is private. **While the repo is public, scheduled runs
do nothing.** Once it is private, each run publishes `listings.json` and
`status.json` to the `live-data` branch (one force-pushed commit, no history).

Workflow logs contain counts and statuses only, never listing text, names,
phone numbers, emails or HTML:

```
June Homes: 76 listings (95 retrieved) · status LIVE · photos 76/76 · …
Roomster: 27 listings (105 retrieved) · status LIVE · photos 27/27 · …
Total: 103 listings · photos 103/103 · …
Errors: 0
```

For testing while public, **Run workflow → mode: verify** encrypts the results
on the runner and pushes only ciphertext to the `verify-output` branch. The
private key isn't in the repo. The feasibility probes in `probe.yml` refuse
to run any stage that prints listing content on a public repo.

Or run `npm run scrape` on your own machine and open `public/data/status.json`.

## UI development without live data

```bash
node scripts/make-sample.js && DATA_DIR=sample npm start
```

This serves clearly labeled **SAMPLE** data: a striped banner, SAMPLE tags,
and photos that literally read "SAMPLE PHOTO". Sample data is never written
to `public/data`.

## Tests

`npm test` runs the parser and adapter tests. These use fixtures that mirror
the live JSON-LD shapes. Passing tests show that the parsing logic works. They
don't show that a source is reachable. Live retrieval is verified by the
workflow above.

`node scripts/eval-extraction.js <gold.json> --details` scores the extraction
layer against hand-labeled real listings (per field: found, wrong/unsupported,
missed). The labeled set contains real listing text, so it is kept out of
the repository until the repository is private.
