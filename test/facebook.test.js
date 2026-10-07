// Facebook adapter unit tests. Every record below is a hand-written FIXTURE
// shaped like a Bright Data "Posts by group URL" record — not real data, and
// never written to public/data. Real-data verification happens only through
// the verify workflow against the live Bright Data API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGroups, bdDate, planCollection, dateWindow, collect, recordToPost, recordPhotos, photoExpiry,
  canonicalPostUrl, classifyHousing, postToListing, fetchListings, DATASET_ID,
} from '../scraper/sources/facebook.js';
import { normalizeListing } from '../scraper/schema.js';
import { dedupe } from '../scraper/dedupe.js';
import { run } from '../scraper/index.js';
import { SOURCES } from '../scraper/sources/index.js';
import { config } from '../scraper/config.js';
import { validatePhotos } from '../scraper/photos.js';
import { audit } from '../scripts/sanitize.js';

const REF = '2026-09-20T15:00:00.000Z';
const future = Math.floor(Date.parse('2030-01-01') / 1000).toString(16);
const past = Math.floor(Date.parse('2020-01-01') / 1000).toString(16);
const img = (name, oe = future) => `https://scontent-lga3-1.xx.fbcdn.net/v/t39.30808-6/${name}.jpg?_nc_cat=1&oe=${oe}`;
const rec = (over = {}) => ({
  url: 'https://www.facebook.com/groups/111222333/posts/444555666/?__cft__[0]=tracking',
  post_id: '444555666',
  group_id: '111222333',
  group_name: 'NYC Rooms (fixture)',
  user_username_raw: 'Jane D**',
  user_url: 'https://www.facebook.com/jane.fixture',
  content: 'Private room available in Bushwick for $1,400/month. Available October 1. 3BR apartment, laundry in building.',
  date_posted: REF,
  attachments: [{ type: 'Photo', url: img('room1') }, { type: 'Photo', url: img('room2') }],
  ...over,
});
const listingFrom = (content, over = {}) => {
  const { listing } = postToListing(recordToPost(rec({ content, ...over })));
  return listing && normalizeListing(listing, { scrapedAt: REF });
};

test('1. realistic room-for-rent post becomes a Facebook listing', () => {
  const l = listingFrom(rec().content);
  assert.ok(l);
  assert.equal(l.source, 'facebook');
  assert.equal(l.listingType.value, 'ROOM_IN_SHARED_APARTMENT');
  assert.equal(l.neighborhood.value, 'Bushwick');
  assert.equal(l.laundry.value, 'in_building');
  assert.equal(l.sourceLabel, 'Facebook · NYC Rooms (fixture)');
  assert.equal(l.originalUrl, 'https://www.facebook.com/groups/111222333/posts/444555666/');
  assert.equal(l.photos.length, 2);
  assert.equal(l.dataKind, 'REAL', 'normalizeListing default; fixtures only live in tests');
  const blob = JSON.stringify(l);
  assert.equal(blob.includes('Jane'), false, 'poster name is not copied');
  assert.equal(blob.includes('jane.fixture'), false, 'poster profile URL is not copied');
});

test('2. seeking / ISO / vague posts are rejected', () => {
  for (const t of ['ISO a room in Brooklyn under $1,200, move in Nov 1', 'Looking for a room in Astoria, budget $1,100', 'Anyone know of a place in Harlem for October?', 'Searching for apartment near the L train']) {
    assert.equal(classifyHousing(t).reason, 'seeking', t);
    assert.equal(postToListing(recordToPost(rec({ content: t }))).listing, null);
  }
  assert.equal(classifyHousing('Need roommate, anyone interested?').housing, false);
  // Phrasings found in the first real Bright Data run (2026-09-26), paraphrased:
  for (const t of ['Hello everyone, looking for a furnished 1bd/studio (no roommates) or a short term sublet!', 'Looking for sublease 10/09 - 11/20, flexible dates', 'URGENT: ISO OCT sublet in a private furnished room']) {
    assert.equal(classifyHousing(t).reason, 'seeking', t);
  }
  for (const t of [
    'Looking for a comfortable place to stay in Manhattan? This furnished studio is available. Monthly rent: $2,190',
    'Studio for rent in Hell’s Kitchen, $2,190/month, ideal for anyone looking for a convenient and flexible place to stay.',
    'Hi! Seeking lease takeover for Nov 1st move in: 1 bedroom studio, $2,075 a month. I need to be out before October 30th.',
    'Looking for a roommate for my room in Bushwick, $1,200/month',
  ]) {
    assert.equal(classifyHousing(t).housing, true, t);
  }
  assert.equal(classifyHousing('Happy Friday everyone!').reason, 'not-housing');
  assert.equal(classifyHousing('').reason, 'no-text');
});

test('3. explicit room price → your share', () => {
  const l = listingFrom('Room available for $1,400/month in Astoria, move in November 1.');
  assert.equal(l.price.share, 1400);
  assert.equal(l.price.status, 'known');
});

