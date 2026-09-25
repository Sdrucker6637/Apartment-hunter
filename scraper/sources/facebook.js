// Facebook Groups via Bright Data's "Facebook - Posts by group URL" dataset.
//
// Collection provider: Bright Data (api.brightdata.com). We never contact
// facebook.com ourselves: no browser, login, cookies or session tokens.
// Bright Data collects logged-off, public Group content only, so private /
// members-only Groups return nothing (recorded in source status).
//
// Flow per run (asynchronous Bright Data API):
//   POST /datasets/v3/trigger?dataset_id=gd_lz11l67o2cb3r0lkj3  [{url, start_date, end_date}]
//     → { snapshot_id }
//   GET  /datasets/v3/progress/<id>   until status "ready" (or "failed"/timeout)
//   GET  /datasets/v3/snapshot/<id>?format=json → array of post records
//
// Cost: Bright Data bills per record. Each run asks only for posts since the
// last successful run (minus a small overlap), capped at a maximum window,
// skips if the previous success was too recent, queries at most
// FACEBOOK_MAX_GROUPS Groups, never re-triggers a collection, and gives up
// after FACEBOOK_MAX_WAIT_SECONDS. Previously collected posts are kept by the
// pipeline (this is an incremental source).
//
// Privacy: poster names and profile URLs from the records are never copied.
// Contact details inside post text go through the usual sanitizer before
// anything is published.
import { textPostListing } from './common.js';

export const API = 'https://api.brightdata.com/datasets/v3';
export const DATASET_ID = 'gd_lz11l67o2cb3r0lkj3';

export const meta = {
  id: 'facebook',
  name: 'Facebook',
  kind: 'Posts from configured NYC housing Groups (public Groups, collected by Bright Data)',
  access: 'Bright Data Web Scraper API ("Facebook - Posts by group URL"); needs BRIGHTDATA_API_KEY and FACEBOOK_GROUPS.',
  photos: 'Post images when Bright Data returns them (Facebook CDN links expire)',
  incremental: true, // each run fetches only new posts; earlier posts are kept by the pipeline
};

export class AuthRequiredError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthRequiredError'; }
}

// ---------- configuration ----------

