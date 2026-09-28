# Source assessment: Roomi, Listings Project, Diggz, SpareRoom, RoomieMatch (2026-09-28)

**Result: none of the five may be collected automatically. No new scraper
was added or enabled.** Each source's full record is in
`scraper/sources/index.js` and on the site's Sources panel.

## Method

- One plain request per page with the honest bot User-Agent. robots.txt is
  checked first. No login, no cookies, no retries, no challenge solving.
- The pass read only robots.txt, the homepage (to find the terms link) and
  the terms pages. **No listing, search or profile page was requested.** The
  terms were checked before any collection.
- Ran on GitHub Actions: `probe/candidates.js`, entries `*terms`, runs
  36470818701 and 36470975323. The logs contain only structure and public
  legal text.
- The Claude Code container used for this change can't reach any of these
  hosts (its egress policy denies them), so every request went through
  GitHub Actions.

## Answers per question

| # | Question | Diggz | Roomi | SpareRoom | Listings Project | RoomieMatch |
|---|---|---|---|---|---|---|
| 1 | Public listing/search page? | Yes in a browser. Our bot gets a Cloudflare challenge (403) on the homepage | Yes (`/rooms-for-rent/new-york`, `/browse-rooms`) | Yes (browse without registration) | Partly. Terms say the platform requires registration | No. Matching is based on member questionnaires |
| 2 | NYC data without login? | Yes in a browser (2026-09-25 probe) | Yes (~90 listings in page data, 2026-09-25) | Partly | Partly | No public listing inventory |
| 3 | Documented API / feed / structured endpoint? | **None** documented. JSON-LD exists in pages, but that isn't an access grant | **None**. robots.txt disallows `/api/` | **None** public | **None** | **None** |
| 4 | Terms permit automated collection? | **No**: "use any automated tool (e.g., robots, spiders) to access or use our Services or to store, copy … any Service Content"; also "compile or collect any Service Content as part of a database" | **No**: "webcrawler, spidering or other automated means to access, copy, index, process and/or store any Content … other than as expressly authorized by us, is prohibited" (terms dated 2022-06-09) | **No**: may not "harvest information, with use of software or otherwise … other than as specifically authorized" | **No**: "Scraping and Republishing Prohibited", covering harvesting, crawling, aggregating, storing, republishing and redistributing listings | **No**: "Copying more than a few sentences … is NEVER permitted" |
| 5 | robots.txt allows the pages? | Yes (only `/like` actions disallowed) | Search pages yes; `/listings/` detail pages **no** | Detail scripts (`room_for_rent.pl`, `roommate_detail.pl`) **no** | Blocks AI-training bots from listings; otherwise open | Yes (no Disallow) |
| 6 | Useful for this app? | Very: real NYC lease inventory | Yes | Yes | Yes | Low: profiles, not listings |
| 7 | Ordinary residential leases? | Yes: individual-room and whole-apartment leases, mixed with sublets | Mixed | Mixed | Mostly sublets and short-term | n/a |
| 8 | Lease duration, move-in, rent, room vs entire, URL? | Yes, from structured page data | Yes, structured | Likely | Likely | n/a |
| 9 | Photos obtainable legitimately? | Visible on the site. Copying/storing them automatically is prohibited | In-line linking is prohibited by the terms | Not assessed (terms prohibit collection) | Photos are copyrighted per the terms | n/a |
| 10 | Auth required for the relevant data? | No, but anti-bot challenge | No | No (browse) | Terms say yes | Yes (member matching) |

## Verdicts

| Source | Status | Why | What would change it |
|---|---|---|---|
| **Diggz** | `PERMISSION_REQUIRED` | Terms prohibit automated tools for access and for storing/copying content. No API or feed. Cloudflare challenge on bot requests. | Written permission, or a data feed/API from Diggz. The disabled adapter is `leasesOnly` and would still go through a verify run and audit before production. |
| **Roomi** | `PERMISSION_REQUIRED` | Terms prohibit crawling and automated copying/indexing/storing "other than as expressly authorized". No API. | Roomi's express written authorization. The adapter exists (disabled). |
| **SpareRoom** | `PERMISSION_REQUIRED` | Terms prohibit harvesting information with software. robots.txt disallows the detail pages. No public API. | An official partner feed or written permission. |
| **Listings Project** | `PERMISSION_REQUIRED` | Terms explicitly prohibit scraping, aggregating, storing and republishing listings. | Not pursued: an aggregator is exactly what the terms forbid. |
| **RoomieMatch** | `NO_PUBLIC_ACCESS` | Member-profile matching, not public listings. Copying is prohibited. Profiles are personal data. | None. |

"Visible in a browser" was never treated as permission. Diggz was the top
candidate on data quality, but its terms are explicit.

## Groundwork added for any future source

This only matters if a source is later authorized. None is enabled by this
change.

- **Lease category** (`scraper/lease.js`) sorts each listing into `LEASE`,
  `SUBLET`, `LEASE_TAKEOVER`, `SHORT_TERM` or `UNKNOWN`. It's decided from
  structured lease durations and explicit wording; "flexible" alone decides
  nothing, and ambiguous listings stay `UNKNOWN`. The listing-type schema is
  unchanged. For sources whose adapter sets `leasesOnly: true`, sublets,
  takeovers and short stays are classified but not published, and are
  counted as discarded.
- **Dedupe** (`scraper/dedupe.js`):
  - Same street address + same apartment/unit counts as unit-level
    evidence.
  - Different units, or different room labels ("Room A" / "Room B"),
    **veto** a merge. That includes merges based on shared photos, since
    rooms in one apartment often share photos of the common areas.
  - Address spelling variants such as "550 W 157th St" and "550 West 157th
    Street" normalize to the same address.
  - Behavior change: two listings giving *different* explicit units at one
    address no longer merge. Before this change the unit was ignored.
- **Real-data check**: `.github/workflows/prod-dryrun.yml` with
  `scripts/dedupe-check.js`. It runs these checks against the published
  dataset:
  - re-dedupe stability
  - exact cross-source copies merge back
  - reformatted near-duplicates merge
  - Room A / Room B pairs never merge

  It then runs the production pipeline without deploying anything. The log
  shows counts only.