test('4. total rent without a stated split → share unknown, total kept', () => {
  const l = listingFrom('$3,000 2BR in Crown Heights, looking for a roommate. Available October 15.');
  assert.ok(l);
  assert.equal(l.price.share, null, 'never total ÷ bedrooms');
  assert.equal(l.price.total, 3000);
  assert.equal(l.price.status, 'needs_confirmation');
});

test('5. explicit equal split → calculated share', () => {
  const l = listingFrom('Room for rent in Bed-Stuy: $3,000 total, split evenly between 2 people. Available now.');
  assert.equal(l.price.share, 1500);
  assert.equal(l.price.split, 'even_split_stated');
});

test('6. stated roommate count is extracted', () => {
  const l = listingFrom('Private room for rent in Ridgewood, $1,250/month. You would share with two others. Available October 1.');
  assert.equal(l.roommates.value, 2);
  assert.equal(l.roommates.basis, 'explicit');
});

test('7. ambiguous household wording is not turned into a roommate count', () => {
  const l = listingFrom('Room for rent in our home in Flushing, $900/month. I live here with my family of 3.');
  assert.ok(l);
  assert.equal(l.roommates.value, null);
});

test('8. move-in date is parsed relative to the post date', () => {
  const l = listingFrom('Private room available in Bushwick, $1,300/month, available October 1.');
  assert.equal(l.moveIn.value?.date, '2026-10-01');
});

test('9b. a listing link always opens the post, never the bare group', () => {
  // The provider's own post link wins over one rebuilt from ids.
  assert.equal(recordToPost(rec({ url: 'https://www.facebook.com/groups/111222333/permalink/444555666/?__cft__[0]=x' })).url,
    'https://www.facebook.com/groups/111222333/permalink/444555666/');
  // `url` holding the group itself: the post link comes from another field, else from the ids.
  assert.equal(recordToPost(rec({ url: 'https://www.facebook.com/groups/111222333/', post_url: 'https://www.facebook.com/groups/111222333/posts/777/' })).url,
    'https://www.facebook.com/groups/111222333/posts/777/');
  assert.equal(recordToPost(rec({ url: 'https://www.facebook.com/groups/111222333/' })).url, 'https://www.facebook.com/groups/111222333/posts/444555666/');
  // Graph-style "<group>_<post>" ids and pfbid ids.
  assert.equal(recordToPost(rec({ url: undefined, post_id: '111222333_444555666' })).url, 'https://www.facebook.com/groups/111222333/posts/444555666/');
  assert.equal(recordToPost(rec({ url: 'https://www.facebook.com/groups/111222333/posts/pfbid02abcXYZ/' })).url, 'https://www.facebook.com/groups/111222333/posts/pfbid02abcXYZ/');
  assert.equal(canonicalPostUrl({ url: 'https://www.facebook.com/permalink.php?story_fbid=55&id=66&ref=x' }), 'https://www.facebook.com/permalink.php?story_fbid=55&id=66');
  assert.equal(canonicalPostUrl({ url: 'https://www.facebook.com/groups/1/?multi_permalinks=2', groupId: '1', postId: '2' }), 'https://www.facebook.com/groups/1/posts/2/');
  // No post id anywhere: no link (and no listing), rather than the group feed.
  assert.equal(recordToPost(rec({ url: 'https://www.facebook.com/groups/111222333/', post_id: undefined })).url, null);
  assert.equal(canonicalPostUrl({ url: 'https://www.facebook.com/groups/111222333/', groupId: '111222333', postId: 'abc def' }), null);
  assert.equal(postToListing(recordToPost(rec({ url: 'https://www.facebook.com/groups/111222333/', post_id: undefined }))).listing.originalUrl, null);
});

test('9. post id / URL normalization and FACEBOOK_GROUPS parsing', () => {
  const p = recordToPost(rec());
  assert.equal(p.postId, '444555666');
  assert.equal(p.url, 'https://www.facebook.com/groups/111222333/posts/444555666/');
  const p2 = recordToPost(rec({ post_id: undefined, group_id: undefined, url: 'https://m.facebook.com/groups/nycrooms/permalink/987654321/?ref=share' }));
  assert.equal(p2.postId, '987654321');
  assert.equal(p2.url, 'https://www.facebook.com/groups/nycrooms/permalink/987654321/');
  assert.equal(canonicalPostUrl({ url: 'https://evil.example/groups/1/posts/2/' }), null);
  assert.deepEqual(parseGroups('["https://www.facebook.com/groups/NYCRooms/?ref=share", "roommatesnyc"]'),
    ['https://www.facebook.com/groups/NYCRooms/', 'https://www.facebook.com/groups/roommatesnyc/']);
  assert.deepEqual(parseGroups('https://facebook.com/groups/123, https://example.com/groups/x\nhttps://www.facebook.com/groups/123/'),
    ['https://www.facebook.com/groups/123/']);
  assert.deepEqual(parseGroups(''), []);
  assert.equal(bdDate('2026-09-05T23:00:00Z'), '09-05-2026');
});