// FACEBOOK_GROUPS: a JSON array or a comma/newline separated list of Group
// URLs, slugs or numeric IDs. Returns canonical https://www.facebook.com/groups/<id>/ URLs.
export function parseGroups(value) {
  if (!value || !String(value).trim()) return [];
  let items;
  try {
    const j = JSON.parse(value);
    items = Array.isArray(j) ? j : [j];
  } catch {
    items = String(value).split(/[\n,]+/);
  }
  const out = [];
  for (const raw of items.map((s) => String(s).trim().replace(/^["']|["']$/g, '')).filter(Boolean)) {
    let slug = null;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        if (!/(^|\.)facebook\.com$/i.test(u.hostname)) continue;
        slug = /^\/groups\/([^/?#]+)/.exec(u.pathname)?.[1] || null;
      } catch { continue; }
    } else if (/^[\w.-]+$/.test(raw)) {
      slug = raw;
    }
    if (slug) {
      const url = `https://www.facebook.com/groups/${slug}/`;
      if (!out.includes(url)) out.push(url);
    }
  }
  return out;
}

// Bright Data's Facebook datasets take MM-DD-YYYY dates.
export const bdDate = (d) => {
  const x = new Date(d);
  return `${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}-${x.getUTCFullYear()}`;
};

// Recent window: since the last successful run (minus an overlap), never
// longer than maxWindowDays; the first run uses initialWindowDays.
export function dateWindow({ now = Date.now(), lastSuccessAt = null, initialWindowDays = 7, maxWindowDays = 7, overlapHours = 6 } = {}) {
  const day = 86400000;
  const floor = now - maxWindowDays * day;
  let start = lastSuccessAt ? Date.parse(lastSuccessAt) - overlapHours * 3600000 : now - initialWindowDays * day;
  if (!Number.isFinite(start) || start < floor) start = floor;
  return { start: new Date(start), end: new Date(now) };
}

// ---------- Bright Data client ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bdFetch(fetchImpl, url, apiKey, init = {}) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 401 || res.status === 403) throw new AuthRequiredError(`Bright Data rejected the API key (HTTP ${res.status})`);
  if (res.status === 402) throw new Error('Bright Data: insufficient balance / free allowance used up (HTTP 402)');
  return res;
}

// Short, secret-free description of an error response body.
async function errorText(res) {
  try {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
    return t.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]');
  } catch { return ''; }
}

export async function collect({ apiKey, groups, start, end, maxWaitSeconds = 600, pollSeconds = 15, fetchImpl = fetch, wait = sleep, log = () => {} }) {
  const inputs = groups.map((url) => ({ url, start_date: bdDate(start), end_date: bdDate(end) }));
  const trig = await bdFetch(fetchImpl, `${API}/trigger?dataset_id=${DATASET_ID}&include_errors=true&format=json`, apiKey, {
    method: 'POST', body: JSON.stringify(inputs),
  });
  if (!trig.ok) throw new Error(`Bright Data trigger failed (HTTP ${trig.status}) ${await errorText(trig)}`);
  const { snapshot_id: snapshotId } = await trig.json();
  if (!snapshotId) throw new Error('Bright Data trigger returned no snapshot_id');
  log(`facebook: Bright Data collection started for ${groups.length} group(s)`);

  const deadline = Date.now() + maxWaitSeconds * 1000;
  // Wait for the snapshot. One collection per run; never re-triggered.
  for (;;) {
    const pr = await bdFetch(fetchImpl, `${API}/progress/${encodeURIComponent(snapshotId)}`, apiKey);
    if (!pr.ok) throw new Error(`Bright Data progress check failed (HTTP ${pr.status}) ${await errorText(pr)}`);
    const { status } = await pr.json();
    if (status === 'ready') break;
    if (status === 'failed') throw new Error('Bright Data reported the collection as failed');
    if (Date.now() + pollSeconds * 1000 > deadline) {
      throw new Error(`Bright Data collection not ready after ${maxWaitSeconds}s (status "${status}"); not retried this run`);
    }
    await wait(pollSeconds * 1000);
  }
  for (;;) {
    const res = await bdFetch(fetchImpl, `${API}/snapshot/${encodeURIComponent(snapshotId)}?format=json`, apiKey);
    if (res.status === 202) {
      if (Date.now() + pollSeconds * 1000 > deadline) throw new Error('Bright Data snapshot still building at deadline; not retried this run');
      await wait(pollSeconds * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Bright Data snapshot download failed (HTTP ${res.status}) ${await errorText(res)}`);
    const data = await res.json();
    return { snapshotId, records: Array.isArray(data) ? data : [] };
  }
}

// ---------- records → posts ----------

const IMAGE_HOST = /(^|\.)(fbcdn\.net|fbsbx\.com)$/i;
const PROFILE_KEYS = /user|author|profile|avatar|page_logo|group_logo|header_image|cover/i;

// Facebook CDN links carry their expiry as a hex epoch in the "oe" parameter.
export function photoExpiry(url) {
  try {
    const oe = new URL(url).searchParams.get('oe');
    return oe && /^[0-9a-f]{6,10}$/i.test(oe) ? new Date(parseInt(oe, 16) * 1000).toISOString() : null;
  } catch { return null; }
}

// Post images only: attachments and post-level image fields. Profile pictures
// and group covers are excluded.
export function recordPhotos(rec) {
  const urls = [];
  const push = (u) => {
    if (typeof u !== 'string' || !/^https:\/\//i.test(u)) return;
    try { if (!IMAGE_HOST.test(new URL(u).hostname)) return; } catch { return; }
    if (!urls.includes(u)) urls.push(u);
  };
  for (const a of [].concat(rec.attachments || [])) {
    if (typeof a === 'string') push(a);
    else if (a && typeof a === 'object' && !/video/i.test(a.type || '')) {
      push(a.url); push(a.image_url); push(a.image); push(a.src); push(a.uri);
    }
  }
  for (const [k, v] of Object.entries(rec)) {
    if (PROFILE_KEYS.test(k)) continue;
    if (/^(post_image|image|image_url|images|photos|photo_url|photo)$/i.test(k)) for (const u of [].concat(v || [])) push(typeof u === 'string' ? u : u?.url || u?.image_url);
  }
  return urls.slice(0, 16).map((url) => ({ url, expiresAt: photoExpiry(url) }));
}

// "…/groups/<gid>/posts/<pid>/", "…/permalink/<pid>/", "?story_fbid=<pid>" …
export function postIdFrom(url) {
  if (!url) return null;
  return /\/(?:posts|permalink)\/(\d+)/.exec(url)?.[1] || /[?&](?:story_fbid|fbid|multi_permalinks)=(\d+)/.exec(url)?.[1] || null;
}

export function canonicalPostUrl({ url, groupId, postId }) {
  if (groupId && postId) return `https://www.facebook.com/groups/${groupId}/posts/${postId}/`;
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    u.hostname = 'www.facebook.com';
    for (const k of [...u.searchParams.keys()]) if (!/^(story_fbid|id|fbid|multi_permalinks)$/.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.href;
  } catch { return null; }
}

export function recordToPost(rec, { groupUrl = null } = {}) {
  if (!rec || typeof rec !== 'object') return { error: 'not an object' };
  if (rec.error || rec.error_code) return { error: String(rec.error_code || 'error') };
  const text = [rec.content, rec.post_text, rec.text, rec.message, rec.description].find((t) => typeof t === 'string' && t.trim()) || '';
  const rawUrl = rec.url || rec.post_url || rec.link || null;
  const gUrl = rec.group_url || rec.input?.url || groupUrl || null;
  const groupId = rec.group_id || (gUrl && /\/groups\/([^/?#]+)/.exec(gUrl)?.[1]) || (rawUrl && /\/groups\/([^/?#]+)/.exec(rawUrl)?.[1]) || null;
  const postId = String(rec.post_id || rec.id || postIdFrom(rawUrl) || '') || null;
  const posted = rec.date_posted || rec.date || rec.created_time || rec.timestamp || null;
  const postedAt = posted && Number.isFinite(Date.parse(posted)) ? new Date(posted).toISOString() : null;
  return {
    postId,
    url: canonicalPostUrl({ url: rawUrl, groupId, postId }),
    text: text.trim(),
    postedAt,
    groupId,
    groupUrl: gUrl,
    groupName: rec.group_name || rec.group_title || rec.page_name || null,
    photos: recordPhotos(rec),
  };
}

// ---------- housing detection ----------

const OFFER = /\b(?:rooms? (?:is |are )?(?:available|for rent|open|opening)|private (?:bed)?room|shared room|room for (?:rent|sublet)|(?:bed)?room in (?:a |an |my |our )|roommate (?:replacement|wanted|needed)|replacement roommate|looking for (?:a |an |one |two |\d )?(?:new |3rd |third |2nd |second |4th |fourth )?(?:roommates?|roomies?|housemates?)|lease (?:takeover|transfer|assignment|break)|take over (?:my|our|the) lease|sub-?let|sub-?lease|(?:apartment|apt|unit|studio|home|house) (?:is )?(?:available|for rent)|(?:\d|one|two|three|four)\s*(?:br|bd|bed(?:room)?s?)\b[^.\n]{0,40}\b(?:available|for rent)|renting (?:out )?(?:a |my |our |one |the )?(?:room|bedroom|apartment|apt|studio))\b/i;
const HOUSING_NOUN = /\b(?:room|bedroom|apartment|apt|studio|\d\s*(?:br|bd)|sublet|sublease|lease)\b/i;
const MONTHLY_PRICE = /\$\s?\d{1,2},?\d{3}(?:\s*(?:\/|per|a)\s*(?:mo(?:nth)?|m)\b)?/i;
const SEEKING = /\b(?:looking for|seeking|searching for|in search of|iso|in need of|need(?:ing)?)\s+(?:an?\s+|any\s+)?(?:room|apartment|apt|place|housing|sublet|studio|home|1\s*br|share)\b|\banyone (?:know|have|has) (?:of )?(?:an?\s+|any\s+)?(?:place|room|apartment|apt|sublet|housing|leads?)\b|^\s*iso\b/im;

// Returns { housing: boolean, reason } — reasons: seeking | no-text | not-housing | offer.
export function classifyHousing(text) {
  const t = String(text || '');
  if (!t.trim()) return { housing: false, reason: 'no-text' };
  const offer = t.search(OFFER);
  const seek = t.search(SEEKING);
  // Seeking unless an offer phrase comes first ("Room available … looking for someone clean").
  if (seek !== -1 && (offer === -1 || seek < offer)) return { housing: false, reason: 'seeking' };
  if (offer !== -1 && HOUSING_NOUN.test(t)) return { housing: true, reason: 'offer' };
  if (MONTHLY_PRICE.test(t) && /\b(?:room|bedroom|apartment|apt|studio|\d\s*(?:br|bd))\b/i.test(t) && /\bavailable\b|\bmove[- ]?in\b|\bfor rent\b/i.test(t)) return { housing: true, reason: 'offer' };
  return { housing: false, reason: 'not-housing' };
}

const firstLine = (t) => {
  const line = t.split(/\n/).map((s) => s.trim()).find(Boolean) || '';
  return line.length > 90 ? `${line.slice(0, 87).replace(/\s+\S*$/, '')}…` : line;
};

export function postToListing(post) {
  const { housing, reason } = classifyHousing(post.text);
  if (!housing) return { listing: null, reason };
  const title = firstLine(post.text);
  const body = post.text;
  const base = textPostListing({ title, body, postedAt: post.postedAt });
  if (!base) return { listing: null, reason: 'seeking' };
  const group = post.groupName || (post.groupId ? `group ${post.groupId}` : 'Group');
  const photos = post.photos.filter((p) => !p.expiresAt || Date.parse(p.expiresAt) > Date.now());
  return {
    reason: 'listing',
    listing: {
      ...base,
      source: 'facebook',
      sourceId: post.postId || post.url,
      sourceLabel: `Facebook · ${group}`,
      originalUrl: post.url,
      contactUrl: post.url,
      contactMethod: 'Comment or message the poster on Facebook',
      photos,
      photoStatus: photos.length ? undefined : 'source_only', // UI: "Photos unavailable — view original listing"
    },
  };
}

// ---------- adapter entry point ----------

export async function fetchListings(cfg, log = () => {}, { previous = null, now = Date.now(), fetchImpl = fetch, wait = sleep } = {}) {
  const fb = cfg.facebook;
  if (!fb.apiKey) throw new AuthRequiredError('BRIGHTDATA_API_KEY is not set');
  const groups = fb.groups.slice(0, fb.maxGroups);
  if (!groups.length) throw new Error('FACEBOOK_GROUPS is not configured');

  // Cost guard: don't collect again within minHoursBetweenRuns of the last success.
  if (previous?.lastSuccessAt && now - Date.parse(previous.lastSuccessAt) < fb.minHoursBetweenRuns * 3600000) {
    const out = [];
    out.skipped = `Skipped: last successful collection was under ${fb.minHoursBetweenRuns}h ago (cost guard); earlier posts are kept.`;
    return out;
  }

  const { start, end } = dateWindow({ now, lastSuccessAt: previous?.lastSuccessAt, initialWindowDays: fb.initialWindowDays, maxWindowDays: fb.maxWindowDays, overlapHours: fb.overlapHours });
  const stats = {
    provider: 'Bright Data', datasetId: DATASET_ID, groups, skippedGroups: fb.groups.length - groups.length,
    window: { start: start.toISOString(), end: end.toISOString() },
    recordsRetrieved: 0, errorRecords: 0, posts: 0, housingListings: 0,
    rejected: { seeking: 0, 'not-housing': 0, 'no-text': 0 },
    recordsWithImages: 0, photoUrls: 0, expiredPhotoUrls: 0, fieldsSeen: [],
  };
  const { records } = await collect({ apiKey: fb.apiKey, groups, start, end, maxWaitSeconds: fb.maxWaitSeconds, pollSeconds: fb.pollSeconds, fetchImpl, wait, log });
  stats.recordsRetrieved = records.length;
  const keys = new Set();
  const out = [];
  const seen = new Set();
  for (const rec of records) {
    if (rec && typeof rec === 'object') Object.keys(rec).forEach((k) => keys.add(k));
    const post = recordToPost(rec, { groupUrl: groups.length === 1 ? groups[0] : null });
    if (post.error) { stats.errorRecords++; continue; }
    stats.posts++;
    if (post.photos.length) stats.recordsWithImages++;
    stats.photoUrls += post.photos.length;
    stats.expiredPhotoUrls += post.photos.filter((p) => p.expiresAt && Date.parse(p.expiresAt) <= now).length;
    const { listing, reason } = postToListing(post);
    if (!listing) { stats.rejected[reason] = (stats.rejected[reason] || 0) + 1; continue; }
    if (!listing.originalUrl || seen.has(listing.sourceId)) continue;
    seen.add(listing.sourceId);
    out.push(listing);
  }
  stats.housingListings = out.length;
  stats.fieldsSeen = [...keys].sort(); // field NAMES only (no values) to document the real record shape
  if (records.length > fb.maxRecordsWarn) log(`facebook: WARNING ${records.length} records in one run (above FACEBOOK_MAX_RECORDS_WARN=${fb.maxRecordsWarn})`);
  log(`facebook: ${records.length} records (${stats.errorRecords} error records), ${stats.posts} posts, ${out.length} housing listings, ${stats.recordsWithImages} posts with image URLs`);
  out.sourceStats = stats;
  return out;
}
