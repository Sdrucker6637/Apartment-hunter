// Adapter tests use SAMPLE fixtures whose *shape* mirrors the live JSON-LD
// returned during the 2026-09-25 probes (personal text replaced). Passing
// these proves parsing logic only — live retrieval is verified separately
// by the scrape workflow's verify mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as june from '../scraper/sources/junehomes.js';
import * as roomster from '../scraper/sources/roomster.js';
import { postToListing, redditPhotos } from '../scraper/sources/reddit.js';
import { parseItem } from '../scraper/sources/jsonld-sites.js';
import { normalizeListing } from '../scraper/schema.js';
import { dedupe, compare, photoKey } from '../scraper/dedupe.js';

const juneLd = {
  '@type': 'Apartment',
  name: 'Full Bedroom B',
  description: "This 67-square-foot room on New York City's Flatbush is a charming room in a 3-bedroom apartment.",
  url: 'https://junehomes.com/residences/new-york-city-ny/flatbush/873-prospect-lefferts-gardens/2438',
  image: 'https://storage.googleapis.com/junehomes/media/cache/79/9d/799d23f814da5c988af7b20ed7a59297.webp',
  geo: { latitude: 40.6439, longitude: -73.95642 },
  address: { streetAddress: '1 Sample Street' },
  offers: { price: '1075', priceCurrency: 'USD' },
};

test('June Homes: index JSON-LD → structured price and type, explicit bedrooms, NO roommate count', () => {
  const l = june.parseIndexItem(juneLd);
  assert.equal(l.sourceId, '2438');
  assert.deepEqual(l.price, { monthly: 1075, max: 1075, type: 'room_share', basis: 'structured' });
  assert.deepEqual(l.bedrooms, { value: 3, basis: 'explicit' });
  assert.equal(l.roommates, undefined, 'a 3-bedroom apartment does not state how many people live there');
  assert.deepEqual(l.listingType, { value: 'ROOM_IN_SHARED_APARTMENT', basis: 'structured' });
  assert.equal(l.neighborhood.value, 'Flatbush');
  assert.equal(l.borough.value, 'Brooklyn');
  assert.equal(l.photos.length, 1);
});