test('10. duplicate Facebook posts are deduplicated (same id; same post in two groups)', async () => {
  const records = [rec(), rec(), rec({ url: 'https://www.facebook.com/groups/999/posts/777/', post_id: '777', group_id: '999', group_name: 'Other group' })];
  const fetchImpl = fakeBrightData(records);
  const cfg = { facebook: { ...config.facebook, apiKey: 'k', groups: ['https://www.facebook.com/groups/111222333/'], pollSeconds: 0 } };
  const out = await fetchListings(cfg, () => {}, { fetchImpl: fetchImpl.fn, wait: async () => {}, now: Date.parse(REF) });
  assert.equal(out.length, 2, 'the repeated post id collapses at collection');
  const merged = dedupe(out.map((p) => normalizeListing(p, { scrapedAt: REF })));
  assert.equal(merged.length, 1, 'same text + same price across two groups merges as a repost');
  assert.equal(merged[0].sources.length, 2);
});

test('11. a Facebook failure never stops other sources', async () => {
  const failing = { id: 'facebook', name: 'Facebook', enabledByDefault: true, incremental: true, run: async () => { throw new Error('Bright Data trigger failed (HTTP 500)'); } };
  const ok = { id: 'roomster', name: 'Roomster', enabledByDefault: true, run: async () => [{ source: 'roomster', sourceId: '1', sourceLabel: 'Roomster', originalUrl: 'https://roomster.com/listings/1', title: 'Room', price: { monthly: 1200, type: 'room_share', basis: 'structured' } }] };
  const { status, listings } = await run({ sources: [failing, ok], dryRun: true, log: () => {}, previousListings: [] });
  const fb = status.sources.find((s) => s.id === 'facebook');
  assert.equal(fb.status, 'UNVERIFIED');
  assert.match(fb.failureReason, /HTTP 500/);
  assert.equal(status.sources.find((s) => s.id === 'roomster').status, 'LIVE');
  assert.equal(listings.length, 1);
});

test('12. missing BRIGHTDATA_API_KEY → AUTH_REQUIRED status, no request', async () => {
  const saved = { ...config.facebook };
  Object.assign(config.facebook, { apiKey: '', groups: ['https://www.facebook.com/groups/x/'] });
  try {
    const { status } = await run({ sources: SOURCES.filter((s) => s.id === 'facebook'), dryRun: true, log: () => {}, previousListings: [] });
    assert.equal(status.sources[0].status, 'AUTH_REQUIRED');
    assert.match(status.sources[0].reason, /BRIGHTDATA_API_KEY/);
    assert.equal(status.sources[0].enabled, false);
  } finally { Object.assign(config.facebook, saved); }
});

test('13. missing FACEBOOK_GROUPS → UNVERIFIED status, no request', async () => {
  const saved = { ...config.facebook };
  Object.assign(config.facebook, { apiKey: 'set-for-test', groups: [] });
  try {
    const { status } = await run({ sources: SOURCES.filter((s) => s.id === 'facebook'), dryRun: true, log: () => {}, previousListings: [] });
    assert.equal(status.sources[0].status, 'UNVERIFIED');
    assert.match(status.sources[0].reason, /FACEBOOK_GROUPS/);
  } finally { Object.assign(config.facebook, saved); }
});

