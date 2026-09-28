// Cross-source dedupe (unit/room identity, formatting variants) and the
// leases-only publish filter. Fixtures are in-memory test objects only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeListing } from '../scraper/schema.js';
import { dedupe, compare, normalizeAddress, normalizeUnit, roomLabel } from '../scraper/dedupe.js';
import { leaseCategory } from '../scraper/lease.js';
import { parseListing } from '../scraper/parse.js';
import { run } from '../scraper/index.js';

const mk = (source, id, extra = {}) => normalizeListing({
  source, sourceId: id, sourceLabel: source, originalUrl: `https://${source}.test/listing/${id}`, title: 'Room', ...extra,
});

test('address normalization: "550 W 157th St" and "550 West 157th Street" are one building; units are kept separately', () => {
  assert.equal(normalizeAddress('550 W 157th St'), normalizeAddress('550 West 157th Street'));
  assert.equal(normalizeAddress('550 W. 157 St, Apt 4B'), '550 w 157 st');
  assert.equal(normalizeUnit('550 West 157th Street, Apt 4B'), '4b');
  assert.equal(normalizeUnit('550 W 157th St #4-b'), '4b');
  assert.equal(normalizeUnit('550 W 157th St'), null);
});

test('room labels come from the title only and ignore bedroom counts', () => {
  assert.equal(roomLabel({ title: 'Room A in a sunny 3BR' }), 'a');
  assert.equal(roomLabel({ title: 'Bedroom 2 available Nov 1' }), '2');
  assert.equal(roomLabel({ title: '2 bedroom apartment' }), null);
  assert.equal(roomLabel({ title: 'Room 1 block from the J' }), null);
  assert.equal(roomLabel({ title: 'Private room', roomLabel: 'C' }), 'c');
});