test('June Homes: detail page → this room\'s photo + shared-space photos only; amenities and bedrooms', () => {
  const l = june.parseIndexItem(juneLd);
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Apartment', amenityFeature: [{ name: 'Furnished' }, { name: 'Washer/Dryer in unit' }], petsAllowed: false, accommodationFloorPlan: { layoutImage: 'https://storage.googleapis.com/junehomes/media/residencepicture/30604/ffffffffffffffff.jpg' } })}</script>
    <div>Overview Apartment ID 873 Bedrooms 3 Bath 1 Floor 4th</div>
    <img src="https://storage.googleapis.com/junehomes/media/roompicture/16824/aaaaaaaaaaaaaaaa.jpg">
    <img src="https://storage.googleapis.com/junehomes/media/residencepicture/30604/bbbbbbbbbbbbbbbb.jpg">
    <img src="https://storage.googleapis.com/junehomes/media/residencepicture/30604/ffffffffffffffff.jpg">`;
  const d = june.parseDetail(l, html);
  assert.deepEqual(d.bedrooms, { value: 3, basis: 'structured' });
  assert.equal(d.roommates, undefined);
  assert.deepEqual(d.bathroomType, { value: 'shared', basis: 'calculated' }, '1 bath for 3 bedrooms is necessarily shared');
  assert.deepEqual(d.furnished, { value: true, basis: 'structured' });
  assert.equal(d.laundry.value, 'in_unit');
  assert.equal(d.pets.value, 'No pets');
  assert.deepEqual(d.photos.map((p) => p.caption), ['This room', 'Shared space in this apartment']);
  assert.equal(d.photos[0].url, juneLd.image);
  assert.ok(!d.photos.some((p) => p.url.includes('/roompicture/')), 'other bedrooms\' photos are not attributed to this room');
  assert.ok(!d.photos.some((p) => p.url.includes('ffffffff')), 'floor plan excluded from photos');
});

test('June Homes: move-in date comes from the index card for the matching bedroom ID', () => {
  const html = '<div>Bedroom Available from 11/30/2026 <span># 873-B</span> Flatbush From $1,075 /mo</div><div>Available from 01/15/2027 # 873-C</div>';
  const avail = june.availabilityByBedroom(html);
  assert.equal(june.bedroomId(juneLd), '873-B');
  assert.deepEqual(avail.get('873-B'), { date: '2026-11-30', text: '11/30/2026' });
  assert.equal(avail.get('873-C').date, '2027-01-15');
});

test('Roomster: "Demand" items (people seeking rooms) are skipped; offered rooms parsed', () => {
  const demand = { item: { '@type': 'Demand', url: 'https://roomster.com/listings/1', priceSpecification: { price: 1500 } } };
  assert.equal(roomster.parseIndexItem(demand, 'room'), null);
  const room = {
    item: {
      '@type': 'Room', name: 'Sunny room in Bushwick', url: 'https://roomster.com//listings/31875207',
      description: 'Private room in a 3BR apartment near the L.', image: 'https://cdn-static.roomster.com/pics/Original/U-1-abcdef0123456789.jpg',
      offers: { price: 1400, availabilityStarts: '2026-10-15' },
    },
  };
  const l = roomster.parseIndexItem(room, 'room');
  assert.equal(l.originalUrl, 'https://roomster.com/listings/31875207');
  assert.deepEqual(l.price, { monthly: 1400, max: 1400, type: 'room_share', basis: 'structured' });
  assert.equal(l.moveIn.value.date, '2026-10-15');
  assert.equal(l.neighborhood.value, 'Bushwick');
  assert.match(l.photos[0].thumb, /width=640/);
});

test('Roomster: whole-apartment price is total rent, never presented as your share', () => {
  const apt = { item: { '@type': 'Apartment', name: '2BR apartment', url: 'https://roomster.com/listings/5', offers: { price: 3000 } } };
  const l = roomster.parseIndexItem(apt, 'apartment');
  assert.equal(l.price.monthly, null);
  assert.equal(l.totalRent.value, 3000);
});

test('Roomster: whole studio/1BR price becomes your share; coordinates give an estimated borough', () => {
  const apt = { item: { '@type': 'Apartment', name: 'Studio for rent', url: 'https://roomster.com/listings/9', description: 'Cozy studio apartment', offers: { price: 1650 } } };
  const l = roomster.parseIndexItem(apt, 'apartment');
  const html = '<script type="application/ld+json">{"@type":"Thing","geo":{"latitude":40.764,"longitude":-73.923}}</script><div>Bedrooms 0 Bathrooms 1</div>';
  const d = roomster.parseDetail(l, html);
  assert.deepEqual(d.price, { monthly: 1650, max: 1650, type: 'whole_unit', basis: 'structured' });
  assert.deepEqual(d.borough, { value: 'Queens', basis: 'inferred' });
});

test('Reddit: seeking posts dropped; gallery photos extracted; price basis kept', () => {
  const base = { id: 'x1', subreddit: 'RoommatesNYC', author: 'someone', permalink: '/r/RoommatesNYC/comments/x1/t/', created_utc: 1790000000 };
  assert.equal(postToListing({ ...base, title: '25F looking for a room in Astoria', selftext: '', link_flair_text: 'Looking for Room' }), null);
  const post = {
    ...base,
    title: 'Room in 3BR Bed-Stuy, your room is $1,350',
    selftext: 'Living with 2 roommates. Laundry in building. Available Nov 1.',
    link_flair_text: 'Room Available',
    gallery_data: { items: [{ media_id: 'a' }, { media_id: 'b' }] },
    media_metadata: {
      a: { status: 'valid', s: { u: 'https://preview.redd.it/a.jpg?width=1080&amp;s=1' }, p: [{ x: 640, u: 'https://preview.redd.it/a.jpg?width=640&amp;s=2' }] },
      b: { status: 'valid', s: { u: 'https://preview.redd.it/b.jpg?width=1080&amp;s=3' }, p: [] },
    },
  };
  const l = postToListing(post);
  assert.equal(l.price.monthly, 1350);
  assert.equal(l.price.basis, 'explicit');
  assert.deepEqual(l.roommates, { value: 2, basis: 'explicit' });
  assert.equal(l.photos.length, 2);
  assert.equal(l.photos[0].url, 'https://preview.redd.it/a.jpg?width=1080&s=1');
  assert.equal(l.photos[0].thumb, 'https://preview.redd.it/a.jpg?width=640&s=2');
  assert.deepEqual(redditPhotos({ url: 'https://example.com/not-an-image' }), []);
});

test('Diggz/Roomies JSON-LD: NJ listings skipped, bogus 1965 availability ignored', () => {
  const nj = { item: { '@type': 'Product', name: 'Room for Rent in Jersey City', url: 'https://www.diggz.co/users/us_1', offers: { price: '850' }, areaServed: { name: 'Jersey City', address: { addressRegion: 'NJ' } } } };
  assert.equal(parseItem('diggz', nj), null);
  const r = { item: { '@type': 'RealEstateListing', name: 'Furnished room in an apartment | Brooklyn, New York 11208 | Clean and quiet', url: 'https://www.roomies.com/rooms/839923', image: 'https://cloudinary.roomies.pics/x.jpg', datePosted: '2026-09-01T00:00:00+00:00', offers: { price: 1350, availabilityStarts: '1965-11-01T00:00:00+00:00' }, about: { numberOfBedrooms: 2, numberOfBathroomsTotal: 1, petsAllowed: false, latitude: 40.67, longitude: -73.88 } } };
  const l = parseItem('roomies', r);
  assert.equal(l.price.monthly, 1350);
  assert.deepEqual(l.bedrooms, { value: 2, basis: 'structured' });
  assert.equal(l.moveIn.value, null);
  assert.equal(l.borough.value, 'Brooklyn');
});

test('normalizeListing fills every field with value/basis and sets photo status', () => {
  const n = normalizeListing({ source: 'x', sourceId: 1, sourceLabel: 'X', originalUrl: 'https://x.test/1', title: ' T ', photos: [{ url: 'http://insecure/a.jpg' }] });
  assert.equal(n.id, 'x:1');
  assert.equal(n.dataKind, 'REAL');
  assert.deepEqual(n.bedrooms, { value: null, basis: null });
  assert.equal(n.price.status, 'not_listed');
  assert.equal(n.listingType.value, 'UNKNOWN');
  assert.equal(n.photos.length, 0, 'non-https photos are dropped');
  assert.equal(n.photoStatus, 'none');
});

test('dedupe: shared photo merges across sources and combines photos; unrelated stay apart', () => {
  const mk = (source, id, extra) => normalizeListing({ source, sourceId: id, sourceLabel: source, originalUrl: `https://${source}.test/${id}`, title: 'Room', ...extra });
  const a = mk('reddit', 1, { title: 'Sunny room Bed-Stuy', photos: [{ url: 'https://i.redd.it/abcdefgh1234.jpg' }], price: { monthly: 1400 } });
  const b = mk('roomster', 2, { title: 'Room available', photos: [{ url: 'https://cdn.test/pics/abcdefgh1234.large.jpg' }, { url: 'https://cdn.test/pics/zzzzzzzz9999.jpg' }] });
  const c = mk('junehomes', 3, { title: 'Totally different', price: { monthly: 1100 } });
  assert.equal(photoKey('https://cdn.test/pics/abcdefgh1234.large.jpg'), 'abcdefgh1234');
  assert.equal(compare(a, b).reason, 'shared photo');
  const out = dedupe([a, b, c]);
  assert.equal(out.length, 2);
  const merged = out.find((l) => l.sources.length === 2);
  assert.deepEqual(merged.sources.map((s) => s.source).sort(), ['reddit', 'roomster']);
  assert.equal(merged.photos.length, 2);
});