test('14. photo URLs: post images only, https Facebook CDN only, expiry honored, validation drops broken', async () => {
  const photos = recordPhotos({
    attachments: [{ type: 'Photo', url: img('a') }, { type: 'Video', url: img('v') }, 'http://scontent.xx.fbcdn.net/insecure.jpg', { type: 'Photo', url: 'https://example.com/stock.jpg' }],
    user_profile_image: img('profile'), post_image: img('b'),
  });
  assert.deepEqual(photos.map((p) => p.url), [img('a'), img('b')]);
  assert.equal(photoExpiry(img('a')), '2030-01-01T00:00:00.000Z');
  const l = listingFrom(rec().content, { attachments: [{ type: 'Photo', url: img('old', past) }] });
  assert.equal(l.photos.length, 0, 'expired signed link is not kept');
  assert.equal(l.photoStatus, 'source_only', 'UI shows "Photos unavailable — view original listing"');

  const listing = listingFrom(rec().content);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    status: String(url).includes('room1') ? 200 : 403,
    headers: { get: () => (String(url).includes('room1') ? 'image/jpeg' : 'text/html') },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  try {
    await validatePhotos([listing], { perListing: 2 });
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(listing.photos.map((p) => p.validation), ['ok']);
  assert.equal(listing.photoValidation.checked, 2);
});

test('15. sample/fixture listings can never reach production output', async () => {
  const sample = normalizeListing({ source: 'facebook', sourceId: 's1', sourceLabel: 'Facebook', originalUrl: 'https://www.facebook.com/groups/1/posts/2/', title: 'Room', price: { monthly: 1000, type: 'room_share', basis: 'explicit' } }, { dataKind: 'SAMPLE' });
  const { listings, status } = await run({ sources: [], dryRun: true, log: () => {}, previousListings: [sample] });
  assert.equal(listings.length, 0);
  assert.equal(status.totals.dropped['not real data'], 1);
  assert.ok(audit({ dataKind: 'REAL', listings: [sample] }, { dataKind: 'REAL' }).some((p) => /not REAL/.test(p)));
});

test('Bright Data flow: trigger → progress → snapshot (202 then 200), dates, auth header, one trigger only', async () => {
  const fake = fakeBrightData([rec()], { runningPolls: 2, building: 1 });
  const logs = [];
  const { records, snapshotId } = await collect({
    apiKey: 'secret-key-123', groups: ['https://www.facebook.com/groups/111222333/'],
    start: new Date('2026-09-13T00:00:00Z'), end: new Date('2026-09-20T00:00:00Z'),
    pollSeconds: 0, fetchImpl: fake.fn, wait: async () => {}, log: (m) => logs.push(m),
  });
  assert.equal(snapshotId, 's_fixture');
  assert.equal(records.length, 1);
  const trig = fake.calls.filter((c) => c.url.includes('/trigger'));
  assert.equal(trig.length, 1);
  assert.match(trig[0].url, new RegExp(`dataset_id=${DATASET_ID}`));
  assert.deepEqual(JSON.parse(trig[0].body), [{ url: 'https://www.facebook.com/groups/111222333/', start_date: '09-13-2026', end_date: '09-20-2026' }]);
  assert.ok(fake.calls.every((c) => c.auth === 'Bearer secret-key-123'));
  assert.equal(logs.join(' ').includes('secret-key-123'), false, 'API key never logged');
});

test('Bright Data flow: timeout gives up without re-triggering; 401 → auth error', async () => {
  const slow = fakeBrightData([], { runningPolls: 1000 });
  await assert.rejects(collect({ apiKey: 'k', groups: ['https://www.facebook.com/groups/1/'], start: new Date(), end: new Date(), maxWaitSeconds: 0, pollSeconds: 1, fetchImpl: slow.fn, wait: async () => {} }), /not ready/);
  assert.equal(slow.calls.filter((c) => c.url.includes('/trigger')).length, 1);
  const denied = async () => ({ status: 401, ok: false, text: async () => '' });
  await assert.rejects(collect({ apiKey: 'bad', groups: ['https://www.facebook.com/groups/1/'], start: new Date(), end: new Date(), fetchImpl: denied }), { name: 'AuthRequiredError' });
});

test('incremental window: since last success minus overlap, capped; cooldown never triggers a collection', async () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  assert.equal(dateWindow({ now }).start.toISOString(), '2026-09-18T12:00:00.000Z');
  assert.equal(dateWindow({ now, lastSuccessAt: '2026-09-25T00:00:00Z', overlapHours: 6 }).start.toISOString(), '2026-09-24T18:00:00.000Z');
  assert.equal(dateWindow({ now, lastSuccessAt: '2026-08-01T00:00:00Z', maxWindowDays: 7 }).start.toISOString(), '2026-09-18T12:00:00.000Z');
  const cfg = { facebook: { ...config.facebook, apiKey: 'k', groups: ['https://www.facebook.com/groups/1/'], collectionCooldownHours: 36 } };
  const fake = fakeBrightData([], { snapshots: [] });
  // Cooldown active, nothing reusable: fails safely without collecting.
  await assert.rejects(fetchListings(cfg, () => {}, { previous: { lastSuccessAt: '2026-09-25T09:00:00Z' }, now, fetchImpl: fake.fn }), /no reusable snapshot/);
  assert.equal(fake.calls.filter((c) => c.url.includes('/trigger')).length, 0, 'no collection started');
});

// Fake Bright Data HTTP API for unit tests.
function fakeBrightData(records, { runningPolls = 0, building = 0, snapshots = [], listStatus = 200 } = {}) {
  const calls = [];
  let polls = 0;
  let builds = 0;
  const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
  const fn = async (url, init = {}) => {
    calls.push({ url, body: init.body, auth: init.headers?.Authorization });
    if (url.includes('/snapshots?')) return res(listStatus, listStatus === 200 ? snapshots : {});
    if (url.includes('/trigger')) return res(200, { snapshot_id: 's_fixture' });
    if (url.includes('/progress/')) return res(200, { status: polls++ < runningPolls ? 'running' : 'ready' });
    if (url.includes('/snapshot/')) return builds++ < building ? res(202, { status: 'building' }) : res(200, records);
    return res(404, {});
  };
  return { fn, calls };
}

