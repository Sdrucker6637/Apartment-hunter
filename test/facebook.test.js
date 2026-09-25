// Facebook adapter unit tests. Every record below is a hand-written FIXTURE
// shaped like a Bright Data "Posts by group URL" record — not real data, and
// never written to public/data. Real-data verification happens only through
// the verify workflow against the live Bright Data API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGroups, bdDate, dateWindow, collect, recordToPost, recordPhotos, photoExpiry,
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

test('9. post id / URL normalization and FACEBOOK_GROUPS parsing', () => {
  const p = recordToPost(rec());
  assert.equal(p.postId, '444555666');
  assert.equal(p.url, 'https://www.facebook.com/groups/111222333/posts/444555666/');
  const p2 = recordToPost(rec({ post_id: undefined, group_id: undefined, url: 'https://m.facebook.com/groups/nycrooms/permalink/987654321/?ref=share' }));
  assert.equal(p2.postId, '987654321');
  assert.equal(p2.url, 'https://www.facebook.com/groups/nycrooms/posts/987654321/');
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

test('incremental window: since last success minus overlap, capped; cost guard skips recent runs', async () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  assert.equal(dateWindow({ now }).start.toISOString(), '2026-09-18T12:00:00.000Z');
  assert.equal(dateWindow({ now, lastSuccessAt: '2026-09-25T00:00:00Z', overlapHours: 6 }).start.toISOString(), '2026-09-24T18:00:00.000Z');
  assert.equal(dateWindow({ now, lastSuccessAt: '2026-08-01T00:00:00Z', maxWindowDays: 7 }).start.toISOString(), '2026-09-18T12:00:00.000Z');
  const cfg = { facebook: { ...config.facebook, apiKey: 'k', groups: ['https://www.facebook.com/groups/1/'], minHoursBetweenRuns: 6 } };
  const fake = fakeBrightData([]);
  const out = await fetchListings(cfg, () => {}, { previous: { lastSuccessAt: '2026-09-25T09:00:00Z' }, now, fetchImpl: fake.fn });
  assert.ok(out.skipped);
  assert.equal(fake.calls.length, 0, 'no Bright Data request (no records billed)');
});

// Fake Bright Data HTTP API for unit tests.
function fakeBrightData(records, { runningPolls = 0, building = 0 } = {}) {
  const calls = [];
  let polls = 0;
  let builds = 0;
  const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
  const fn = async (url, init = {}) => {
    calls.push({ url, body: init.body, auth: init.headers?.Authorization });
    if (url.includes('/trigger')) return res(200, { snapshot_id: 's_fixture' });
    if (url.includes('/progress/')) return res(200, { status: polls++ < runningPolls ? 'running' : 'ready' });
    if (url.includes('/snapshot/')) return builds++ < building ? res(202, { status: 'building' }) : res(200, records);
    return res(404, {});
  };
  return { fn, calls };
}
