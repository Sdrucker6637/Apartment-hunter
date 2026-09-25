// Search criteria and sources. Env vars override the defaults so the GitHub
// Action (or you, locally) can tweak them without code changes.

const list = (v, fallback) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback);
const num = (v, fallback) => (v != null && v !== '' && Number.isFinite(+v) ? +v : fallback);

export const config = {
  // Your max monthly share of the rent.
  maxShare: num(process.env.MAX_SHARE, 1700),
  minBedrooms: num(process.env.MIN_BEDROOMS, 1),
  maxBedrooms: num(process.env.MAX_BEDROOMS, 3),
  // Listings older than this drop off the site.
  maxAgeDays: num(process.env.MAX_AGE_DAYS, 30),

  reddit: {
    subreddits: list(process.env.SUBREDDITS, ['RoommatesNYC', 'NYCapartments']),
    // Pages of 100 "new" posts to read per subreddit on each run.
    pages: num(process.env.REDDIT_PAGES, 3),
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
    userAgent: process.env.REDDIT_USER_AGENT || 'web:apartment-hunter:v0.1 (personal roommate search)',
  },

  craigslist: {
    enabled: process.env.CRAIGSLIST !== 'off',
    // rooms & shares (roo) and sublets (sub) for all five boroughs
    searches: list(process.env.CRAIGSLIST_SEARCHES, ['roo', 'sub']),
    site: process.env.CRAIGSLIST_SITE || 'newyork',
  },
};