test('snapshot reuse: downloads an existing ready snapshot and never starts a collection', async () => {
  const calls = [];
  const res = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => '' });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/snapshots?')) return res(200, [{ id: 's_old', created: '2026-09-20T00:00:00Z', status: 'ready', dataset_size: 10 }, { id: 's_new', created: '2026-09-26T18:28:00Z', status: 'ready', dataset_size: 189 }]);
    if (url.includes('/snapshot/s_new')) return res(200, [rec()]);
    return res(404, {});
  };
  const cfg = { facebook: { ...config.facebook, apiKey: 'k', groups: ['https://www.facebook.com/groups/111222333/'], reuseSnapshot: 'latest', dumpRaw: true } };
  const out = await fetchListings(cfg, () => {}, { previous: { lastSuccessAt: new Date().toISOString() }, fetchImpl, wait: async () => {} });
  assert.equal(calls.some((u) => u.includes('/trigger')), false, 'no new collection');
  assert.equal(out.length, 1);
  assert.equal(out.sourceStats.snapshotReused, true);
  assert.equal(out.sourceStats.collectedAt, '2026-09-26T18:28:00.000Z');
  assert.equal(out.auditPosts.length, 1);
  assert.equal(JSON.stringify(out.auditPosts).includes('jane.fixture'), false, 'audit dump has no poster profile');
  const none = async (url) => (url.includes('/snapshots?') ? res(200, []) : res(404, {}));
  await assert.rejects(fetchListings(cfg, () => {}, { fetchImpl: none }), /no collection was started/);
});

// Regressions from the full audit of the 189-post real snapshot (2026-09-26); texts paraphrased.
test('audit: offers the first version rejected are now recognized', () => {
  for (const t of [
    "Yo - I'm Chadd and I'm looking for 2x roommates to move into my Bushwick apt on October 1st. 3 beds 1.5 bath.",
    'Looking for someone to take over a bright, spacious 1-bedroom apartment in Bay Ridge. Lease from Oct 1.',
    'Looking to reassign my 2 bed/2 bath lease on the upper west side starting late November. $7920/month.',
    'Studio-sized bedroom in shared 3 bed with just one other person in Washington Heights.',
    'Room/ROOMMATE/Shared apartment $1,100 utilities included, 20 minutes to the city.',
    '1 Bed | 1 Bath $4,500/month. 1 Month Free & No Broker Fee. In-unit washer.',
    "i'm looking to have someone take over my room oct-july in hell's kitchen. Rent is $2175.",
    "Short-Term Sublet (Female Only). I'm looking for a female subletter for my bedroom in a 2bed/1bath apartment.",
    "Hi everyone! I'm looking for a tenant for my FiDi studio from Nov 2026 through May 2027.",
    "I'm still looking to fill a room in Williamsburg by October 1st. If anyone has any leads or needs a place, DM me.",
  ]) {
    const r = classifyHousing(t);
    assert.equal(r.housing, true, t);
    assert.ok(postToListing(recordToPost(rec({ content: t }))).listing, `listing: ${t}`);
  }
});

test('audit: seekers the first version accepted are now rejected', () => {
  for (const t of [
    "My friend is relocating to NYC and is looking to sublet a one bedroom apartment. Start: early Oct.",
    "Hi! I'm looking to sublease near FiDi from October - December.",
    'Looking to sublet a 1BR or studio in the UES. My budget is ~$3500 a month.',
    'Looking for lease takeover or long term sublet starting early October! Budget: Under 2,000 per month. Please dm if you have a room available!',
    'NYC SUBLET / ROOMMATE SEARCH. I am looking for a room/sublet in NYC. Budget: around $1,200–$1,700/month. If you have a room available, feel free to message.',
    'Looking for a Roommate to Apartment Hunt With in Manhattan',
    'LOOKING FOR: Sublease to join in on or Roommates to sign a lease with',
    'I’m looking to fill a room/long term SUBLET in any of these neighborhoods: East Village, LES, Nolita.',
    'SHORT-TERM ROOM / SUBLET WANTED — NYC',
  ]) assert.equal(classifyHousing(t).housing, false, t);
  // …while "ROOMMATE WANTED" on its own is still an offer.
  assert.equal(classifyHousing('Roommate wanted! Private room in Astoria, $1,050/month').housing, true);
});

test('audit: offers outside NYC are dropped', () => {
  assert.equal(classifyHousing('Private Rooms in Harrison/East Newark — From $750/mo. Renovated 2BR near NJIT.').reason, 'outside-nyc');
  assert.equal(classifyHousing('Beautiful Tudor home near Sarah Lawrence College in Yonkers, 4 bedrooms, available now, $5,000/month').reason, 'outside-nyc');
  assert.equal(classifyHousing('Room for rent in Jersey City near the PATH, $1,200/month').housing, true, 'nearby NJ is kept');
});

