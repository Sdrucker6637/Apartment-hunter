import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListing, parseDateToken, findLaundry, classifyPost, findPrices } from '../scraper/parse.js';
import { findNeighborhood } from '../scraper/neighborhoods.js';

const REF = '2026-09-20T12:00:00Z';

test('typical r/RoommatesNYC room post', () => {
  const l = parseListing({
    title: '[Room Available] $1,450/mo - Bushwick 3BR, available Nov 1',
    body: "Hey! We're looking for a third roommate to join our 3 bed 1 bath in Bushwick near the Jefferson L. You'd be living with 2 chill roommates (27F, 29M). W/D in unit, dishwasher. Rent is $1,450 + ~$60 utilities. DM me or email jess.bk@example.com",
    flair: 'Room Available',
    postedAt: REF,
  });
  assert.equal(l.postType, 'offering');
  assert.equal(l.price, 1450);
  assert.equal(l.bedrooms, 3);
  assert.equal(l.roommates, 2);
  assert.equal(l.roommatesSource, 'stated');
  assert.equal(l.laundry, 'in-unit');
  assert.equal(l.neighborhood, 'Bushwick');
  assert.equal(l.borough, 'Brooklyn');
  assert.equal(l.moveIn.date, '2026-11-01');
  assert.deepEqual(l.contacts.emails, ['jess.bk@example.com']);
});

test('roommates estimated from bedrooms when not stated', () => {
  const l = parseListing({
    title: 'Private room in 2br Astoria apartment - $1300',
    body: 'Laundry in the building. Move-in 10/15. Looking for a roommate who is clean.',
    postedAt: REF,
  });
  assert.equal(l.price, 1300);
  assert.equal(l.bedrooms, 2);
  assert.equal(l.roommates, 1);
  assert.equal(l.roommatesSource, 'estimated');
  assert.equal(l.laundry, 'in-building');
  assert.equal(l.neighborhood, 'Astoria');
  assert.equal(l.moveIn.date, '2026-10-15');
});

test('whole-apartment lease takeover splits rent by bedrooms', () => {
  const l = parseListing({
    title: 'Lease takeover: 2BR in Crown Heights, $3,000 total',
    body: 'Taking over our lease starting December 1st. Washer/dryer in unit. No broker fee. $3,000 deposit.',
    postedAt: REF,
  });
  assert.equal(l.kind, 'apartment');
  assert.equal(l.totalRent, 3000);
  assert.equal(l.price, 1500);
  assert.equal(l.priceSource, 'split');
  assert.equal(l.roommates, 0);
  assert.equal(l.moveIn.date, '2026-12-01');
});

test('multiple rooms give a price range', () => {
  const l = parseListing({
    title: '2 rooms available in 3b2b Williamsburg',
    body: 'Room A is $1,550/mo, Room B is $1,700/mo. Living with me (28F). Laundry room in building. Available mid-October.',
    postedAt: REF,
  });
  assert.equal(l.price, 1550);
  assert.equal(l.priceMax, 1700);
  assert.equal(l.bedrooms, 3);
  assert.equal(l.bathrooms, 2);
  assert.equal(l.roommates, 1);
  assert.equal(l.laundry, 'in-building');
  assert.equal(l.moveIn.date, '2026-10-15');
});

test('seeking posts are recognized', () => {
  assert.equal(classifyPost({ title: '24F looking for a room in Brooklyn, budget $1500' }), 'seeking');
  assert.equal(classifyPost({ title: 'Anything', flair: 'Looking for Room' }), 'seeking');
  assert.equal(classifyPost({ title: 'Looking for a roommate for our 2br in Harlem' }), 'offering');
  assert.equal(classifyPost({ title: '[Seeking] room in LES or East Village ~$1400' }), 'seeking');
});

test('deposits, fees and income requirements are not treated as rent', () => {
  const amounts = findPrices('Rent $1,200. Security deposit $1,200 ... broker fee $2,500, must make $48,000').map((p) => p.amount);
  assert.deepEqual(amounts, [1200]);
});

test('"1.4k" style prices and "per person"', () => {
  const l = parseListing({ title: '3br in Ridgewood, 1.4k each', body: 'Available ASAP', postedAt: REF });
  assert.equal(l.price, 1400);
  assert.equal(l.moveIn.text, 'ASAP');
});

test('neighborhood matching prefers specific names and respects case-sensitive abbreviations', () => {
  assert.equal(findNeighborhood('Room in East Harlem').neighborhood, 'East Harlem');
  assert.equal(findNeighborhood('Room in East Williamsburg').neighborhood, 'East Williamsburg');
  assert.equal(findNeighborhood('sunny room on the LES').neighborhood, 'Lower East Side');
  assert.equal(findNeighborhood('les chats sont mignons').neighborhood, null);
  assert.equal(findNeighborhood('Bed-Stuy brownstone').neighborhood, 'Bedford-Stuyvesant');
  assert.equal(findNeighborhood('bed stuy').neighborhood, 'Bedford-Stuyvesant');
  assert.equal(findNeighborhood('somewhere in Queens').borough, 'Queens');
});

test('"one other person" counts as a stated roommate', () => {
  const l = parseListing({ title: 'Sunny room in Harlem 2BR $1,200', body: 'Living with one other person (30M, nurse).', postedAt: REF });
  assert.equal(l.roommates, 1);
  assert.equal(l.roommatesSource, 'stated');
});

test('laundry detection', () => {
  assert.equal(findLaundry('in-unit washer and dryer'), 'in-unit');
  assert.equal(findLaundry('W/D in unit'), 'in-unit');
  assert.equal(findLaundry('laundry in basement'), 'in-building');
  assert.equal(findLaundry('Building has laundry'), 'in-building');
  assert.equal(findLaundry('laundromat around the corner'), 'none');
  assert.equal(findLaundry('nice kitchen'), null);
});

test('date parsing rolls into next year', () => {
  assert.equal(parseDateToken('Jan 5', new Date('2026-11-20')).date, '2027-01-05');
  assert.equal(parseDateToken('10/1', new Date('2026-09-20')).date, '2026-10-01');
  assert.equal(parseDateToken('late November', new Date('2026-09-20')).date, '2026-11-25');
});
