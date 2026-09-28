// Source registry: every source we evaluated, what we found when we tried to
// scrape it, whether it runs, and why. Findings come from live probes run on
// GitHub Actions (probe/*.js; 2026-09-25): rules runs 36169035176 /
// 36180880639, listing runs 36169233618 / 36169521877 / 36169769596,
// scraping investigations 36182322402 and later (probe/investigate.js).
//
// Review fields (kept separate on purpose):
//   technicallyAccessible  listing content reachable with a plain request (true / false / 'partial')
//   scrapingTested         we fetched and parsed real listing pages
//   robots                 what robots.txt says for the listing pages
//   termsReviewed          we read the terms that apply
//   automatedAccessPermitted  'yes' | 'no' | 'unclear' | 'api-only'
// A source runs only when it has an adapter AND is enabled (by default, or via
// ENABLE_SOURCES for sources whose permission is unclear).

import * as junehomes from './junehomes.js';
import * as roomster from './roomster.js';
import * as roomi from './roomi.js';
import * as reddit from './reddit.js';
import * as facebook from './facebook.js';
import * as jsonldSites from './jsonld-sites.js';

const CHECKED = '2026-09-25';
// Round 3 re-check (probe/candidates.js *terms entries; investigate runs 36470818701, 36470975323).
const RECHECKED = '2026-09-28';