test('audit: whole-apartment wording turns a lone "likely share" into the apartment total', () => {
  const bedStuy = listingFrom('Newly Renovated Bed-Stuy Apartment | In-Unit W/D & Dishwasher | Next to A/C Trains\nAvailable now. Rent $4,000/month.');
  assert.equal(bedStuy.listingType.value, 'ENTIRE_APARTMENT');
  assert.equal(bedStuy.price.share, null, 'multi/unknown-bedroom apartment: never a share');
  assert.equal(bedStuy.price.total, 4000);
  const elmhurst = listingFrom('1-BEDROOM IN ELMHURST, QUEENS\nMove-in ready 1BR/1BA. Rent $1,800/month. Available now.');
  assert.equal(elmhurst.listingType.value, 'ENTIRE_APARTMENT');
  assert.equal(elmhurst.price.share, 1800, 'a whole 1BR: its rent is what you would pay');
  assert.equal(elmhurst.price.split, 'whole_unit');
  const room = listingFrom("i'm looking to have someone take over my room oct-july in hell's kitchen, apartment is 51st and 9th. Rent is $1,575.");
  assert.notEqual(room.listingType.value, 'ENTIRE_APARTMENT', 'taking over a room is not an entire apartment');
  assert.equal(room.price.share, 1575);
});

test('audit: a seeker with a budget asking "anyone … needs someone to sublet their room" is not an offer', () => {
  const seeker = "Hey everyone! I'm still looking to fill a room in Williamsburg near Bedford Ave by October 1st. My budget is around $1700-$1800, okay with 1 or 2 roommates. If anyone has any leads or needs someone to long-term sublet their room, please reach out. Thanks!";
  assert.equal(classifyHousing(seeker).housing, false);
  assert.equal(classifyHousing('Room available in our Bushwick apartment, $1,450/month. Budget-friendly! My roommate is moving out and I need someone to take over their room Oct 1.').housing, true, 'an owner offering the roommate\'s room still counts');
});

test('incremental: a re-retrieved post replaces its carried-over copy; a now-rejected post is removed', async () => {
  const mk = (id, extra = {}) => normalizeListing({ source: 'facebook', sourceId: id, sourceLabel: 'Facebook', originalUrl: `https://www.facebook.com/groups/1/posts/${id}/`, title: 'Room', postedAt: new Date().toISOString(), price: { monthly: 1000, type: 'room_share', basis: 'explicit' }, ...extra }, { scrapedAt: new Date().toISOString() });
  const previousListings = [mk('keep'), mk('rejected-now'), mk('updated')];
  const partials = Object.assign([{ source: 'facebook', sourceId: 'updated', sourceLabel: 'Facebook', originalUrl: 'https://www.facebook.com/groups/1/posts/updated/', title: 'Room, new parse', postedAt: new Date().toISOString(), price: { monthly: 1100, type: 'room_share', basis: 'explicit' } }],
    { sourceStats: { provider: 'Bright Data', groups: ['g'], recordsRetrieved: 2, errorRecords: 0, housingListings: 1, rejected: { seeking: 1 }, recordsWithImages: 0 }, retrievedIds: ['facebook:rejected-now', 'facebook:updated'] });
  const src = { id: 'facebook', name: 'Facebook', enabledByDefault: true, incremental: true, run: async () => partials };
  const { listings } = await run({ sources: [src], dryRun: true, log: () => {}, previousListings });
  assert.deepEqual(listings.map((l) => l.id).sort(), ['facebook:keep', 'facebook:updated'], 'not re-read → carried over; re-read and rejected → gone');
  assert.equal(listings.find((l) => l.id === 'facebook:updated').price.share, 1100, 'the new parse wins');
  assert.equal(listings.find((l) => l.id === 'facebook:keep').carriedOver, true);
});

// ---------- collection cooldown, snapshot reuse, monthly guard ----------
const T0 = '2026-09-26T18:30:00.000Z'; // last real collection
const H = 3600000;
const fbCfg = (over = {}) => ({ facebook: { ...config.facebook, apiKey: 'k', groups: ['https://www.facebook.com/groups/111222333/'], pollSeconds: 0, collectionCooldownHours: 36, monthlyRecordBudget: 5000, monthlySafetyBuffer: 500, ...over } });
const readySnap = (id = 's_prev', created = T0, size = 189) => ({ id, created, status: 'ready', dataset_size: size });

test('config: collection cooldown defaults to 36h and is one setting', () => {
  assert.equal(config.facebook.collectionCooldownHours, 36);
  assert.equal(config.facebook.monthlyRecordBudget, 5000);
  assert.equal(config.facebook.monthlySafetyBuffer, 500);
  assert.equal('minHoursBetweenRuns' in config.facebook, false);
});

