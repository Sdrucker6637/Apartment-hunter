// Search criteria and per-source settings. Env vars override the defaults
// so the GitHub Action (or you, locally) can tweak them without code changes.

const list = (v, fallback) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback);
const num = (v, fallback) => (v != null && v !== '' && Number.isFinite(+v) ? +v : fallback);

export const config = {
  // Listings whose known share is above this are dropped at scrape time.
  // (The site's own max-price filter defaults to the same value.)
  maxShare: num(process.env.MAX_SHARE, 1700),
  // Bedroom range is a default UI filter, not a scrape-time cut, so you can widen it.
  defaultBedrooms: [num(process.env.MIN_BEDROOMS, 1), num(process.env.MAX_BEDROOMS, 3)],
  // Drop listings posted longer ago than this.
  maxAgeDays: num(process.env.MAX_AGE_DAYS, 45),
  // Drop listings not seen at a LIVE source for this many days (taken down).
  goneAfterDays: num(process.env.GONE_AFTER_DAYS, 3),

  // Sources that need an explicit opt-in (terms not verified).
  enabled: new Set(list(process.env.ENABLE_SOURCES, [])),

  junehomes: { maxPages: num(process.env.JUNEHOMES_PAGES, 12), maxDetails: num(process.env.JUNEHOMES_DETAILS, 40) },
  roomster: { maxPages: num(process.env.ROOMSTER_PAGES, 14), maxDetails: num(process.env.ROOMSTER_DETAILS, 45) },
  reddit: {
    subreddits: list(process.env.SUBREDDITS, ['RoommatesNYC', 'NYCapartments']),
    pages: num(process.env.REDDIT_PAGES, 2),
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  },
};
