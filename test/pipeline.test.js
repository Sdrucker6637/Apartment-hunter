import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redditPostToRaw } from '../scraper/sources/reddit.js';
import { parseCraigslistRss } from '../scraper/sources/craigslist.js';
import { manualToRaw } from '../scraper/sources/manual.js';
import { mergeRun } from '../scraper/build.js';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const cfg = { maxShare: 1700, minBedrooms: 1, maxBedrooms: 3, maxAgeDays: 30 };
const ts = (iso) => Date.parse(iso) / 1000;

const redditChildren = [
  {
    id: 'a1', subreddit: 'RoommatesNYC', author: 'bkroomie', permalink: '/r/RoommatesNYC/comments/a1/x/',
    title: 'Room in 3BR Bed-Stuy - $1,350 - Oct 15', selftext: 'Living with 2 roommates. Laundry in building.',
    link_flair_text: 'Room Available', created_utc: ts('2026-09-24T10:00:00Z'), is_self: true,
  },
  {
    // same person cross-posted to another sub
    id: 'a2', subreddit: 'NYCapartments', author: 'bkroomie', permalink: '/r/NYCapartments/comments/a2/x/',
    title: 'Room in 3BR Bed-Stuy - $1,350 - Oct 15', selftext: 'Living with 2 roommates. Laundry in building.',
    link_flair_text: '', created_utc: ts('2026-09-24T09:00:00Z'), is_self: true,
  },
  {
    id: 'b1', subreddit: 'RoommatesNYC', author: 'seeker', permalink: '/r/RoommatesNYC/comments/b1/x/',
    title: '26M looking for a room in Astoria, budget $1,400', selftext: '',
    link_flair_text: 'Looking for Room', created_utc: ts('2026-09-24T08:00:00Z'), is_self: true,
  },
  {
    id: 'c1', subreddit: 'RoommatesNYC', author: 'pricey', permalink: '/r/RoommatesNYC/comments/c1/x/',
    title: 'Room in 2br West Village $2,400/mo', selftext: 'W/D in unit',
    link_flair_text: 'Room Available', created_utc: ts('2026-09-24T08:00:00Z'), is_self: true,
  },
  {
    id: 'd1', subreddit: 'NYCapartments', author: 'q', permalink: '/r/NYCapartments/comments/d1/x/',
    title: 'Is Astoria a good neighborhood?', selftext: 'Moving from Chicago, curious.',
    link_flair_text: '', created_utc: ts('2026-09-24T08:00:00Z'), is_self: true,
  },
  {
    id: 'e1', subreddit: 'RoommatesNYC', author: 'big', permalink: '/r/RoommatesNYC/comments/e1/x/',
    title: 'Room in 5BR Bushwick loft $1,100', selftext: '',
    link_flair_text: 'Room Available', created_utc: ts('2026-09-24T08:00:00Z'), is_self: true,
  },
];

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<item rdf:about="https://newyork.craigslist.org/que/roo/d/astoria-sunny-room/7771234567.html">
<title><![CDATA[&#x0024;1,250 / 2br - Sunny room, W/D in unit (Astoria)]]></title>
<link>https://newyork.craigslist.org/que/roo/d/astoria-sunny-room/7771234567.html</link>
<description><![CDATA[Available 11/1. You'll live with one other roommate.]]></description>
<dc:date>2026-09-23T18:00:00-04:00</dc:date>
</item>
</rdf:RDF>`;

test('end-to-end merge: filters seeking/over-budget/non-listings/too-big, dedupes cross-posts', () => {
  const raws = [
    ...redditChildren.map((d) => redditPostToRaw(d, d.subreddit)),
    ...parseCraigslistRss(rss, 'rooms & shares'),
    manualToRaw({
      url: 'https://www.facebook.com/groups/123/posts/456',
      text: 'Room available in 2br Greenpoint apartment!\n$1,500/month, washer dryer in unit, move in Nov 1. Message me!',
      addedAt: '2026-09-22T00:00:00Z',
    }),
  ];
  const { listings, rejected } = mergeRun({ raws, cfg, now: NOW });
  const ids = listings.map((l) => l.id).sort();
  assert.deepEqual(ids, ['craigslist:7771234567', 'manual:' + ids[1].split(':')[1], 'reddit:a1']);
  assert.deepEqual(rejected, { seeking: 1, 'over budget': 1, 'not a listing': 1, bedrooms: 1 });

  const bk = listings.find((l) => l.id === 'reddit:a1');
  assert.equal(bk.neighborhood, 'Bedford-Stuyvesant');
  assert.equal(bk.roommates, 2);
  assert.equal(bk.laundry, 'in-building');
  assert.deepEqual(bk.alsoPostedIn, ['r/NYCapartments']);
  assert.match(bk.contactUrl, /message\/compose\/\?to=bkroomie/);

  const cl = listings.find((l) => l.source === 'craigslist');
  assert.equal(cl.price, 1250);
  assert.equal(cl.bedrooms, 2);
  assert.equal(cl.neighborhood, 'Astoria');
  assert.equal(cl.roommates, 1);
  assert.equal(cl.laundry, 'in-unit');
  assert.equal(cl.moveIn.date, '2026-11-01');

  const fb = listings.find((l) => l.source === 'facebook');
  assert.equal(fb.price, 1500);
  assert.equal(fb.neighborhood, 'Greenpoint');
  assert.equal(fb.laundry, 'in-unit');
  assert.equal(fb.contactUrl, 'https://www.facebook.com/groups/123/posts/456');
});

test('manual overrides win and previous listings age out', () => {
  const raw = manualToRaw({ url: 'https://facebook.com/x', text: 'Room in LES', overrides: { price: 1600, roommates: 2 } });
  const stale = { id: 'reddit:old', postedAt: '2026-07-01T00:00:00Z', postType: 'offering', price: 1000, bedrooms: 2 };
  const { listings, rejected } = mergeRun({ previous: [stale], raws: [raw], cfg, now: NOW });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].price, 1600);
  assert.equal(listings[0].priceMax, 1600);
  assert.equal(listings[0].roommates, 2);
  assert.equal(listings[0].neighborhood, 'Lower East Side');
  assert.deepEqual(rejected, { stale: 1 });
});
