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
import { textPostListing, NEARBY_NJ } from './common.js';
import { findNeighborhood } from '../neighborhoods.js';
import { findBedrooms } from '../parse.js';
import { field } from '../schema.js';

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
  try {
    return { snapshotId, records: await waitAndDownload({ apiKey, snapshotId, maxWaitSeconds, pollSeconds, fetchImpl, wait }) };
  } catch (err) {
    // The collection was accepted (and may still finish and be billed): the
    // caller records it so the cooldown applies and the snapshot can be reused.
    err.triggeredSnapshotId = snapshotId;
    throw err;
  }
}

async function waitAndDownload({ apiKey, snapshotId, maxWaitSeconds, pollSeconds, fetchImpl, wait }) {
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
  return downloadSnapshot({ apiKey, snapshotId, deadline, pollSeconds, fetchImpl, wait });
}

async function downloadSnapshot({ apiKey, snapshotId, deadline, pollSeconds, fetchImpl, wait }) {
  for (;;) {
    const res = await bdFetch(fetchImpl, `${API}/snapshot/${encodeURIComponent(snapshotId)}?format=json`, apiKey);
    if (res.status === 202) {
      if (Date.now() + pollSeconds * 1000 > deadline) throw new Error('Bright Data snapshot still building at deadline; not retried this run');
      await wait(pollSeconds * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Bright Data snapshot download failed (HTTP ${res.status}) ${await errorText(res)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }
}

// Re-download a snapshot Bright Data already collected (kept 16 days)
// instead of starting a new collection — no new records are collected.
// `which` is a snapshot id or "latest" (newest ready snapshot of this dataset).
// Ready snapshots of this dataset (read-only; starts nothing, collects nothing).
export async function listSnapshots({ apiKey, fetchImpl = fetch }) {
  const res = await bdFetch(fetchImpl, `${API}/snapshots?dataset_id=${DATASET_ID}&status=ready`, apiKey);
  if (!res.ok) throw new Error(`Bright Data snapshot list failed (HTTP ${res.status}) ${await errorText(res)}`);
  const body = await res.json();
  return (Array.isArray(body) ? body : body.snapshots || body.data || [])
    .map((x) => ({ id: x.id || x.snapshot_id, created: x.created || x.created_at || null, size: x.dataset_size ?? null, status: x.status }))
    .filter((x) => x.id && (!x.status || x.status === 'ready'));
}
const newest = (list) => (list || []).filter((x) => x.size !== 0).sort((a, b) => Date.parse(b.created || 0) - Date.parse(a.created || 0))[0] || null;

// `list`: an already-fetched snapshot list (saves a request); `direct`: download
// the given id without listing (used when the list endpoint is unavailable).
export async function reuseSnapshot({ apiKey, which, list = null, direct = false, maxWaitSeconds = 600, pollSeconds = 15, fetchImpl = fetch, wait = sleep, log = () => {} }) {
  let chosen;
  if (direct && which !== 'latest') chosen = { id: which, created: null };
  else {
    list ??= await listSnapshots({ apiKey, fetchImpl });
    chosen = which === 'latest' ? newest(list) : list.find((x) => x.id === which);
  }
  if (!chosen) throw new Error(`No reusable ready Bright Data snapshot (${which === 'latest' ? 'none listed' : 'id not found'}); no collection was started`);
  const snapshotId = chosen.id;
  const created = chosen.created;
  log(`facebook: reusing an existing Bright Data snapshot (created ${created || 'unknown'}); no new collection`);
  const records = await downloadSnapshot({ apiKey, snapshotId, deadline: Date.now() + maxWaitSeconds * 1000, pollSeconds, fetchImpl, wait });
  return { snapshotId, created, records };
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
  return /\/(?:posts|permalink)\/(\d+|pfbid\w+)/.exec(url)?.[1] || /[?&](?:story_fbid|fbid|multi_permalinks)=(\d+|pfbid\w+)/.exec(url)?.[1] || null;
}

// A link that opens one post, not a group or profile page.
const POST_PATH = /\/(?:posts|permalink)\/[^/?#]+|\/share\/p\/[^/?#]+|\/permalink\.php$|\/story\.php$/i;

// Prefers the post URL the provider returned (as Facebook itself links the
// post); builds /groups/<gid>/posts/<pid>/ only when there is none. Never
// returns a bare group URL: that opens the group feed, not the listing.
export function canonicalPostUrl({ url, groupId, postId }) {
  try {
    const u = new URL(url);
    if (/(^|\.)facebook\.com$/i.test(u.hostname) && POST_PATH.test(u.pathname)) {
      u.hostname = 'www.facebook.com';
      for (const k of [...u.searchParams.keys()]) if (!/^(story_fbid|id|fbid)$/.test(k)) u.searchParams.delete(k);
      if (/\.php$/.test(u.pathname) && !u.searchParams.get('story_fbid')) throw new Error('no post id');
      u.hash = '';
      return u.href;
    }
  } catch { /* fall through to the ids */ }
  // Graph-style ids are "<groupId>_<postId>".
  const pid = postId && String(postId).includes('_') ? String(postId).split('_').pop() : postId;
  if (groupId && pid && /^(?:\d+|pfbid\w+)$/.test(pid)) return `https://www.facebook.com/groups/${groupId}/posts/${pid}/`;
  return null;
}

export function recordToPost(rec, { groupUrl = null } = {}) {
  if (!rec || typeof rec !== 'object') return { error: 'not an object' };
  if (rec.error || rec.error_code) return { error: String(rec.error_code || 'error') };
  const text = [rec.content, rec.post_text, rec.text, rec.message, rec.description].find((t) => typeof t === 'string' && t.trim()) || '';
  // The first candidate that links one post (some records carry the group URL in `url`).
  const urls = [rec.post_url, rec.url, rec.link, rec.permalink].filter((u) => typeof u === 'string' && u);
  const rawUrl = urls.find((u) => postIdFrom(u) || POST_PATH.test(u.split(/[?#]/)[0])) || urls[0] || null;
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

// Offer phrases. Each addition below came from real posts the audit of the
// 2026-09-26 snapshot found rejected (see test/facebook.test.js).
const OFFER = new RegExp([
  String.raw`rooms? (?:is |are )?(?:available|for rent|open|opening)`,
  String.raw`private (?:bed)?rooms?`, String.raw`shared room`, String.raw`room for (?:rent|sublet)`,
  String.raw`(?:bed)?room in (?:a |an |my |our )?shared\b`, String.raw`(?:bed)?room in (?:a |an |my |our )`,
  String.raw`roommate (?:replacement|wanted|needed)`, String.raw`replacement roommate`,
  String.raw`looking for (?:a |an |one |two |\d+x? |one more |two more |another )?(?:new |last |3rd |third |2nd |second |4th |fourth )?(?:roommates?|roomies?|housemates?)`,
  String.raw`looking for (?:a |an )?(?:\w+ )?(?:tenant|subletter|subleaser|sub-?tenant)s? (?:for|to)\b`,
  String.raw`looking to fill (?:a |the |our |my |last |the last )?(?:\w+ )?(?:bed)?room`,
  String.raw`lease (?:takeover|transfer|assignment|break)`,
  String.raw`tak(?:e|ing) over (?:my|our|the|a|an|their|her|his)(?:\s+[\w,-]+){0,4}?\s+(?:lease|room|bedroom|apartment|apt|unit|studio)`,
  String.raw`(?:re)?assign(?:ing)? (?:my|our|the)(?:\s+[\w/-]+){0,4}?\s+lease`,
  String.raw`transfer (?:my|our|the)(?:\s+[\w/-]+){0,3}?\s+lease`,
  String.raw`sub-?let`, String.raw`sub-?lease`,
  String.raw`(?:apartment|apt|unit|studio|home|house) (?:is )?(?:available|for rent)`,
  String.raw`(?:\d|one|two|three|four)\s*(?:br|bd|bed(?:room)?s?)\b[^.\n]{0,40}\b(?:available|for rent)`,
  String.raw`renting (?:out )?(?:a |my |our |one |the )?(?:room|bedroom|apartment|apt|studio)`,
].map((x) => String.raw`\b${x}\b`).join('|'), 'i');
const HOUSING_NOUN = /\b(?:rooms?|bedrooms?|apartments?|apts?|studios?|\d\s*(?:br|bd|beds?)|sublet|sublease|lease|home|house)\b/i;
// A monthly amount: "$1,300", "$1300/mo", "1300$ month".
const MONTHLY_PRICE = /\$\s?\d{1,2},?\d{3}(?:\s*(?:\/|per|a)\s*(?:mo(?:nth)?|m)\b)?|\b\d{1,2},?\d{3}\s?\$/i;
// Listing details a seeker would not write, used with a price and a housing noun.
const LISTING_CUE = /\bavailable\b|\bmove[- ]?in\b|\bfor rent\b|\bno (?:broker )?fee\b|\bsecurity deposit\b|\bdeposit\b|\b\d+[- ]?(?:month|year|yr)s? lease\b|\bshared (?:apartment|apt)\b|\butilities (?:are )?included\b/i;

// Someone looking FOR housing. Up to three words may sit between the verb and
// the housing noun ("looking for a furnished 1bd"), but not people words, so
// "looking for a roommate for my room" stays an offer.
const PEOPLE_WORD = String.raw`(?!(?:roommates?|roomies?|housemates?|someone|somebody|tenants?|persons?|people|female|male|guy|girl|woman|women|man|men|subletters?|subleasers?)\b)`;
const SEEKING = new RegExp([
  String.raw`\b(?:looking for|seeking|searching for|in search of|iso|in need of|need(?:ing)?)\s*:?\s+(?:an?\s+|any\s+|some\s+)?(?:${PEOPLE_WORD}[\w/-]+\s+){0,3}?(?:rooms?|apartments?|apts?|place|housing|sublet|sublease|studio|home|1\s*(?:br|bd|bed(?:room)?)|share)\b`,
  // "looking to sublet a 1BR", "looking to sublease near FiDi" (not "looking to sublet my room")
  String.raw`\blooking to sub-?(?:let|lease)\s+(?:(?:a|an)\s+(?:place|one[- ]bedroom|1\s*(?:br|bd|bed(?:room)?)|studio|apartment|apt|room)\b|(?:near|in|around)\b)`,
  String.raw`\blooking for (?:roommates?|roomies?) or (?:an? )?(?:open )?room\b`,
  // "ROOM / SUBLET WANTED" (someone wants one); "ROOMMATE WANTED" alone stays an offer
  String.raw`\b(?:room|sublet|sublease|apartment|apt|housing|place|studio)\s*(?:\/\s*(?:room|roommate|sublet|sublease|apartment)\s*)?wanted\b`,
  String.raw`\banyone (?:know|have|has) (?:of )?(?:an?\s+|any\s+)?(?:place|room|apartment|apt|sublet|housing|leads?)\b`,
  String.raw`^\s*iso\b`,
].join('|'), 'gim');
// Seeker signals that hold wherever they appear, unless the post clearly
// offers the poster's own place: a stated budget, "apartment hunt with",
// "any of these neighborhoods".
const SEEKER_CUE = /\b(?:my|our|max(?:imum)?)\s+budget\b|\bbudget\s*(?::|is|of)?\s*(?:~|up to|under|around|about|approx\.?|max(?:imum)?|below|less than)?\s*~?\s*\$?\s*\d|\bapartment[- ]hunt(?:ing)?\s+with\b|\bto team up\b|\bin any of these neighbou?rhoods\b/i;
const OWN_PLACE = /\b(?:my|our|her|his|their)\s+(?:room|bedroom|apartment|apt|studio|place|lease|unit|flat)\b|\broom (?:is )?available\b|\bavailable (?:room|bedroom)\b|\bfor rent\b/gi;
// "…if you have a room available" is addressed to the reader, not an offer.
// So is "if anyone … needs someone to sublet their room" (their = the reader's).
const ASKING_READER = /\byou\s+(?:have|know\s+of|got)\s+(?:a|an|any)?\s*$/i;
const ANYONE_THEIR = /\b(?:anyone|anybody)\b[^.!?\n]{0,70}$/i;
const offersOwnPlace = (t) => [...t.matchAll(OWN_PLACE)].some((m) => !ASKING_READER.test(t.slice(Math.max(0, m.index - 25), m.index))
  && !(/^their\b/i.test(m[0]) && ANYONE_THEIR.test(t.slice(Math.max(0, m.index - 90), m.index))));

// Index of the first real seeking phrase, or -1. Ignored: rhetorical
// questions ("Looking for a place to stay in Manhattan? This studio…") and
// phrases addressed to the reader ("ideal for anyone looking for a place").
const ADDRESSED = /\b(?:anyone|those|people|someone|who(?:'s|’s| is| are)?|you(?:'re|’re| are)?)\s+$/i;
function seekingIndex(t) {
  for (const m of t.matchAll(SEEKING)) {
    if (!/^anyone/i.test(m[0])) {
      const rest = t.slice(m.index);
      const end = rest.search(/[.!?\n]/);
      if (end !== -1 && rest[end] === '?') continue;
      if (ADDRESSED.test(t.slice(Math.max(0, m.index - 30), m.index))) continue;
    }
    return m.index;
  }
  return -1;
}

// Offers outside NYC (the source groups also carry NJ / Westchester posts).
const OUTSIDE_NYC = /\b(?:NJ|New Jersey|Yonkers|Westchester|Nassau|Suffolk|Connecticut|Harrison|Newark)\b/;

// Returns { housing: boolean, reason } — reasons: seeking | no-text | not-housing | outside-nyc | offer.
export function classifyHousing(text) {
  const t = String(text || '');
  if (!t.trim()) return { housing: false, reason: 'no-text' };
  const offer = t.search(OFFER);
  const seek = seekingIndex(t);
  // Seeking unless an offer phrase comes first ("Room available … looking for someone clean").
  if (seek !== -1 && (offer === -1 || seek < offer)) return { housing: false, reason: 'seeking' };
  if (SEEKER_CUE.test(t) && !offersOwnPlace(t)) return { housing: false, reason: 'seeking' };
  let housing = offer !== -1 && HOUSING_NOUN.test(t);
  if (!housing && MONTHLY_PRICE.test(t) && /\b(?:room|bedroom|apartment|apt|studio|\d\s*(?:br|bd|bed))\b/i.test(t) && LISTING_CUE.test(t)) housing = true;
  if (!housing) return { housing: false, reason: 'not-housing' };
  if (OUTSIDE_NYC.test(t) && !NEARBY_NJ.test(t) && !findNeighborhood(t).borough) return { housing: false, reason: 'outside-nyc' };
  return { housing: true, reason: 'offer' };
}

// "Newly Renovated Bed-Stuy Apartment | …", "1-BEDROOM IN ELMHURST … 1BR/1BA":
// the opening names a whole apartment and nothing offers a room. The shared
// parser leaves these UNKNOWN and reads their single price as a likely room
// share; here that price becomes the apartment's total instead (your share
// only when the whole unit is a studio/1BR).
const APARTMENT_OPENING = /\b(?:apartment|apt|studio|condo|(?:\d|one|two|three)[- ]?(?:bed(?:room)?|br|bdr)s?\s*(?:apartment|apt|in\b|[|/,]\s*\d\s*(?:ba|bath)))\b|\b\d\s*bed\s*\|?\s*\d\s*bath\b|\b\dbed\dbath\b/i;
const ROOM_OFFER_WORDS = /\b(?:rooms?\s+(?:for\s+rent|available|in\s+(?:a|an|my|our|the|this)\b)|(?:private|shared|master|flex|spare)\s+(?:bed)?room|roommates?|roomies?|housemates?|(?<![\d-]\s?)bedroom\s+(?:in\s+(?:a|an|my|our|the|this|shared)\b|available)|fill\s+(?:a|the|our|my|last)\b|(?:my|their|her|his|our)\s+room\b|bedroom\s+in\s+(?:a\s+)?shared\b)/i;
function entireApartmentFromWording(l, text) {
  if (l.listingType.value && l.listingType.value !== 'UNKNOWN') return;
  const opening = text.slice(0, 200);
  if (!APARTMENT_OPENING.test(opening) || ROOM_OFFER_WORDS.test(text)) return;
  l.listingType = field('ENTIRE_APARTMENT', 'explicit');
  if (l.bedrooms.value == null) {
    const b = findBedrooms(opening) ?? (/\bstudio\b/i.test(opening) ? 0 : null) ?? (/\b1\s*bed\s*\|?\s*1\s*bath\b|\b1bed1bath\b/i.test(opening) ? 1 : null);
    if (b != null) l.bedrooms = field(b, 'explicit');
  }
  if (l.priceConfidence === 'likely' && l.price.monthly != null) {
    const beds = l.bedrooms.value;
    if (beds === 0 || beds === 1) {
      l.price = { monthly: l.price.monthly, max: l.price.max, type: 'whole_unit', basis: 'explicit' };
      l.totalRent = field(l.price.monthly, 'explicit');
    } else {
      l.totalRent = field(l.price.monthly, 'explicit');
      l.price = { monthly: null, type: 'unknown', basis: null };
    }
    l.priceConfidence = null;
  }
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
  // The gate above already decided this is an offer; the shared classifier's
  // broader "I'm looking for…" = seeking rule must not overrule it.
  const base = textPostListing({ title, body, postedAt: post.postedAt, trustOffer: true });
  if (!base) return { listing: null, reason: 'seeking' };
  entireApartmentFromWording(base, post.text);
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

// ---------- collection cooldown & monthly guard ----------
//
// The site refreshes every few hours, but a NEW Bright Data collection is only
// started once the cooldown (FACEBOOK_COLLECTION_COOLDOWN_HOURS, default 36)
// has passed since the last one. In between, the newest completed snapshot is
// re-downloaded and re-parsed (no new collection). Persistent state lives in
// the source's `state` in status.json (restored from the published site each
// run); Bright Data's own list of ready snapshots is a second source of truth,
// so a lost state can't cause an extra collection.
//
// Monthly guard: records are counted from what the snapshots actually return
// (records.length) for collections this pipeline started. A collection whose
// size is unknown (it timed out here) counts as `maxRecordsWarn` records until
// its snapshot is downloaded. This is a guard, not billing: collections made
// elsewhere (other workflows, the Bright Data UI) are not seen.
export const monthKey = (t) => new Date(t).toISOString().slice(0, 7);

export function planCollection({ fb, state = null, lastSuccessAt = null, snapshots = null, now = Date.now() }) {
  const st = state || {};
  const latest = newest(snapshots);
  const times = [st.lastCollectedAt, st.lastTriggeredAt, lastSuccessAt, latest?.created].map((t) => Date.parse(t)).filter(Number.isFinite);
  const last = times.length ? Math.max(...times) : null;
  const nextCollectionAfter = last != null ? new Date(last + fb.collectionCooldownHours * 3600000).toISOString() : null;
  const month = monthKey(now);
  const sameMonth = st.month === month;
  const monthRecords = sameMonth ? st.monthRecords || 0 : 0;
  const monthUnmeasured = sameMonth ? st.monthUnmeasured || 0 : 0;
  const guardUsed = monthRecords + monthUnmeasured * fb.maxRecordsWarn;
  const expected = st.lastRecords ?? fb.maxRecordsWarn;
  const guardLimit = fb.monthlyRecordBudget - fb.monthlySafetyBuffer;
  const base = { nextCollectionAfter, month, monthRecords, monthUnmeasured, guardUsed, guardLimit };
  // Which snapshot to reuse: one we started that has since finished, then the
  // one we last used, then the newest ready one.
  const listed = (id) => id && snapshots?.some((x) => x.id === id);
  const reuseId = listed(st.pendingSnapshotId) ? st.pendingSnapshotId
    : listed(st.snapshotId) ? st.snapshotId
      : latest?.id || (!snapshots && st.snapshotId) || null;
  const reuse = (reason) => (reuseId
    ? { ...base, action: 'reuse', snapshotId: reuseId, direct: !snapshots, reason }
    : { ...base, action: 'none', reason: `${reason}; no reusable snapshot, so nothing was collected (earlier listings are kept)` });

  if (last == null && !snapshots) return { ...base, action: 'none', reason: 'the last collection time is unknown (no saved state and the Bright Data snapshot list is unavailable); not collecting to be safe' };
  if (last != null && now < last + fb.collectionCooldownHours * 3600000) return reuse(`collection cooldown (${fb.collectionCooldownHours}h) runs until ${nextCollectionAfter}`);
  if (fb.monthlyRecordBudget > 0 && guardUsed + expected > guardLimit) return reuse(`monthly record guard: ${guardUsed} counted + ~${expected} expected would exceed ${guardLimit} (${fb.monthlyRecordBudget} budget - ${fb.monthlySafetyBuffer} buffer)`);
  return { ...base, action: 'collect', reason: last == null ? 'no earlier collection found' : `cooldown passed (last collection ${new Date(last).toISOString()})` };
}

// ---------- adapter entry point ----------

export async function fetchListings(cfg, log = () => {}, { previous = null, now = Date.now(), fetchImpl = fetch, wait = sleep } = {}) {
  const fb = cfg.facebook;
  if (!fb.apiKey) throw new AuthRequiredError('BRIGHTDATA_API_KEY is not set');
  const groups = fb.groups.slice(0, fb.maxGroups);
  if (!groups.length) throw new Error('FACEBOOK_GROUPS is not configured');

  const prevState = previous?.state || null;
  let plan = null;
  let snapshots = null;
  if (!fb.reuseSnapshot) {
    try { snapshots = await listSnapshots({ apiKey: fb.apiKey, fetchImpl }); } catch (err) {
      if (err instanceof AuthRequiredError) throw err;
      log(`facebook: snapshot list unavailable (${String(err.message).slice(0, 120)})`);
    }
    plan = planCollection({ fb, state: prevState, lastSuccessAt: previous?.lastSuccessAt, snapshots, now });
    log(`facebook: plan=${plan.action} · ${plan.reason} · month ${plan.month}: ${plan.monthRecords} records counted${plan.monthUnmeasured ? ` + ${plan.monthUnmeasured} unmeasured collection(s)` : ''}`);
    if (plan.action === 'none') throw new Error(`No Facebook refresh this run: ${plan.reason}`);
  }

  const { start, end } = dateWindow({ now, lastSuccessAt: previous?.lastSuccessAt, initialWindowDays: fb.initialWindowDays, maxWindowDays: fb.maxWindowDays, overlapHours: fb.overlapHours });
  const stats = {
    provider: 'Bright Data', datasetId: DATASET_ID, groups, skippedGroups: fb.groups.length - groups.length,
    window: { start: start.toISOString(), end: end.toISOString() },
    recordsRetrieved: 0, errorRecords: 0, posts: 0, housingListings: 0,
    rejected: { seeking: 0, 'not-housing': 0, 'no-text': 0, 'outside-nyc': 0, 'no-post-link': 0 },
    recordsWithImages: 0, photoUrls: 0, expiredPhotoUrls: 0, fieldsSeen: [],
  };
  let records;
  const month = monthKey(now);
  const carried = prevState && prevState.month === month ? prevState : { ...(prevState || {}), month, monthRecords: 0, monthUnmeasured: 0, monthCollections: 0 };
  let state;
  if (fb.reuseSnapshot || plan.action === 'reuse') {
    const which = fb.reuseSnapshot || plan.snapshotId;
    const r = await reuseSnapshot({ apiKey: fb.apiKey, which, list: snapshots, direct: !!plan?.direct, maxWaitSeconds: fb.maxWaitSeconds, pollSeconds: fb.pollSeconds, fetchImpl, wait, log });
    records = r.records;
    const createdAt = r.created && Number.isFinite(Date.parse(r.created)) ? new Date(r.created).toISOString() : null;
    // The data is as of the snapshot, so the next collection starts from there.
    Object.assign(stats, { snapshotReused: true, snapshotId: r.snapshotId, collectedAt: createdAt || previous?.lastSuccessAt || null, window: null });
    state = { ...carried, snapshotId: r.snapshotId };
    if (r.snapshotId === carried.pendingSnapshotId) {
      // A collection we started earlier (which timed out here) has finished: count it now.
      Object.assign(state, { pendingSnapshotId: null, lastCollectedAt: createdAt || carried.lastTriggeredAt, lastRecords: records.length, monthRecords: (carried.monthRecords || 0) + records.length, monthUnmeasured: Math.max(0, (carried.monthUnmeasured || 0) - 1) });
    }
    if (!state.lastCollectedAt && createdAt) state.lastCollectedAt = createdAt;
  } else {
    const triggeredAt = new Date(now).toISOString();
    try {
      let snapshotId;
      ({ snapshotId, records } = await collect({ apiKey: fb.apiKey, groups, start, end, maxWaitSeconds: fb.maxWaitSeconds, pollSeconds: fb.pollSeconds, fetchImpl, wait, log }));
      state = { ...carried, snapshotId, pendingSnapshotId: null, lastCollectedAt: triggeredAt, lastTriggeredAt: triggeredAt, lastRecords: records.length, monthRecords: (carried.monthRecords || 0) + records.length, monthCollections: (carried.monthCollections || 0) + 1 };
      Object.assign(stats, { snapshotReused: false, snapshotId, collectedAt: triggeredAt });
    } catch (err) {
      if (err.triggeredSnapshotId) {
        // Accepted by Bright Data but not finished here: start the cooldown anyway
        // and remember the snapshot so a later run can reuse (and count) it.
        err.state = { ...carried, lastTriggeredAt: triggeredAt, pendingSnapshotId: err.triggeredSnapshotId, monthCollections: (carried.monthCollections || 0) + 1, monthUnmeasured: (carried.monthUnmeasured || 0) + 1 };
      }
      throw err;
    }
  }
  const cooldownMs = fb.collectionCooldownHours * 3600000;
  const lastAt = Math.max(...[state.lastCollectedAt, state.lastTriggeredAt].map((t) => Date.parse(t)).filter(Number.isFinite), -Infinity);
  stats.collection = {
    mode: stats.snapshotReused ? 'reused-snapshot' : 'new-collection',
    reason: fb.reuseSnapshot ? `FACEBOOK_REUSE_SNAPSHOT=${fb.reuseSnapshot}` : plan.reason,
    cooldownHours: fb.collectionCooldownHours,
    nextCollectionAfter: Number.isFinite(lastAt) ? new Date(lastAt + cooldownMs).toISOString() : null,
    month: state.month, monthRecords: state.monthRecords || 0, monthUnmeasured: state.monthUnmeasured || 0,
    monthlyRecordBudget: fb.monthlyRecordBudget, monthlySafetyBuffer: fb.monthlySafetyBuffer,
  };
  const audit = [];
  stats.recordsRetrieved = records.length;
  const keys = new Set();
  const out = [];
  const seen = new Set();
  const retrieved = [];
  for (const rec of records) {
    if (rec && typeof rec === 'object') Object.keys(rec).forEach((k) => keys.add(k));
    const post = recordToPost(rec, { groupUrl: groups.length === 1 ? groups[0] : null });
    if (post.error) { stats.errorRecords++; continue; }
    stats.posts++;
    if (post.photos.length) stats.recordsWithImages++;
    stats.photoUrls += post.photos.length;
    stats.expiredPhotoUrls += post.photos.filter((p) => p.expiresAt && Date.parse(p.expiresAt) <= now).length;
    retrieved.push(`${meta.id}:${post.postId || post.url}`);
    const { listing, reason } = postToListing(post);
    if (fb.dumpRaw) audit.push({ postId: post.postId, url: post.url, postedAt: post.postedAt, group: post.groupName, photos: post.photos.length, reason, text: post.text });
    if (!listing) { stats.rejected[reason] = (stats.rejected[reason] || 0) + 1; continue; }
    if (!listing.originalUrl) { stats.rejected['no-post-link'] = (stats.rejected['no-post-link'] || 0) + 1; continue; }
    if (seen.has(listing.sourceId)) continue;
    seen.add(listing.sourceId);
    out.push(listing);
  }
  stats.housingListings = out.length;
  stats.fieldsSeen = [...keys].sort(); // field NAMES only (no values) to document the real record shape
  if (records.length > fb.maxRecordsWarn) log(`facebook: WARNING ${records.length} records in one run (above FACEBOOK_MAX_RECORDS_WARN=${fb.maxRecordsWarn})`);
  log(`facebook: ${records.length} records (${stats.errorRecords} error records), ${stats.posts} posts, ${out.length} housing listings, ${stats.recordsWithImages} posts with image URLs`);
  out.sourceStats = stats;
  out.state = state;
  // Every post id seen this run, accepted or not: this run's result replaces
  // any earlier copy (so a post the current parser rejects is not carried over).
  out.retrievedIds = retrieved;
  // Verify runs only: every post's text + classification for the private
  // (encrypted) parser audit. Never written in publish runs.
  if (fb.dumpRaw) out.auditPosts = audit;
  return out;
}