test('dedupe within one source: reposts merge, templated June Homes rooms never do', () => {
  const text = 'Spacious private room with a big window near the J train, all utilities included, message me for a viewing';
  const mk = (source, id, price, description = text) => normalizeListing({ source, sourceId: id, sourceLabel: source, originalUrl: `https://${source}.test/${id}`, title: 'Room', description, price: { monthly: price } });
  assert.equal(dedupe([mk('roomster', 1, 1200), mk('roomster', 2, 1200)]).length, 1, 'identical repost at same price merges');
  assert.equal(dedupe([mk('roomster', 1, 1200), mk('roomster', 2, 1300)]).length, 2, 'same text, different price stays separate');
  const tmpl = (n) => `This ${n}-square-foot room on New York City's Flatbush is a charming room in a 4-bedroom apartment.`;
  assert.equal(dedupe([mk('junehomes', 1, 1100, tmpl(67)), mk('junehomes', 2, 1100, tmpl(67))], { uniqueIdSources: new Set(['junehomes']) }).length, 2, 'sources declaring uniqueIds never merge their own IDs');
});

test('dedupe: near-identical text + same price + same neighborhood merges; photos not combined on weak match', () => {
  const text = 'Private room in a 3 bedroom apartment in Bushwick near the Jefferson L train, living with two friendly roommates, laundry in building, available November first';
  const mk = (source, id, photo) => normalizeListing({
    source, sourceId: id, sourceLabel: source, originalUrl: `https://${source}.test/${id}`, title: 'Room', description: text,
    price: { monthly: 1450 }, neighborhood: { value: 'Bushwick', basis: 'explicit' }, photos: [{ url: `https://img.test/${photo}.jpg` }],
  });
  const out = dedupe([mk('reddit', 1, 'photoaaaaaaaa'), mk('manual', 2, 'photobbbbbbbb')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sources.length, 2);
  assert.equal(out[0].photos.length, 1, 'text-only match does not merge photos');
});

// Regression tests from the 2026-09-25 live-data audit (page shape real, text anonymized).
const roomsterDetail = (loc, desc, extra = '') => `<div>2 hours ago Show all photos Title Price/month $ 1100 USD Listing Type Room for rent Available Date Sep 25, 2026 ID Checked Email Validated Phone Validated ${loc}, USA Description ${desc} Additional information Residence Building Type: Apartment Furnished: No ${extra}</div>`;

test('Roomster detail: location line, clean description, no invented roommates or bedrooms', () => {
  const base = roomster.parseIndexItem({ item: { '@type': 'Room', name: 'peaceful and safe bedroom for rent', url: 'https://roomster.com/listings/1', offers: { price: 1100 } } }, 'room');
  const d = roomster.parseDetail(base, roomsterDetail('Astoria, Queens, NY', 'Room for rent in Woodside, Queens. I live here with my family of 3. Laundry in the building.'));
  assert.equal(d.description.startsWith('Room for rent in Woodside'), true, 'page chrome not included');
  assert.equal(d.neighborhood.value, 'Astoria');
  assert.deepEqual(d.borough, { value: 'Queens', basis: 'inferred' });
  assert.deepEqual(d.furnished, { value: false, basis: 'structured' });
  assert.equal(d.bedrooms?.value ?? null, null, '"bedroom for rent" is not a 1BR apartment');
  assert.equal(d.locationLine, 'Astoria, Queens, NY');
  assert.notEqual(d.roommates?.basis, 'structured', 'roommates never labeled as structured without a real field');
  assert.equal(d.laundry.value, 'in_building');
  assert.ok(!d.outOfArea);
});

test('Roomster detail: suburban NJ is out of area; Jersey City is kept', () => {
  const base = roomster.parseIndexItem({ item: { '@type': 'Apartment', name: 'Apartment', url: 'https://roomster.com/listings/2', offers: { price: 1950 } } }, 'apartment');
  assert.equal(roomster.parseDetail(base, roomsterDetail('Larch Street, Carteret, NJ', '2 bedroom apartment for rent.')).outOfArea, true);
  const jc = roomster.parseDetail(base, roomsterDetail('Grove Street, Jersey City, NJ', '2 bedroom apartment for rent.'));
  assert.ok(!jc.outOfArea);
  assert.equal(jc.borough.value, 'New Jersey');
});

test('Roomster: implausible monthly amounts (e.g. $175 nightly) become unknown', () => {
  const l = roomster.parseIndexItem({ item: { '@type': 'Apartment', name: 'Apt', url: 'https://roomster.com/listings/3', offers: { price: 175 } } }, 'apartment');
  assert.equal(l.totalRent.value, null);
  assert.equal(l.price, undefined);
});
