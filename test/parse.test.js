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

test('roommates are never estimated from bedrooms — "Not stated" instead', () => {
  const l = parseListing({
    title: 'Private room in 2br Astoria apartment - $1300',
    body: 'Laundry in the building. Move-in 10/15. Looking for a roommate who is clean.',
    postedAt: REF,
  });
  assert.equal(l.price, 1300);
  assert.equal(l.bedrooms, 2);
  assert.equal(l.roommates, null);
  assert.equal(l.roommatesSource, null);
  assert.equal(l.laundry, 'in-building');
  assert.equal(l.neighborhood, 'Astoria');
  assert.equal(l.moveIn.date, '2026-10-15');
});

test('stated roommate phrasings vs. non-statements', () => {
  const r = (t) => parseListing({ title: 'Room', body: t, postedAt: REF }).roommates;
  assert.equal(r("You'll share the apartment with two others."), 2);
  assert.equal(r('Me and my roommate are looking to fill the third room.'), 2);
  assert.equal(r('I live here with my family of 3.'), null);
  assert.equal(r('Looking for 2 roommates for our 4BR.'), null);
  assert.equal(r('We need two housemates to join us.'), null);
});

test('listing type only from explicit wording', () => {
  const t = (title, body = '') => parseListing({ title, body, postedAt: REF }).listingType;
  assert.equal(t('Lease takeover: 2BR in Crown Heights'), 'LEASE_TAKEOVER');
  assert.equal(t('Short-term sublease, master bedroom in LIC'), 'SUBLET');
  assert.equal(t('Bedroom in 2Br 1B apt'), 'ROOM_IN_SHARED_APARTMENT');
  assert.equal(t('2 rooms in crown heights available'), 'ROOM_IN_SHARED_APARTMENT');
  assert.equal(t('2 bedroom apartment for rent'), 'ENTIRE_APARTMENT');
  assert.equal(t('Great place near the park'), null);
});

test('price: total rent is never divided by bedrooms unless an even split is stated', () => {
  const cases = [
    // [title, body, expected price, totalRent, priceType, priceBasis]
    ['$3,000 2BR, looking for someone to take the second room', '', null, 3000, 'unknown', null],
    ['2BR $3,000 total, your room is $1,400', '', 1400, 3000, 'room_share', 'explicit'],
    ['2BR apartment $3,000 total, split evenly', '', 1500, 3000, 'room_share', 'calculated'],
    ['Looking for roommate, 2BR in LES', 'Rent is $2,900. We split it evenly.', 1450, 2900, 'room_share', 'calculated'],
    ['3BR, $4,200/mo, split three ways', '', 1400, 4200, 'room_share', 'calculated'],
    ['Room available for $1,400', '', 1400, null, 'room_share', 'explicit'],
    ['Lease takeover: 2BR in Crown Heights, $3,000 total', 'Washer/dryer in unit. $3,000 deposit.', null, 3000, 'unknown', null],
    ['Studio lease takeover $1,650', '', 1650, 1650, 'whole_unit', 'explicit'],
    ['Room in 3BR Bed-Stuy - $1,350 - Oct 15', '', 1350, null, 'room_share', 'likely'],
  ];
  for (const [title, body, price, totalRent, priceType, priceBasis] of cases) {
    const l = parseListing({ title, body, postedAt: REF });
    assert.deepEqual([l.price, l.totalRent, l.priceType, l.priceBasis], [price, totalRent, priceType, priceBasis], title);
  }
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

// Regression tests for bugs found by the real-data accuracy evaluation
// (synthetic text reproducing the real phrasing).
import { extractText } from '../scraper/extract.js';

test('prices under $1,000 are found; weekly/daily amounts are not monthly rent', () => {
  assert.equal(extractText({ title: 'New Listing', text: 'I am looking for a roommate. The monthly rent is $900 and the room is available immediately.' }).share, 900);
  assert.equal(extractText({ title: 'Room share', text: 'Room share available. $160 a week, first week $200.' }).share, null);
  assert.equal(extractText({ title: 'Sublet', text: 'Willing to sublet those days, $225 a day, 3 day minimum.' }).share, null);
});

test('rent next to a deposit line is still rent; "utilities included" does not cancel a price', () => {
  assert.equal(extractText({ title: 'Private room', text: 'Rent: $1,200/month 🔐 Security Deposit: $1,200 Utilities: Included' }).share, 1200);
  assert.equal(extractText({ title: '$900 per month, utilities included, Park Slope', text: 'Shared common spaces.' }).share, 900);
});

test('labeled fields: "Bedrooms: Studio", "Furnished: No"; furnished common areas are not a furnished room', () => {
  const x = extractText({ title: 'Apt', text: 'Nice place. Residence Bedrooms: Studio Bathrooms: 1 Furnished: No Apartment Size: 600 Square feet' });
  assert.equal(x.bedrooms, 0);
  assert.equal(x.furnished, false);
  assert.equal(extractText({ title: 'Room', text: 'Private room. Amenities of this home: Furnished Common Areas, Oven' }).furnished, null);
});

test('amenity lists give on-site laundry; "(in building)" notes give in-building', () => {
  assert.equal(extractText({ title: 'Apt', text: 'Air Conditioning, Elevator, Laundry, Dishwasher, City View' }).laundry, 'on_site');
  assert.equal(extractText({ title: 'Apt', text: 'Amenities: Laundry - Paid separately (in building), Oven' }).laundry, 'in_building');
});

test('commute references are not the listing location', () => {
  const x = extractText({ title: 'Room with great light', text: 'Location: 181st Street. 20 minutes to Columbia University and Midtown.' });
  assert.equal(x.neighborhood, null);
  assert.equal(extractText({ title: 'Apt', text: 'A sunny 1 bedroom apartment in the heart of West Village.' }).neighborhood, 'West Village');
});

test('enumerated housemates are counted; "only you and I" is one', () => {
  assert.equal(extractText({ title: 'Room', text: "you'll be living with one NB person, one guy, and two girls (including me)." }).roommates, 4);
  assert.equal(extractText({ title: 'Room', text: "I'm renting 1 bedroom in a shared apartment where only you and I will live." }).roommates, 1);
});

test('seeker posts in apartment categories are flagged', () => {
  assert.equal(extractText({ title: 'Ivey', text: 'Me and my husband are looking for a 1 bedroom apartment.' }).seeking, true);
});

// Misses found by the 2026-09-25 held-out evaluation (fixed after scoring).
test('held-out misses: laundry in home, remainder lease, possessive neighborhood', () => {
  assert.equal(extractText({ title: '1 BR', text: 'Amenities of this home: Dishwasher, Laundry in home (free), Elevator' }).laundry, 'in_unit');
  assert.equal(extractText({ title: 'Studio', text: 'Lease details: Remainder lease duration Sep 7 - Nov 7 (with option to renew directly with the building)' }).listingType, 'LEASE_TAKEOVER');
  assert.equal(findNeighborhood('on one of Astoria’s most gorgeous blocks').neighborhood, 'Astoria');
});