test('exact cross-source duplicate (same photo) → one canonical listing, every source URL kept', () => {
  const photo = { url: 'https://cdn.example.test/img/abcdef123456.jpg' };
  const a = mk('roomster', 1, { photos: [photo], price: { monthly: 1300, basis: 'structured' } });
  const b = mk('newsource', 9, { photos: [photo], price: { monthly: 1300, basis: 'structured' } });
  const out = dedupe([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceCount, 2);
  assert.deepEqual(out[0].sources.map((s) => s.url).sort(), [a.originalUrl, b.originalUrl].sort());
});

test('near-duplicate with different formatting (address spelling, punctuation) merges on address + unit', () => {
  const a = mk('roomster', 1, { address: '550 W 157th St Apt 4B', price: { monthly: 1250 }, bedrooms: { value: 3, basis: 'structured' }, title: 'Sunny room in Washington Heights', description: 'Large private room, near the C train. Available November 1st. Laundry in building.' });
  const b = mk('newsource', 2, { address: '550 West 157th Street, #4b', price: { monthly: 1250 }, bedrooms: { value: 3, basis: 'structured' }, title: 'Sunny Room — Washington Heights!', description: 'Large private room near the C train, available Nov 1. Laundry in bldg.' });
  const r = compare(a, b);
  assert.ok(r.same, 'merged');
  assert.ok(r.evidence.includes('same address and unit'));
  assert.equal(r.buildingOnly, false, 'unit-level, not building-level evidence');
  assert.equal(dedupe([a, b]).length, 1);
});

test('same address, different rooms → never merged, even with the same price and shared common-area photos', () => {
  const common = { url: 'https://cdn.example.test/img/livingroom0001.jpg' };
  const roomA = mk('newsource', 1, { title: 'Room A in 3BR', address: '550 W 157th St Apt 4B', price: { monthly: 1200 }, photos: [common] });
  const roomB = mk('roomster', 2, { title: 'Room B in 3BR', address: '550 West 157th Street Apt 4B', price: { monthly: 1200 }, photos: [common] });
  assert.equal(compare(roomA, roomB).same, false);
  assert.ok(compare(roomA, roomB).vetoes.includes('different rooms'));
  assert.equal(dedupe([roomA, roomB]).length, 2);
});

test('same building, different units → never merged', () => {
  const a = mk('roomster', 1, { address: '550 W 157th St Apt 4B', price: { monthly: 1200 }, description: 'Private room near the C train with laundry in the building' });
  const b = mk('newsource', 2, { address: '550 W 157th St Apt 6C', price: { monthly: 1200 }, description: 'Private room near the C train with laundry in the building' });
  assert.equal(compare(a, b).same, false);
  assert.equal(dedupe([a, b]).length, 2);
});

test('same address alone (building-level) with several units from one source stays separate', () => {
  const opts = { uniqueIdSources: new Set(['newsource']) };
  const post = mk('roomster', 1, { address: '550 W 157th St', price: { monthly: 1200 }, bedrooms: { value: 3, basis: 'structured' }, neighborhood: { value: 'Washington Heights', basis: 'structured' } });
  const r1 = mk('newsource', 2, { address: '550 W 157th St', price: { monthly: 1200 }, bedrooms: { value: 3, basis: 'structured' }, neighborhood: { value: 'Washington Heights', basis: 'structured' } });
  const r2 = mk('newsource', 3, { address: '550 W 157th St', price: { monthly: 1210 }, bedrooms: { value: 3, basis: 'structured' }, neighborhood: { value: 'Washington Heights', basis: 'structured' } });
  assert.equal(dedupe([post, r1, r2], opts).length, 3);
});

test('same source ID or same canonical URL → duplicate; tracking params ignored', () => {
  const a = mk('roomster', 1);
  const b = { ...mk('newsource', 5), originalUrl: 'https://www.roomster.test/listing/1?utm_source=x' };
  b.sources = [{ source: 'newsource', label: 'newsource', url: b.originalUrl }];
  assert.equal(compare({ ...a, originalUrl: 'https://roomster.test/listing/1' }, b).reason, 'same URL');
});

test('price: total rent is never divided by bedrooms', () => {
  assert.equal(parseListing({ title: '$3,000 2BR looking for roommate', body: '' }).price ?? null, null);
  assert.equal(parseListing({ title: '$3,000 total, split evenly between 2 tenants', body: '' }).price, 1500);
});

test('lease category: explicit language and structured durations; "flexible" alone decides nothing', () => {
  const cat = (extra) => leaseCategory({ title: '', description: '', listingType: { value: 'ROOM_IN_SHARED_APARTMENT', basis: 'structured' }, ...extra }).value;
  assert.equal(cat({ description: 'Individual room lease, 12-month lease, sign your own lease' }), 'LEASE');
  assert.equal(cat({ description: 'Month-to-month is fine' }), 'LEASE');
  assert.equal(cat({ leaseLength: { value: '6 months', basis: 'structured' } }), 'LEASE');
  assert.equal(cat({ description: 'Flexible move-in date' }), 'UNKNOWN');
  assert.equal(cat({ description: 'Cleaning twice a week, quiet building' }), 'UNKNOWN');
  assert.equal(cat({ description: 'Only $85/night, minimum 3 nights' }), 'SHORT_TERM');
  assert.equal(cat({ leaseLength: { value: 'Weekly', basis: 'structured' } }), 'SHORT_TERM');
  assert.equal(cat({ listingType: { value: 'SUBLET', basis: 'explicit' } }), 'SUBLET');
  assert.equal(cat({ listingType: { value: 'LEASE_TAKEOVER', basis: 'explicit' } }), 'LEASE_TAKEOVER');
});

test('leases-only source: sublets/takeovers/short stays classified but not published; other sources untouched', async () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const partial = (id, extra) => ({ source: 'leasesrc', sourceId: id, sourceLabel: 'L', originalUrl: `https://l.test/${id}`, title: 'Room', postedAt: '2026-09-27T00:00:00Z', ...extra });
  const src = {
    id: 'leasesrc', name: 'Leases', leasesOnly: true, enabledByDefault: true,
    run: async () => [
      partial(1, { description: '12-month lease, room in 3BR' }),
      partial(2, { listingType: { value: 'SUBLET', basis: 'explicit' } }),
      partial(3, { listingType: { value: 'LEASE_TAKEOVER', basis: 'explicit' } }),
      partial(4, { description: '$90/night' }),
      partial(5, { description: 'Nice room' }),
    ],
  };
  const other = { id: 'othersrc', name: 'Other', enabledByDefault: true, run: async () => [{ ...partial(6, { listingType: { value: 'SUBLET', basis: 'explicit' } }), source: 'othersrc' }] };
  const { listings, status } = await run({ dryRun: true, log: () => {}, now, sources: [src, other], previousListings: [] });
  assert.deepEqual(listings.filter((l) => l.source === 'leasesrc').map((l) => l.sourceId).sort(), ['1', '5']);
  assert.equal(listings.find((l) => l.sourceId === '5').leaseCategory.value, 'UNKNOWN', 'ambiguous kept as UNKNOWN');
  assert.equal(listings.filter((l) => l.source === 'othersrc').length, 1, 'non-leases-only sources keep sublets');
  const st = status.sources.find((s) => s.id === 'leasesrc');
  assert.equal(Object.values(st.discarded).reduce((a, b) => a + b, 0), 3);
});
