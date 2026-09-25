// Source registry: every source we evaluated, whether it runs, and why.
// Findings come from the live feasibility probes run on GitHub Actions
// (probe/*.js, runs 36169035176 / 36169233618 / 36169521877 / 36169769596, 2026-09-25).

import * as junehomes from './junehomes.js';
import * as roomster from './roomster.js';
import * as reddit from './reddit.js';
import * as jsonldSites from './jsonld-sites.js';
import * as manual from './manual.js';

const CHECKED = '2026-09-25';

// Sources that run automatically (subject to credentials / enable flags).
export const ADAPTERS = [
  { ...junehomes.meta, run: (cfg, log) => junehomes.fetchListings({ ...cfg.junehomes, log }) },
  { ...roomster.meta, run: (cfg, log) => roomster.fetchListings({ ...cfg.roomster, log }) },
  { ...reddit.meta, run: (cfg, log) => reddit.fetchListings({ ...cfg.reddit, log }) },
  { ...jsonldSites.SITES.diggz.meta, requiresEnable: true, unverifiedReason: 'Terms page is behind a Cloudflare challenge; automated access not confirmed as permitted', run: (cfg, log) => jsonldSites.fetchListings('diggz', { log }) },
  { ...jsonldSites.SITES.roomies.meta, requiresEnable: true, unverifiedReason: 'Terms page is behind a Cloudflare challenge; automated access not confirmed as permitted', run: (cfg, log) => jsonldSites.fetchListings('roomies', { log }) },
  { ...manual.meta, manual: true, run: () => manual.fetchListings() },
];

// Sources evaluated and deliberately not scraped.
export const EXCLUDED = [
  { id: 'craigslist', name: 'Craigslist NYC', status: 'NO_PUBLIC_ACCESS', reason: 'Terms: "You agree not to copy/collect CL content via robots, spiders, scripts, scrapers, crawlers." RSS feeds were discontinued.', checkedAt: CHECKED },
  { id: 'spareroom', name: 'SpareRoom', status: 'NO_PUBLIC_ACCESS', reason: 'Terms: may not "harvest information, with use of software or otherwise". No public API.', checkedAt: CHECKED },
  { id: 'listingsproject', name: 'Listings Project', status: 'NO_PUBLIC_ACCESS', reason: 'Terms: "Scraping and Republishing Prohibited". No API.', checkedAt: CHECKED },
  { id: 'streeteasy', name: 'StreetEasy', status: 'NO_PUBLIC_ACCESS', reason: 'Zillow terms prohibit "automated queries (including screen and database scraping, spiders, robots, crawlers…)". No public API.', checkedAt: CHECKED },
  { id: 'roomi', name: 'Roomi', status: 'NO_PUBLIC_ACCESS', reason: 'Terms prohibit "screen scraping… webcrawler, spidering or other automated means".', checkedAt: CHECKED },
  { id: 'leasebreak', name: 'Leasebreak', status: 'NO_PUBLIC_ACCESS', reason: 'Terms: "The use of bots, web crawlers, scripts, or any automated tools to scrape… is expressly prohibited."', checkedAt: CHECKED },
  { id: 'facebook', name: 'Facebook groups / Marketplace', status: 'MANUAL_ONLY', reason: 'robots.txt disallows all bots; Automated Data Collection Terms require Meta\'s written permission; Groups API removed in 2024. Paste posts manually instead.', checkedAt: CHECKED },
  { id: 'bungalow', name: 'Bungalow', status: 'NO_PUBLIC_ACCESS', reason: 'Terms prohibit crawling, spidering, harvesting or scraping.', checkedAt: CHECKED },
  { id: 'padmapper', name: 'PadMapper', status: 'NO_PUBLIC_ACCESS', reason: 'Terms prohibit crawling, scraping or spidering.', checkedAt: CHECKED },
  { id: 'zumper', name: 'Zumper', status: 'NO_PUBLIC_ACCESS', reason: 'Terms prohibit crawling, scraping or spidering.', checkedAt: CHECKED },
  { id: 'outpostclub', name: 'Outpost Club', status: 'SOURCE_BLOCKED', reason: 'Every page returns a Cloudflare challenge (HTTP 403) to automated requests.', checkedAt: CHECKED },
  { id: 'renthop', name: 'RentHop', status: 'SOURCE_BLOCKED', reason: 'Every page, including robots.txt, returns a Cloudflare challenge (HTTP 403).', checkedAt: CHECKED },
  { id: 'hotpads', name: 'HotPads', status: 'SOURCE_BLOCKED', reason: 'Anti-bot block (HTTP 403 captcha) on all pages.', checkedAt: CHECKED },
  { id: 'sublet', name: 'Sublet.com', status: 'NO_PUBLIC_ACCESS', reason: 'Listings are rendered client-side; no listing data in public HTML and no API.', checkedAt: CHECKED },
  { id: 'common', name: 'Common', status: 'NO_PUBLIC_ACCESS', reason: 'Service defunct; domain now held by a domain broker.', checkedAt: CHECKED },
];