export const SOURCES = [
  {
    ...junehomes.meta, domain: 'junehomes.com', enabledByDefault: false,
    defaultStatus: 'DISABLED',
    reason: 'Disabled as a production source (2026-09-25): June Homes is mostly furnished, flexible/short-term company-managed housing, not the individual long-term room shares this app aggregates. The adapter still works; set ENABLE_SOURCES=junehomes to run it.',
    nextStep: 'None planned. Kept for reference; not counted toward core listing totals.',
    run: (cfg, log) => junehomes.fetchListings({ ...cfg.junehomes, maxShare: cfg.maxShare, log }),
    review: {
      checkedAt: CHECKED, technicallyAccessible: true, scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'yes',
      robots: 'Allows neighborhood pages and room pages; disallows ?page= pagination (we crawl per-neighborhood pages instead).',
      pagesTested: ['/new-york/… neighborhood index pages', 'room detail pages'], pagination: 'Per-neighborhood index pages (?page= disallowed)', photos: 'Yes — room photo + shared-space photos',
    },
  },
  {
    ...roomster.meta, domain: 'roomster.com', enabledByDefault: true,
    run: (cfg, log) => roomster.fetchListings({ ...cfg.roomster, maxShare: cfg.maxShare, log }),
    review: {
      checkedAt: CHECKED, technicallyAccessible: true, scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'yes',
      robots: 'Allows index and listing pages; disallows ?search_params pagination (we crawl per-neighborhood pages instead).',
      pagesTested: ['/rooms-for-rent/new-york-ny-usa', '/apartments-for-rent/new-york-ny-usa', 'neighborhood index pages', '/listings/<id>'], pagination: 'Per-neighborhood index pages', photos: 'Yes — full gallery on detail pages',
      termsNotes: [
        'No clause on scraping, crawling, robots or automated access (re-read in full 2026-09-25).',
        'Listings are user "Contributions", which the terms exclude from Roomster\'s own "Materials"; Materials are "for your information and personal use only and not for commercial exploitation".',
        'Prohibited activities include "engaging in unauthorized framing of, or linking to, the Service without our express written consent" — read strictly, a public site linking to Roomster listings is a grey area; fine for personal use.',
      ],
    },
  },
  {
    ...roomi.meta, domain: 'roomiapp.com', enabledByDefault: false,
    run: (cfg, log) => roomi.fetchListings({ log }),
    review: {
      checkedAt: RECHECKED, technicallyAccessible: true, scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'no',
      robots: 'Re-read 2026-09-28: allows / and /rooms-for-rent/ search pages; disallows /listings/ (detail pages), /api/, /messages/, /my-profile/ and auth pages.',
      blockers: [
        'Terms (roomiapp.com/legal?tab=terms, "Last updated on June 9, 2022", re-read 2026-09-28): "The framing or scraping of or in-line linking to our Services or any Content, and/or the use of webcrawler, spidering or other automated means to access, copy, index, process and/or store any Content or the Services, other than as expressly authorized by us, is prohibited."',
        'Also prohibits "\"spidering\", \"screen scraping\" … \"database scraping\", or any other activity with the purposes of obtaining lists of other users or other information", and using the Services "to construct any kind of database or search engine".',
        'No public API or feed: robots.txt disallows /api/ and the terms mention no developer/partner access.',
      ],
      pagesTested: ['2026-09-25: /rooms-for-rent/new-york (90 listings in page data), ?page=2 (same 90), /sitemap.xml, /find-roommates/new-york', '2026-09-28 (terms/robots only; no listing page requested): /robots.txt, / (→ /browse-rooms), /legal?tab=terms'],
      pagination: 'None: ?page=2 returns the same 90 listings; sitemap lists city pages (/rooms-for-rent/…) but no listings', photos: 'Yes — up to 10 photos per listing in the search page data (in-line linking is prohibited by the terms)',
    },
    defaultStatus: 'PERMISSION_REQUIRED',
    reason: 'Technically scrapeable: the NYC search page carries ~90 structured listings with photos, and the adapter parses them. But Roomi\'s terms (re-verified 2026-09-28) prohibit crawling or automated copying/storing of content (and in-line linking) unless Roomi expressly authorizes it, and there is no public API.',
    nextStep: 'Ask Roomi for written authorization (their terms allow use "expressly authorized by us"). With it, set ENABLE_SOURCES=roomi; the adapter is built and was tested against the live page.',
  },
  {
    ...reddit.meta, domain: 'reddit.com', enabledByDefault: true, needsCredentials: (cfg) => !cfg.reddit.clientId || !cfg.reddit.clientSecret,
    run: (cfg, log) => reddit.fetchListings({ ...cfg.reddit, log }),
    review: {
      checkedAt: CHECKED, technicallyAccessible: 'partial', scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'api-only',
      robots: 'www.reddit.com and old.reddit.com: "User-agent: * / Disallow: /" (points to the Public Content Policy).',
      pagesTested: ['/r/RoommatesNYC/new/ (403)', 'old.reddit.com/r/RoommatesNYC/new/ (403)', '/r/RoommatesNYC/new.json (403)', 'old.reddit.com/r/NYCapartments/new.json (403)', '/r/NYCapartments/search.json (403)', '/svc/shreddit/community-more-posts (403)', '/r/<sub>/about.json ×6 (403)', 'post page (403)', '/r/RoommatesNYC/new/.rss (200, only 3 entries)', 'oauth.reddit.com without token (403)'],
      pagination: 'after= cursor (API)', photos: 'Post images/galleries when attached (via API)',
      blockers: ['robots.txt disallows everything', 'User Agreement: no automated collection except as permitted', 'HTTP 403 "blocked by network security" on every page except RSS'],
    },
    authReason: 'Reddit pages are closed to crawlers (robots.txt "Disallow: /", HTTP 403 on every page but a 3-item RSS feed). The permitted route is the official Data API, which needs an approved app.',
    nextStep: 'Register a Reddit app (reddit.com/prefs/apps, "script" or "web" type), request Data API access under the Responsible Builder Policy, then add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET as repository secrets. The adapter is already built.',
  },
  {
    ...facebook.meta, domain: 'facebook.com (via Bright Data)', enabledByDefault: true,
    needsCredentials: (cfg) => !cfg.facebook.apiKey,
    authReason: 'BRIGHTDATA_API_KEY is not set (repository secret). Facebook Groups are collected through Bright Data\'s API.',
    notConfigured: (cfg) => !cfg.facebook.groups.length,
    notConfiguredReason: 'FACEBOOK_GROUPS is not configured (repository variable: one or more public Facebook Group URLs).',
    run: (cfg, log, ctx) => facebook.fetchListings(cfg, log, ctx),
    review: {
      checkedAt: '2026-09-26', technicallyAccessible: 'partial', scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'unclear',
      robots: 'Not applicable to us: we do not request facebook.com. Bright Data collects the posts; facebook.com/robots.txt disallows all crawling without written permission.',
      pagesTested: [
        'Bright Data, 2026-09-26 (the only verified run): ONE public group (groups/1225966920763001), one 7-day window → 189 real post records (0 error records) in ~9.6 min; 155 of 189 posts had image URLs (639 URLs)',
        'Parser audit on those 189 real posts (private, hand-labeled; not a held-out set — the rules were tuned on it): 117 offers / 63 seekers / 9 other or ambiguous; after fixes 114 accepted, 0 seekers accepted, 3 offers missed (2 outside NYC by design, 1 with a masked "$5xxx" price and no offer wording); 112 of the 114 have photos',
        'Direct (2026-09-25): 7 public NYC housing groups, m./mbasic. group pages and Marketplace all redirect to the login page; Graph API needs an app',
      ],
      pagination: 'Date window per run (start_date / end_date); incremental since the last successful run',
      photos: 'Often, not always — in the verified run 155 of 189 posts had image URLs; 104/104 checked images loaded anonymously on 2026-09-26. Facebook CDN links expire (oe=); expired ones are dropped and the listing links to the post instead.',
      termsNotes: [
        'Collection provider: Bright Data ("Facebook - Posts by group URL", dataset gd_lz11l67o2cb3r0lkj3). Logged-off, public Groups only; private/members-only Groups return nothing.',
        'Not authorized by Meta. Meta\'s terms require its prior permission for automated collection (logged in or not); in Meta v. Bright Data (N.D. Cal., Jan 2024) the court held Meta\'s then-current terms did not bar Bright Data\'s logged-off collection of public data, and Meta dropped its remaining claims. Meta has since revised its terms.',
        'Bright Data\'s service uses rotating proxies and CAPTCHA handling on its side. Nothing in this project logs in to Facebook, uses cookies or session tokens, or contacts facebook.com.',
        'Poster names and profile links from Bright Data records are never stored; emails, phone numbers and names introduced in the post text ("my name is…", "DM…", "my friend…") are removed by the sanitizer before publishing.',
        'Verified scope: one public group and one 7-day window on 2026-09-26. Other groups, private/members-only groups, longer windows and the field coverage of other posts are UNVERIFIED; not every post has photos, a price, or a stated roommate count.',
      ],
    },
    nextStep: 'Verified for the one configured group only. Before adding groups: run mode: verify for the new group and re-audit its posts (cost: one Bright Data collection per group per run).',
  },
  {
    ...jsonldSites.SITES.diggz.meta, domain: 'diggz.co', enabledByDefault: false,
    run: (cfg, log) => jsonldSites.fetchListings('diggz', { log }),
    review: {
      checkedAt: RECHECKED, technicallyAccessible: false, scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'no',
      robots: 'Re-read 2026-09-28: "User-agent: *" disallows only /like action endpoints; listing pages are allowed. robots.txt does not grant permission the terms withhold.',
      pagination: 'n/a (not crawled)',
      photos: 'Yes on the public pages, but copying/storing Service Content with automated tools is prohibited',
      blockers: [
        'Terms (diggz.co/terms, re-read in full 2026-09-28): you may not "(ii) use any automated tool (e.g., robots, spiders) to access or use our Services or to store, copy, modify, distribute, or resell any Service Content", nor "compile or collect any Service Content as part of a database or other work".',
        'No public API, JSON feed or partner/developer program is documented in the terms, robots.txt or site.',
        'The homepage answers automated requests with a Cloudflare challenge (HTTP 403, 2026-09-28); we do not attempt to pass it.',
      ],
      termsNotes: [
        'Public pages do show real NYC lease inventory (individual-room and whole-apartment leases with rent, move-in, lease duration, photos) — which is why it was the top candidate — but being visible in a browser is not authorization for automated collection.',
        'The adapter (scraper/sources/jsonld-sites.js) stays in the repo, disabled. It would be run only with Diggz\'s written permission; if enabled it must set leasesOnly so sublets and short stays are not published.',
      ],
      pagesTested: ['2026-09-25: /rooms-for-rent/new-york-ny (JSON-LD ItemList parsed), /terms', '2026-09-28 (terms/robots only; no listing page requested): /robots.txt, / (403 Cloudflare challenge), /terms (full text read)'],
    },
    defaultStatus: 'PERMISSION_REQUIRED',
    reason: 'Terms prohibit using automated tools ("robots, spiders") to access the service or to store/copy its content, and compiling its content into a database. No public API or feed exists. The homepage is also behind a Cloudflare challenge for automated requests.',
    nextStep: 'Request written permission or a data feed/API from Diggz (partnership). With it: enable via ENABLE_SOURCES=diggz with leasesOnly, run mode: verify, audit lease/sublet classification, photos, dedupe and privacy before production.',
  },
  {
    ...jsonldSites.SITES.roomies.meta, domain: 'roomies.com', enabledByDefault: false,
    run: (cfg, log) => jsonldSites.fetchListings('roomies', { log }),
    review: { checkedAt: CHECKED, technicallyAccessible: 'partial', scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'no', robots: 'Allows all ("Disallow:" empty)', pagination: '?page=', photos: 'Yes', blockers: ['Terms (roomies.com/terms): may not "engage in screen scraping, database scraping or any other activity with the purpose of obtaining lists of users or other information"', '/rooms/new-york-new-york returns a Cloudflare challenge (HTTP 403)'] },
    defaultStatus: 'PERMISSION_REQUIRED',
    reason: 'Terms prohibit screen/database scraping to obtain lists of users or other information; the NYC rooms page is behind a Cloudflare challenge.',
    nextStep: 'Only with Roomies.com\'s written permission.',
  },
];

