# Apartment Hunter

A site for finding NYC room shares. It collects posts from roommate subreddits,
Craigslist, and Facebook posts you paste in. It keeps **1–3 bedroom** places
where **your share is $1,700/mo or less**, and shows how many roommates you'd
be joining.

For each listing you get your monthly share, bedrooms, the number of roommates
already living there, the move-in date, the neighborhood, and washer/dryer
details. Each one links to the original post and to a way to contact the
poster: a prefilled Reddit DM, the Craigslist reply page, or the Facebook post.

You can filter by neighborhood, washer/dryer (in unit / in building),
bedrooms, number of roommates, max share, move-in date, source, and keywords.
You can sort by price, number of roommates, newest post, or soonest move-in.
Stars (save) and ✕ (hide) are remembered in your browser.

## Quick start

Requires Node 20+. There are no dependencies to install.

```bash
npm run scrape   # fetch Reddit + Craigslist, write public/data/listings.json
npm start        # http://localhost:3000
```

When you run it locally, the site has two extra buttons:

- **Refresh now**: re-scrapes every source.
- **+ Add a listing**: paste a Facebook post (or anything else) with its link.
  The details are pulled out automatically, and you can correct any field.
  Entries are saved in `data/manual.json`.

## Sources

| Source | How | Notes |
| --- | --- | --- |
| Reddit: r/RoommatesNYC, r/NYCapartments | Reddit JSON API, newest 300 posts per sub per run | "Looking for a room" posts are filtered out using flair and title. |
| Craigslist NYC: rooms & shares, sublets | Search RSS feed | Best effort. Craigslist often blocks or changes this feed, and failures are skipped. |
| Facebook groups | **Pasted in by hand** | See below. |

**Why Facebook isn't scraped automatically:** Facebook groups can only be seen
while logged in, and Facebook's terms forbid automated collection. Accounts
that scrape tend to get locked. The paste-in form is the safe route.

Change the subreddits with `SUBREDDITS=RoommatesNYC,NYCapartments,SomeOtherSub`.

### Reddit API credentials (recommended when hosted)

Reddit often blocks requests from cloud servers that aren't signed in, which
includes GitHub Actions. Setting up a free "script" app takes about 2 minutes:

1. Go to https://www.reddit.com/prefs/apps, then **create another app…**,
   choose type **script**, and use `http://localhost` as the redirect URI.
2. Set `REDDIT_CLIENT_ID` (the string under the app name) and
   `REDDIT_CLIENT_SECRET`. Use env vars locally, or add them as repository
   secrets for the GitHub Action.

## Hosting (free, auto-updating)

`.github/workflows/scrape.yml` runs every 3 hours. It runs the tests, scrapes,
commits the new `listings.json`, and publishes `public/` to GitHub Pages.

1. Merge to `main`.
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Add the Reddit secrets (above).
4. Optional: in **Settings → Variables → Actions**, set `MAX_SHARE` or
   `SUBREDDITS`.

The hosted site is read-only. To add Facebook posts, run it locally and push
`data/manual.json`.

## Configuration

Set these as environment variables. Defaults are in `scraper/config.js`.

| Var | Default | |
| --- | --- | --- |
| `MAX_SHARE` | 1700 | Max monthly share |
| `MIN_BEDROOMS` / `MAX_BEDROOMS` | 1 / 3 | Bedrooms in the apartment |
| `MAX_AGE_DAYS` | 30 | Listings older than this drop off |
| `SUBREDDITS` | RoommatesNYC,NYCapartments | Comma-separated |
| `REDDIT_PAGES` | 3 | Pages of 100 posts per subreddit per run |
| `CRAIGSLIST` | on | Set to `off` to skip |

## How the details are pulled out of posts

Posts are free text, so `scraper/parse.js` uses pattern matching:

- **Your share:** the dollar amounts in the post, skipping deposits, broker
  fees, utilities, and income requirements. If several rooms have different
  prices, the card shows a range. For whole-apartment posts (lease takeovers),
  the total rent is split by the number of bedrooms.
- **Roommates you'd join:** taken from phrases like "living with 2 roommates",
  "join two others", or "live with me". If the post doesn't say, it's
  estimated as bedrooms minus the rooms on offer, and the card shows *(est.)*.
- **Move-in:** dates like "Nov 1", "11/1", "mid-October", or "ASAP".
- **Neighborhood:** about 100 NYC neighborhoods plus common abbreviations
  (LES, UWS, Bed-Stuy, LIC, PLG…), grouped by borough.
- **Laundry:** in-unit, in-building, or none.

Listings missing a price or bedroom count are hidden by default. Tick
*Include listings missing price or bedrooms* to see them. If something was
read wrong, re-add the post with corrections.

## Development

```bash
npm test         # parser + pipeline tests
npm run rebuild  # reprocess stored + manual listings without hitting the network
```
