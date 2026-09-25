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

A scraping-first aggregator: **website → scraper → extractor → normalized
listing → dedupe → output → UI**. Every source was investigated by actually
requesting its listing pages from GitHub Actions (`probe/investigate.js`,
2026-09-25): one plain request per page type with an honest bot User-Agent,
no login, no cookies, no retries, nothing that defeats a block. The site's
**Sources** panel shows each source's full investigation record: pages tested,
robots.txt, terms, blockers and the next step.

| Source | Status | What happened when we tried to scrape it |
| --- | --- | --- |
| **June Homes** | ✅ LIVE | Neighborhood index pages and room pages fetched and parsed (schema.org data + photos). robots.txt allows this, and the terms have no scraping clause. |
| **Roomster** | ✅ LIVE | Index and listing pages fetched and parsed (JSON-LD + gallery). robots.txt allows this, and the terms have no scraping clause. |
| **Roomi** (roomiapp.com) | ⛔ PERMISSION_REQUIRED | Technically works: the NYC search page is server-rendered with about 90 structured listings (price, room type, bedrooms, move-in, lease, map pin, photos). The adapter parses them. robots.txt allows the search page and disallows `/listings/`. But the terms prohibit "webcrawler, spidering or other automated means to access, copy, index, process and/or store any Content … other than as expressly authorized by us". The adapter stays disabled until Roomi authorizes it (`ENABLE_SOURCES=roomi`). |
| **Reddit** | 🔑 AUTH_REQUIRED | robots.txt is `Disallow: /`. Subreddit pages, `.json`, search, infinite scroll, old.reddit and post pages all returned **HTTP 403** ("blocked by network security"). Only the RSS feed answered, with 3 items. The User Agreement prohibits scraping without written consent. The permitted route is the official Data API. That adapter is built and waits for `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`. |
| **Facebook** (Groups) | ⏳ UNVERIFIED until a real run | Collected through **Bright Data's** "Facebook - Posts by group URL" API (dataset `gd_lz11l67o2cb3r0lkj3`). Only public Groups are collected, logged off. This project never contacts facebook.com and uses no login, cookies or browser. Bright Data is not authorized by Meta; see the notes in the Sources panel. Needs `BRIGHTDATA_API_KEY` and `FACEBOOK_GROUPS`. |
| **Diggz**, **Roomies.com** | ⏸ UNVERIFIED | Pages parse, but the terms pages are behind a Cloudflare challenge. Enable with `ENABLE_SOURCES` only after reading their terms. |
| Craigslist, SpareRoom, Listings Project, StreetEasy, Leasebreak, PadMapper, Zumper, Bungalow, Nooklyn, Coliving.com, HousingAnywhere, PadSplit, Kopa | ⛔ PERMISSION_REQUIRED | Terms or robots.txt prohibit automated access (the exact clauses are in `scraper/sources/index.js`) |
| RentHop, Outpost Club, HotPads, Bedly, Furnished Finder | 🚫 BLOCKED | Anti-bot challenge (HTTP 403) |

Each source records separately:
- `technicallyAccessible`
- `scrapingTested`
- `robots`
- `termsReviewed`
- `automatedAccessPermitted`
- `enabled`
- `lastSuccessAt`
- `lastFailureAt`
- `failureReason`

Status is one of `LIVE`, `LIVE_WITH_LIMITATIONS`, `BLOCKED`, `AUTH_REQUIRED`, `PERMISSION_REQUIRED`, `NO_PUBLIC_ACCESS`, `DISABLED` or `UNVERIFIED`. A source is `LIVE` only in a run where it actually retrieved and parsed real listings.

The scraper always identifies itself honestly (`ApartmentHunterBot/0.2 (+repo URL)`):
- It checks robots.txt before every request.
- It waits at least 1.5 s between requests to the same site.
- It stops requesting from a site for the rest of the run once that site blocks it.

## Quick start (local)

Requires Node 20 or newer. No dependencies are needed.

```bash
npm run scrape   # fetch every enabled source → public/data/{listings,status}.json
npm start        # http://localhost:3000
```

Reddit needs an approved Reddit Data API app. Set `REDDIT_CLIENT_ID` and
`REDDIT_CLIENT_SECRET`.

Facebook Groups need a Bright Data API key and at least one public Group:

```bash
BRIGHTDATA_API_KEY=… FACEBOOK_GROUPS='["https://www.facebook.com/groups/<group>/"]' npm run scrape
```

In GitHub, add `BRIGHTDATA_API_KEY` as a repository **secret** and
`FACEBOOK_GROUPS` as a repository **variable** (Settings → Secrets and
variables → Actions). Each run asks Bright Data only for posts since the last
successful run, minus a 6-hour overlap. A few settings cap cost (Bright Data
bills per record):

| Setting | Default | What it does |
| --- | --- | --- |
| `FACEBOOK_MAX_WINDOW_DAYS` | 7 | Longest date window a run can request |
| `FACEBOOK_MIN_HOURS_BETWEEN_RUNS` | 6 | Skips collection if the last success was more recent |
| `FACEBOOK_MAX_GROUPS` | 3 | Most Groups queried per run |
| `FACEBOOK_MAX_WAIT_SECONDS` | 600 | Gives up after this; a collection is never re-triggered |

Posts are kept only when the text is a housing offer. Seeking, ISO and
"anyone know a place" posts are rejected. Prices, roommates and move-in dates
go through the same conservative rules as every other source. Poster names
and profiles are never stored. Facebook image links expire, so expired photos
are dropped.

## Architecture

```
scraper/sources/<site>.js   one adapter per source → partial listing
scraper/schema.js           normalized listing: every field is { value, basis }
scraper/extract.js          the extraction layer: text → fields (deterministic rules today;
                            any replacement, e.g. a model, must keep this interface)
scraper/parse.js            the rules behind it (price, listing type, roommates, dates, laundry…)
scraper/photos.js           checks photos load for an anonymous visitor
scraper/dedupe.js           cross-source duplicates (see below)
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

**Cross-source duplicates.** Two listings merge into one card, which keeps
every original URL ("Found on 2 sources"), in either of these cases:
- They share an identity signal: the same URL or the same photo.
- They have at least 4 points of evidence, and some of it is specific to the
  listing: description similarity, the same contact, the same street address,
  or map pins within 120 m.

Generic facts never merge listings by themselves, however many agree: price,
bedrooms, neighborhood and move-in date. Any stated conflict vetoes a merge:
different bedrooms, room vs entire apartment, price, borough, or move-in
dates more than 45 days apart.

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
do nothing.** Once it is private, each run:
1. restores the previous run's data from the `live-data` branch;
2. scrapes each enabled source independently, so one blocked source never
   stops the others;
3. sanitizes the output: emails and phone numbers are removed from listing
   text, and street addresses are dropped except for business listings;
4. runs a privacy audit (`scripts/sanitize.js`);
5. only if the audit passes, publishes `listings.json` and `status.json` to
   `live-data` as one force-pushed commit with no history.

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

**Held-out extraction accuracy.** `scripts/holdout.js` measures the
extractor on listings it was never tuned on:
1. **freeze** unseen listings from a verify run. This records a fingerprint
   of the extractor code.
2. **label** what each listing states.
3. **score** precision, recall and the unsupported-value rate per field
   before any rule changes. If the extractor changed since the freeze, the
   scorer says the result is not held-out.

`scripts/eval-extraction.js` scores the (tuning) labeled set. Labeled sets
contain real listing text and stay out of the repository.
