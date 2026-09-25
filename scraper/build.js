// Turns raw posts from any source into normalized listings, applies your
// criteria, dedupes, and merges with what earlier runs already found.

import { parseListing } from './parse.js';
import { findNeighborhood } from './neighborhoods.js';

const SNIPPET_LEN = 600;

export function buildListing(raw) {
  const parsed = parseListing({
    title: raw.title,
    body: raw.body,
    flair: raw.flair,
    hints: raw.hints || {},
    postedAt: raw.postedAt,
  });
  const listing = {
    id: raw.id,
    source: raw.source,
    sourceLabel: raw.sourceLabel,
    url: raw.url,
    externalUrl: raw.externalUrl || null,
    contactUrl: raw.contactUrl,
    author: raw.author,
    title: raw.title.trim(),
    snippet: raw.body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN),
    postedAt: raw.postedAt,
    flair: raw.flair || null,
    manual: !!raw.manual,
    ...parsed,
  };
  // Hand-entered corrections always win over the parser.
  for (const [k, v] of Object.entries(raw.overrides || {})) {
    if (v !== '' && v != null) listing[k] = v;
  }
  const o = raw.overrides || {};
  if (o.price != null && o.priceMax == null) listing.priceMax = listing.price;
  if (typeof o.moveIn === 'string' && o.moveIn) listing.moveIn = { date: o.moveIn, text: o.moveIn };
  if (o.neighborhood) {
    const match = findNeighborhood(o.neighborhood);
    listing.neighborhood = match.neighborhood || o.neighborhood;
    listing.borough = o.borough || match.borough;
  }
  if (o.roommates != null) listing.roommatesSource = 'stated';
  return listing;
}

// Why a listing is excluded, or null if it's a keeper.
// Unknown values pass (the site lets you hide incomplete listings) so a
// post with a missing detail isn't silently lost.
export function rejectReason(l, cfg, now = Date.now()) {
  if (l.manual) return null; // you added it on purpose; the site's filters still apply
  if (l.postType === 'seeking') return 'seeking';
  if (l.postType === 'unknown' && l.price == null) return 'not a listing';
  if (l.price != null && l.price > cfg.maxShare) return 'over budget';
  if (l.bedrooms != null && (l.bedrooms < cfg.minBedrooms || l.bedrooms > cfg.maxBedrooms)) return 'bedrooms';
  if (now - new Date(l.postedAt).getTime() > cfg.maxAgeDays * 86400000) return 'stale';
  return null;
}

const normTitle = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Same person cross-posting the same room to several subreddits.
export function dedupe(listings) {
  const seen = new Map();
  const sorted = [...listings].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  const out = [];
  for (const l of sorted) {
    const key = l.author ? `${l.author}|${normTitle(l.title)}` : l.id;
    const prev = seen.get(key);
    if (prev) {
      prev.alsoPostedIn = [...new Set([...(prev.alsoPostedIn || []), l.sourceLabel])].filter((s) => s !== prev.sourceLabel);
      continue;
    }
    seen.set(key, l);
    out.push(l);
  }
  return out;
}

// previous: listings from the last run. fresh: raw posts fetched now.
export function mergeRun({ previous = [], raws = [], cfg, now = Date.now(), dropIds = new Set() }) {
  const byId = new Map(previous.filter((l) => !dropIds.has(l.id)).map((l) => [l.id, l]));
  for (const raw of raws) {
    const l = buildListing(raw);
    const prev = byId.get(l.id);
    byId.set(l.id, { ...l, firstSeenAt: prev?.firstSeenAt ?? new Date(now).toISOString() });
  }
  const stats = {};
  const kept = [];
  for (const l of byId.values()) {
    const reason = rejectReason(l, cfg, now);
    if (reason) stats[reason] = (stats[reason] || 0) + 1;
    else kept.push(l);
  }
  return { listings: dedupe(kept), rejected: stats };
}