// Back-compat alias: sources with an adapter.
export const ADAPTERS = SOURCES.filter((s) => s.run);

// Sources evaluated and deliberately not scraped.
export const EXCLUDED = [
  { id: 'craigslist', name: 'Craigslist NYC', status: 'PERMISSION_REQUIRED', reason: 'Terms: "You agree not to copy/collect CL content via robots, spiders, scripts, scrapers, crawlers." RSS feeds were discontinued.', checkedAt: CHECKED },
  {
    id: 'spareroom', name: 'SpareRoom', domain: 'spareroom.com', status: 'PERMISSION_REQUIRED', checkedAt: RECHECKED,
    reason: 'Terms (US, re-read 2026-09-28) prohibit harvesting information "with use of software or otherwise" except as the terms authorize, and they authorize no automated access. No public API, feed or integration program. Browsing without registration does not authorize automated collection.',
    nextStep: 'Only with written permission or an official partner feed from SpareRoom (Flatshare Ltd).',
    review: {
      checkedAt: RECHECKED, technicallyAccessible: 'partial', scrapingTested: false, termsReviewed: true, automatedAccessPermitted: 'no',
      robots: 'Disallows listing detail scripts (/roommate/room_for_rent.pl, /roommate/roommate_detail.pl) and search-action URLs, among others.',
      blockers: ['Terms (spareroom.com/content/padded/terms-us): users must not "harvest information, with use of software or otherwise, from the Platform for purposes other than as specifically authorized under these Terms"', 'Homepage carries captcha markers for automated requests'],
      pagesTested: ['2026-09-28 (terms/robots only; no listing page requested): /robots.txt, /, /content/padded/terms-us'],
    },
  },
  {
    id: 'listingsproject', name: 'Listings Project', domain: 'listingsproject.com', status: 'PERMISSION_REQUIRED', checkedAt: RECHECKED,
    reason: 'Terms of Use (re-read 2026-09-28), section "Scraping and Republishing Prohibited": no one may, "whether manually or by automation", harvest, crawl, scrape, aggregate or store "any listing or other Content", nor republish, collect/store or redistribute listings. The terms describe the platform as requiring registration. No API.',
    nextStep: 'Not pursued: the terms forbid exactly what an aggregator does (storing, aggregating and republishing listings).',
    review: {
      checkedAt: RECHECKED, technicallyAccessible: 'partial', scrapingTested: false, termsReviewed: true, automatedAccessPermitted: 'no',
      robots: 'Blocks AI-training bots from listings; other bots fall through to "User-agent: *" rules. Irrelevant here: the terms prohibit scraping outright.',
      blockers: ['Terms (listingsproject.com/terms-of-use): "extract data from the LP Platform … including … harvesting, crawling, indexing, scraping, spidering, mining, gathering, extracting, compiling, obtaining, aggregating, capturing, or storing any listing" is prohibited', 'Prohibits "(a) republishing any posting, listing …", "(d) collecting, storing, reproducing …", "(e) redistributing …"', 'States the platform requires registration and authentication (non-public)'],
      pagesTested: ['2026-09-28 (terms/robots only; no listing page requested): /robots.txt, /, /terms-of-use, /membership-terms-and-conditions'],
    },
  },
  { id: 'streeteasy', name: 'StreetEasy', status: 'PERMISSION_REQUIRED', reason: 'Zillow terms prohibit "automated queries (including screen and database scraping, spiders, robots, crawlers…)". No public API.', checkedAt: CHECKED },
  { id: 'leasebreak', name: 'Leasebreak', status: 'PERMISSION_REQUIRED', reason: 'Terms: "The use of bots, web crawlers, scripts, or any automated tools to scrape… is expressly prohibited."', checkedAt: CHECKED },
  { id: 'bungalow', name: 'Bungalow', status: 'PERMISSION_REQUIRED', reason: 'Terms prohibit crawling, spidering, harvesting or scraping.', checkedAt: CHECKED },
  { id: 'padmapper', name: 'PadMapper', status: 'PERMISSION_REQUIRED', reason: 'Terms prohibit crawling, scraping or spidering.', checkedAt: CHECKED },
  { id: 'zumper', name: 'Zumper', status: 'PERMISSION_REQUIRED', reason: 'Terms prohibit crawling, scraping or spidering.', checkedAt: CHECKED },
  { id: 'outpostclub', name: 'Outpost Club', status: 'BLOCKED', reason: 'Every page returns a Cloudflare challenge (HTTP 403) to automated requests.', checkedAt: CHECKED },
  { id: 'renthop', name: 'RentHop', status: 'BLOCKED', reason: 'Every page, including robots.txt, returns a Cloudflare challenge (HTTP 403).', checkedAt: CHECKED },
  { id: 'hotpads', name: 'HotPads', status: 'BLOCKED', reason: 'Anti-bot block (HTTP 403 captcha) on all pages.', checkedAt: CHECKED },
  { id: 'sublet', name: 'Sublet.com', status: 'NO_PUBLIC_ACCESS', reason: 'Listings are rendered client-side; no listing data in public HTML and no API.', checkedAt: CHECKED },
  { id: 'common', name: 'Common', status: 'NO_PUBLIC_ACCESS', reason: 'Service defunct; domain now held by a domain broker.', checkedAt: CHECKED },
  { id: 'nooklyn', name: 'Nooklyn', status: 'PERMISSION_REQUIRED', reason: 'Terms prohibit using automated software to "crawl" or "spider" any page, or to "harvest or scrape data".', checkedAt: CHECKED },
  { id: 'colivingcom', name: 'Coliving.com', status: 'PERMISSION_REQUIRED', reason: 'Terms: may not "copy any content… using any robot, spider, scraper or other automated means… without our express written permission".', checkedAt: CHECKED },
  { id: 'housinganywhere', name: 'HousingAnywhere', status: 'PERMISSION_REQUIRED', reason: 'Terms: "web spiders, crawlers, or similar tools for mass accessing or saving Platform content, including screen scraping… is prohibited."', checkedAt: CHECKED },
  { id: 'padsplit', name: 'PadSplit', status: 'PERMISSION_REQUIRED', reason: 'Terms: "you will not access the Site through automated or non-human means, whether through a bot, script, or otherwise".', checkedAt: CHECKED },
  { id: 'kopa', name: 'Kopa', status: 'PERMISSION_REQUIRED', reason: 'robots.txt disallows the whole site for unknown bots.', checkedAt: CHECKED },
  { id: 'bedly', name: 'Bedly', status: 'BLOCKED', reason: 'Cloudflare challenge (HTTP 403) on robots.txt and terms pages.', checkedAt: CHECKED },
  { id: 'furnishedfinder', name: 'Furnished Finder', status: 'BLOCKED', reason: 'Cloudflare challenge (HTTP 403) on its terms pages; permission cannot be confirmed.', checkedAt: CHECKED },
  { id: 'roommatescom', name: 'Roommates.com', status: 'PERMISSION_REQUIRED', reason: 'Terms (roommates.com/tos): may not "Use any robot, spider, crawler, scraper, or other automated means … to access the Services or to extract data"; the NYC rooms page is behind a Cloudflare challenge.', checkedAt: CHECKED },
  { id: 'habyt', name: 'Habyt', status: 'UNVERIFIED', reason: 'robots.txt allows crawling; terms page not found at standard URLs. Needs a manual terms review.', checkedAt: CHECKED },
  {
    id: 'roomiematch', name: 'RoomieMatch', domain: 'roomiematch.com', status: 'NO_PUBLIC_ACCESS', checkedAt: RECHECKED,
    reason: 'Questionnaire-based matching between members\' personal roommate profiles, not a public board of room/apartment listings. Its privacy/terms/copyright page (re-read 2026-09-28) says copying more than a few sentences of the site and reproducing it anywhere "is NEVER permitted". No API. Personal profiles are not collected by this project.',
    nextStep: 'None: no public listing inventory, and copying is prohibited.',
    review: {
      checkedAt: RECHECKED, technicallyAccessible: false, scrapingTested: false, termsReviewed: true, automatedAccessPermitted: 'no',
      robots: '"User-agent: *" with no Disallow (allows crawling). robots.txt does not override the copyright terms.',
      blockers: ['privacy-terms-copyright page: "Copying more than a few sentences of our site and pasting it onto yours or reproducing it anywhere else in any format is NEVER permitted"', 'Data is member roommate profiles (people), which this project does not collect'],
      pagesTested: ['2026-09-28 (terms/robots only; no profile page requested): /robots.txt, /, /privacy-terms-copyright/'],
    },
  },
  { id: 'tripalink', name: 'Tripalink', status: 'UNVERIFIED', reason: 'robots.txt timed out; terms reachable but no NYC listing pages confirmed.', checkedAt: CHECKED },
  // Round 2 source search, 2026-09-25 (probe/candidates.js, investigate runs 36188449879, 36188881559 and later).
  { id: 'roomgo', name: 'Roomgo', status: 'PERMISSION_REQUIRED', reason: 'NYC room listings load (robots allows /new-york/NYC-roommate), but the terms say "You may not publish, distribute, extract, re-utilise, or reproduce any part of the Site or Content in any form (including storing it in any medium)" without permission.', checkedAt: CHECKED },
  { id: 'snag', name: 'Snag (sublets)', status: 'PERMISSION_REQUIRED', reason: 'NYC private-room sublets with price/month, dates, photos and RealEstateListing data; robots allows /post/. But terms 5.8.14 prohibit "page scrape, robot, crawl, index, spider … or other automatic device … to use, access, copy" the platform. Also mostly short-term furnished sublets.', checkedAt: CHECKED },
  { id: 'cohabby', name: 'CoHabby', status: 'PERMISSION_REQUIRED', reason: 'Terms: "Do not scrape, reverse engineer, disrupt, or use unauthorized automation against CoHabby." No listing data on its public NYC page either.', checkedAt: CHECKED },
  { id: 'leaseswap', name: 'Leaseswap', status: 'PERMISSION_REQUIRED', reason: 'Lease-takeover aggregator of other sites; terms prohibit scraping, crawling or automated extraction.', checkedAt: CHECKED },
  { id: 'stooper', name: 'Stooper', status: 'PERMISSION_REQUIRED', reason: 'Terms: "not to harvest information, with use of software or otherwise, from the Platform".', checkedAt: CHECKED },
  { id: 'roomsurf', name: 'RoomSurf', status: 'PERMISSION_REQUIRED', reason: 'College roommate matching; terms prohibit robots/spiders/scrapers (search engines excepted).', checkedAt: CHECKED },
  { id: 'iroomit', name: 'iROOMit', status: 'PERMISSION_REQUIRED', reason: 'Terms: may not "copy, reproduce, modify, republish … any documents or information from this App … without prior written permission"; the NYC page is a client-side app with no listing data in the HTML.', checkedAt: CHECKED },
  { id: 'platuni', name: 'Platuni', status: 'PERMISSION_REQUIRED', reason: 'Terms: may not "Scrape, crawl, harvest, copy, frame, or systematically extract data or content except through an authorized integration or written agreement."', checkedAt: CHECKED },
  { id: 'sharedeasy', name: 'SharedEasy', status: 'PERMISSION_REQUIRED', reason: 'Furnished co-living (poor fit); terms prohibit robots, scrapers and data-extraction tools.', checkedAt: CHECKED },
  { id: 'rentola', name: 'Rentola', status: 'PERMISSION_REQUIRED', reason: 'Terms: may not "Use bots, scrapers, crawlers, or other automated means without our prior written permission."', checkedAt: CHECKED },
  { id: 'nyhabitat', name: 'New York Habitat', status: 'NO_PUBLIC_ACCESS', reason: 'Poor fit: a furnished short-term rental agency (like June Homes), not individual room shares.', checkedAt: CHECKED },
  { id: 'nybits', name: 'NYBits', status: 'NO_PUBLIC_ACCESS', reason: 'Entire no-fee apartments; terms defer to robots.txt, which disallows listing pages and paginated search, leaving 20 results per layout — 0 of 41 studio/1BR results were under $1,700. Poor fit.', checkedAt: CHECKED },
  { id: 'trovit', name: 'Trovit', status: 'UNVERIFIED', reason: 'Aggregator that redirects to other portals\' ads; robots allows the search page, but no terms page was found and the underlying listings belong to sites whose terms mostly prohibit reuse. Low value.', checkedAt: CHECKED },
  { id: 'cohabitas', name: 'Cohabitas', status: 'BLOCKED', reason: 'NYC listings page returns a Cloudflare challenge (HTTP 403).', checkedAt: CHECKED },
  { id: 'flip', name: 'Flip (lease takeovers)', status: 'BLOCKED', reason: 'Redirects to caretaker.com behind a Cloudflare challenge (HTTP 403/530).', checkedAt: CHECKED },
  { id: 'geebo', name: 'Geebo', status: 'BLOCKED', reason: 'HTTP 403 block page on every request, including robots.txt.', checkedAt: CHECKED },
  { id: 'locanto', name: 'Locanto', status: 'BLOCKED', reason: 'Cloudflare challenge + captcha (HTTP 403) on all pages.', checkedAt: CHECKED },
  { id: 'oodle', name: 'Oodle', status: 'BLOCKED', reason: 'Rooms-for-rent page returns a Cloudflare challenge (HTTP 403).', checkedAt: CHECKED },
  { id: 'rentberry', name: 'Rentberry', status: 'BLOCKED', reason: 'Cloudflare challenge (HTTP 403) on all pages.', checkedAt: CHECKED },
  { id: 'classifiedads', name: 'ClassifiedAds.com', status: 'BLOCKED', reason: 'Cloudflare block page (HTTP 403) on all pages.', checkedAt: CHECKED },
  { id: 'adpost', name: 'Adpost', status: 'BLOCKED', reason: 'Cloudflare challenge (HTTP 403) on all pages.', checkedAt: CHECKED },
  { id: 'hoobly', name: 'Hoobly', status: 'NO_PUBLIC_ACCESS', reason: 'Classifieds focused on pets; no NYC room inventory found.', checkedAt: CHECKED },
];