test('cooldown active → reuses the last completed snapshot and never calls /trigger', async () => {
  const fake = fakeBrightData([rec()], { snapshots: [readySnap()] });
  const previous = { lastSuccessAt: T0, state: { lastCollectedAt: T0, snapshotId: 's_prev', month: '2026-09', monthRecords: 189, lastRecords: 189 } };
  const out = await fetchListings(fbCfg(), () => {}, { previous, now: Date.parse(T0) + 3 * H, fetchImpl: fake.fn, wait: async () => {} });
  assert.equal(fake.calls.filter((c) => c.url.includes('/trigger')).length, 0);
  assert.ok(fake.calls.some((c) => c.url.includes('/snapshot/s_prev')), 'snapshot re-downloaded and parsed');
  assert.equal(out.length, 1);
  assert.equal(out.sourceStats.collection.mode, 'reused-snapshot');
  assert.equal(out.sourceStats.collection.nextCollectionAfter, new Date(Date.parse(T0) + 36 * H).toISOString());
  assert.equal(out.sourceStats.collectedAt, T0, 'next incremental window still starts from the real collection');
  assert.equal(out.state.monthRecords, 189, 'reuse adds no records');
  assert.equal(out.state.lastCollectedAt, T0);
});

test('cooldown survives lost state: Bright Data\'s own snapshot list is checked', async () => {
  const fake = fakeBrightData([rec()], { snapshots: [readySnap('s_bd', new Date(Date.parse(T0) + 10 * H).toISOString())] });
  const out = await fetchListings(fbCfg(), () => {}, { previous: null, now: Date.parse(T0) + 20 * H, fetchImpl: fake.fn, wait: async () => {} });
  assert.equal(fake.calls.filter((c) => c.url.includes('/trigger')).length, 0);
  assert.equal(out.sourceStats.snapshotId, 's_bd');
});

test('cooldown expired → exactly one new collection; state records time, snapshot and measured records', async () => {
  const fake = fakeBrightData([rec(), rec({ post_id: '2', url: 'https://www.facebook.com/groups/111222333/posts/2/' })], { snapshots: [readySnap()] });
  const previous = { lastSuccessAt: T0, state: { lastCollectedAt: T0, snapshotId: 's_prev', month: '2026-09', monthRecords: 189, lastRecords: 189, monthCollections: 1 } };
  const now = Date.parse(T0) + 37 * H;
  const out = await fetchListings(fbCfg(), () => {}, { previous, now, fetchImpl: fake.fn, wait: async () => {} });
  const trig = fake.calls.filter((c) => c.url.includes('/trigger'));
  assert.equal(trig.length, 1);
  const [input] = JSON.parse(trig[0].body);
  assert.equal(input.start_date, bdDate(Date.parse(T0) - 6 * H), 'incremental window from last success minus the 6h overlap');
  assert.equal(out.sourceStats.collection.mode, 'new-collection');
  assert.equal(out.state.snapshotId, 's_fixture');
  assert.equal(out.state.lastCollectedAt, new Date(now).toISOString());
  assert.equal(out.state.monthRecords, 189 + 2, 'counted from the records actually returned');
  assert.equal(out.state.monthCollections, 2);
  assert.equal(out.state.lastRecords, 2);
});

test('first ever run (no state, no snapshots) collects; unknown history with the list unavailable does not', async () => {
  const fresh = fakeBrightData([rec()], { snapshots: [] });
  await fetchListings(fbCfg(), () => {}, { previous: null, now: Date.parse(T0), fetchImpl: fresh.fn, wait: async () => {} });
  assert.equal(fresh.calls.filter((c) => c.url.includes('/trigger')).length, 1);
  const down = fakeBrightData([rec()], { listStatus: 500 });
  await assert.rejects(fetchListings(fbCfg(), () => {}, { previous: null, now: Date.parse(T0), fetchImpl: down.fn }), /unknown/);
  assert.equal(down.calls.filter((c) => c.url.includes('/trigger')).length, 0);
});

test('list unavailable but saved state says cooldown active → downloads the saved snapshot directly', async () => {
  const fake = fakeBrightData([rec()], { listStatus: 500 });
  const previous = { lastSuccessAt: T0, state: { lastCollectedAt: T0, snapshotId: 's_prev', month: '2026-09', monthRecords: 189 } };
  const out = await fetchListings(fbCfg(), () => {}, { previous, now: Date.parse(T0) + 6 * H, fetchImpl: fake.fn, wait: async () => {} });
  assert.equal(fake.calls.filter((c) => c.url.includes('/trigger')).length, 0);
  assert.ok(fake.calls.some((c) => c.url.includes('/snapshot/s_prev')));
  assert.equal(out.length, 1);
});

