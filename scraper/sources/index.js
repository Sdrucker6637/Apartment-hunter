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
import * as jsonldSites from './jsonld-sites.js';

const CHECKED = '2026-09-25';

export const SOURCES = [
  {
    ...junehomes.meta, domain: 'junehomes.com', enabledByDefault: true,
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
    },
  },
  {
    ...roomi.meta, domain: 'roomiapp.com', enabledByDefault: false,
    run: (cfg, log) => roomi.fetchListings({ log }),
    review: {
      checkedAt: CHECKED, technicallyAccessible: true, scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'no',
      robots: 'Allows /rooms-for-rent/ search pages; disallows /listings/ (detail pages), /api/, /messages/ and account pages.',
      blockers: ['Terms (roomiapp.com/legal): "the use of webcrawler, spidering or other automated means to access, copy, index, process and/or store any Content … other than as expressly authorized by us, is prohibited" (also prohibits in-line linking, i.e. hotlinking photos)'],
      pagesTested: ['/rooms-for-rent/new-york (90 listings in page data)', '/rooms-for-rent/new-york?page=2 (same 90)', '/sitemap.xml', '/rooms-for-rent/new-york-city (no data)', '/rooms-for-rent/brooklyn (no data)', '/find-roommates/new-york', '/legal?tab=terms'],
      pagination: 'None: ?page=2 returns the same 90 listings; sitemap lists city pages (/rooms-for-rent/…) but no listings', photos: 'Yes — up to 10 photos per listing in the search page data',
    },
    defaultStatus: 'PERMISSION_REQUIRED',
    reason: 'Technically scrapeable: the NYC search page carries ~90 structured listings with photos, and the adapter parses them. But Roomi\'s terms prohibit crawling or automated copying/storing of content (and in-line linking) unless Roomi expressly authorizes it.',
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
    id: 'facebook', name: 'Facebook', domain: 'facebook.com', kind: 'NYC housing groups and Marketplace rentals',
    review: {
      checkedAt: CHECKED, technicallyAccessible: false, scrapingTested: true, termsReviewed: true, automatedAccessPermitted: 'no',
      robots: '"Disallow: /" for all agents; header says crawling is "prohibited unless you have express written permission from Facebook".',
      pagesTested: ['/groups/NYCRooms', '/groups/spareroomnyc', '/groups/new.york.housing.and.roommates', '/groups/1207463126375923', '/groups/roommatesnyc', '/groups/NewYorkRoommates', '/groups/1225966920763001', 'm.facebook.com/groups/NYCRooms', 'mbasic.facebook.com/groups/NYCRooms', '/marketplace/nyc/propertyrentals', '/marketplace/nyc/search?query=room for rent', 'graph.facebook.com/v21.0/NYCRooms/feed'],
      pagination: 'n/a — no content served', photos: 'n/a',
      blockers: ['Every group and Marketplace URL redirects (302) to the login page, including groups listed as public', 'robots.txt disallows all crawling without written permission', 'Terms: no automated collection without Meta\'s prior permission', 'Graph API: needs an app ID and token; Meta removed the Groups API in 2024 and has no Marketplace read API'],
    },
    defaultStatus: 'AUTH_REQUIRED',
    reason: 'Tested 7 public NYC housing groups and 2 Marketplace pages: every one redirects to Facebook\'s login page, so no listing content is served without an account. Automated access also needs Meta\'s written permission.',
    nextStep: 'No legitimate automated path today. Only Meta\'s written permission (Automated Data Collection Terms) or an approved research program (Meta Content Library) would change this.',
  },
  {
    ...jsonldSites.SITES.diggz.meta, domain: 'diggz.co', enabledByDefault: false,
    run: (cfg, log) => jsonldSites.fetchListings('diggz', { log }),
    review: { checkedAt: CHECKED, technicallyAccessible: true, scrapingTested: true, termsReviewed: false, automatedAccessPermitted: 'unclear', robots: 'Allows listing pages', pagination: 'n/a', photos: 'Yes' },
    defaultStatus: 'UNVERIFIED',
    reason: 'Listing pages have usable structured data, but the terms page sits behind a Cloudflare challenge, so permission could not be confirmed.',
    nextStep: 'Read Diggz\'s terms in a browser; if they permit it, set ENABLE_SOURCES=diggz.',
  },
  {
    ...jsonldSites.SITES.roomies.meta, domain: 'roomies.com', enabledByDefault: false,
    run: (cfg, log) => jsonldSites.fetchListings('roomies', { log }),
    review: { checkedAt: CHECKED, technicallyAccessible: true, scrapingTested: true, termsReviewed: false, automatedAccessPermitted: 'unclear', robots: 'Allows listing pages', pagination: 'n/a', photos: 'Yes' },
    defaultStatus: 'UNVERIFIED',
    reason: 'Listing pages have usable structured data, but the terms page sits behind a Cloudflare challenge, so permission could not be confirmed.',
    nextStep: 'Read Roomies.com\'s terms in a browser; if they permit it, set ENABLE_SOURCES=roomies.',
  },
];

// Back-compat alias: sources with an adapter.
export const ADAPTERS = SOURCES.filter((s) => s.run);

// Sources evaluated and deliberately not scraped.
export const EXCLUDED = [
  { id: 'craigslist', name: 'Craigslist NYC', status: 'PERMISSION_REQUIRED', reason: 'Terms: "You agree not to copy/collect CL content via robots, spiders, scripts, scrapers, crawlers." RSS feeds were discontinued.', checkedAt: CHECKED },
  { id: 'spareroom', name: 'SpareRoom', status: 'PERMISSION_REQUIRED', reason: 'Terms: may not "harvest information, with use of software or otherwise". No public API.', checkedAt: CHECKED },
  { id: 'listingsproject', name: 'Listings Project', status: 'PERMISSION_REQUIRED', reason: 'Terms: "Scraping and Republishing Prohibited". No API.', checkedAt: CHECKED },
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
  { id: 'roommatescom', name: 'Roommates.com', status: 'UNVERIFIED', reason: 'robots.txt allows crawling, but the terms page is behind a Cloudflare challenge.', checkedAt: CHECKED },
  { id: 'habyt', name: 'Habyt', status: 'UNVERIFIED', reason: 'robots.txt allows crawling; terms page not found at standard URLs. Needs a manual terms review.', checkedAt: CHECKED },
  { id: 'roomiematch', name: 'RoomieMatch', status: 'UNVERIFIED', reason: 'robots.txt allows crawling; terms page not found. Matching is questionnaire-based, not public listings.', checkedAt: CHECKED },
  { id: 'tripalink', name: 'Tripalink', status: 'UNVERIFIED', reason: 'robots.txt timed out; terms reachable but no NYC listing pages confirmed.', checkedAt: CHECKED },
];