test('monthly record guard: no new collection when counted + expected would pass budget - buffer', () => {
  const fb = fbCfg().facebook;
  const snaps = [readySnap()];
  const now = Date.parse('2026-09-29T12:00:00Z');
  const near = planCollection({ fb, state: { lastCollectedAt: T0, snapshotId: 's_prev', month: '2026-09', monthRecords: 4400, lastRecords: 189 }, snapshots: snaps, now });
  assert.equal(near.action, 'reuse');
  assert.match(near.reason, /monthly record guard/);
  const ok = planCollection({ fb, state: { lastCollectedAt: T0, month: '2026-09', monthRecords: 4000, lastRecords: 189 }, snapshots: snaps, now });
  assert.equal(ok.action, 'collect');
  // A new month resets the count.
  const oct = planCollection({ fb, state: { lastCollectedAt: T0, month: '2026-09', monthRecords: 4900, lastRecords: 189 }, snapshots: snaps, now: Date.parse('2026-10-02T00:00:00Z') });
  assert.equal(oct.action, 'collect');
  assert.equal(oct.monthRecords, 0);
  // Unmeasured collections (timed out here) count conservatively.
  const unm = planCollection({ fb, state: { lastCollectedAt: T0, month: '2026-09', monthRecords: 3900, monthUnmeasured: 2, lastRecords: 189 }, snapshots: snaps, now });
  assert.equal(unm.guardUsed, 3900 + 2 * fb.maxRecordsWarn);
  assert.equal(unm.action, 'reuse');
});

test('a collection that times out still starts the cooldown; the next run reuses and counts its snapshot', async () => {
  const slow = fakeBrightData([], { runningPolls: 1000, snapshots: [readySnap()] });
  const previous = { lastSuccessAt: T0, state: { lastCollectedAt: T0, snapshotId: 's_prev', month: '2026-09', monthRecords: 189, lastRecords: 189 } };
  const now = Date.parse(T0) + 40 * H;
  const err = await fetchListings(fbCfg({ maxWaitSeconds: 0, pollSeconds: 1 }), () => {}, { previous, now, fetchImpl: slow.fn, wait: async () => {} }).catch((e) => e);
  assert.match(err.message, /not ready/);
  assert.equal(err.state.pendingSnapshotId, 's_fixture');
  assert.equal(err.state.lastTriggeredAt, new Date(now).toISOString());
  assert.equal(err.state.monthUnmeasured, 1);
  // 3h later: cooldown counts from the trigger; the finished snapshot is reused and measured.
  const later = fakeBrightData([rec(), rec({ post_id: '9', url: 'https://www.facebook.com/groups/111222333/posts/9/' })], { snapshots: [readySnap(), readySnap('s_fixture', new Date(now + H).toISOString(), 2)] });
  const out = await fetchListings(fbCfg(), () => {}, { previous: { lastSuccessAt: T0, state: err.state }, now: now + 3 * H, fetchImpl: later.fn, wait: async () => {} });
  assert.equal(later.calls.filter((c) => c.url.includes('/trigger')).length, 0);
  assert.equal(out.sourceStats.snapshotId, 's_fixture');
  assert.equal(out.state.pendingSnapshotId, null);
  assert.equal(out.state.monthRecords, 189 + 2);
  assert.equal(out.state.monthUnmeasured, 0);
});

test('pipeline: a failed Facebook run keeps earlier listings AND its cooldown state; a success replaces the state', async () => {
  const prevListing = normalizeListing({ source: 'facebook', sourceId: 'p1', sourceLabel: 'Facebook', originalUrl: 'https://www.facebook.com/groups/1/posts/p1/', title: 'Room', postedAt: new Date().toISOString(), price: { monthly: 1000, type: 'room_share', basis: 'explicit' } });
  const state = { lastCollectedAt: T0, snapshotId: 's_prev', month: '2026-09', monthRecords: 189 };
  const failing = { id: 'facebook', name: 'Facebook', enabledByDefault: true, incremental: true, run: async () => { const e = new Error('Bright Data snapshot download failed (HTTP 500)'); throw e; } };
  const { writeFile: wf, mkdir: md, readFile: rf, rm } = await import('node:fs/promises');
  const statusPath = new URL('../public/data/status.json', import.meta.url);
  const saved = await rf(statusPath, 'utf8').catch(() => null);
  await md(new URL('../public/data/', import.meta.url), { recursive: true });
  await wf(statusPath, JSON.stringify({ sources: [{ id: 'facebook', status: 'LIVE', lastSuccessAt: T0, state }] }));
  try {
    const { listings, status } = await run({ sources: [failing], dryRun: true, log: () => {}, previousListings: [prevListing] });
    assert.deepEqual(listings.map((l) => l.id), ['facebook:p1'], 'earlier Facebook listings kept');
    const fb = status.sources[0];
    assert.deepEqual(fb.state, state, 'cooldown state survives the failure');
    assert.equal(fb.status, 'LIVE_WITH_LIMITATIONS');
    assert.match(fb.failureReason, /HTTP 500/);
    const ok = { ...failing, run: async () => Object.assign([], { sourceStats: { provider: 'Bright Data', groups: ['g'], recordsRetrieved: 0, errorRecords: 0, housingListings: 0, rejected: {}, recordsWithImages: 0 }, state: { ...state, snapshotId: 's_new' } }) };
    const r2 = await run({ sources: [ok], dryRun: true, log: () => {}, previousListings: [prevListing] });
    assert.equal(r2.status.sources[0].state.snapshotId, 's_new');
  } finally {
    if (saved == null) await rm(statusPath, { force: true }); else await wf(statusPath, saved);
  }
});
