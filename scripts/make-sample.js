// Generates SAMPLE data for UI development into ./sample/ (git-ignored).
// Everything here is fake and labeled dataKind: 'SAMPLE'; the photos are
// SVGs that literally say "SAMPLE PHOTO". Never mixed into public/data.
//
//   node scripts/make-sample.js && DATA_DIR=sample npm start
import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeListing, field } from '../scraper/schema.js';
import { EXCLUDED } from '../scraper/sources/index.js';
import { quality } from '../scraper/index.js';

const hues = [12, 38, 145, 200, 265, 320];
const svg = (n, hue, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
<rect width="1200" height="900" fill="hsl(${hue} 30% 82%)"/><rect x="0" y="600" width="1200" height="300" fill="hsl(${hue} 22% 70%)"/>
<rect x="160" y="170" width="360" height="300" fill="hsl(${hue} 25% 94%)"/><rect x="700" y="260" width="330" height="340" fill="hsl(${hue} 20% 60%)"/>
<text x="600" y="820" font-family="Helvetica,Arial" font-size="64" font-weight="800" text-anchor="middle" fill="#222">SAMPLE PHOTO ${n}</text>
<text x="600" y="100" font-family="Helvetica,Arial" font-size="36" text-anchor="middle" fill="#333">${label}</text></svg>`;

const R = 'ROOM_IN_SHARED_APARTMENT';
const specs = [
  { src: 'junehomes', label: 'June Homes', type: R, title: 'Queen Bedroom C', hood: ['Prospect Lefferts Gardens', 'Brooklyn'], price: 1175, beds: 4, baths: 1, move: '2026-11-01', laundry: 'in_building', furnished: true, photos: 5, caption: true },
  { src: 'roomster', label: 'Roomster', type: R, title: 'Sunny private room near the L', hood: ['Bushwick', 'Brooklyn'], price: 1350, beds: 3, mates: 2, move: '2026-11-15', laundry: 'in_unit', photos: 8 },
  { src: 'roomster', label: 'Roomster', type: R, title: 'Room in 2BR with private bath', hood: [null, 'Queens'], hoodBasis: 'inferred', price: 1250, beds: 2, move: '2026-10-01', photos: 1 },
  { src: 'roomster', label: 'Roomster', type: 'ENTIRE_APARTMENT', title: '2BR apartment, whole unit', hood: ['Crown Heights', 'Brooklyn'], total: 3000, beds: 2, move: '2026-11-20', photos: 3, company: true },
  { src: 'reddit', label: 'r/RoommatesNYC', type: R, title: 'Looking for a 3rd roommate — Astoria 3BR', hood: ['Astoria', 'Queens'], price: 1400, likely: true, beds: 3, mates: 2, move: '2026-12-01', laundry: 'in_building', photos: 0 },
  { src: 'manual', label: 'Facebook (added manually)', type: 'SUBLET', title: 'Room sublet in Harlem 2BR', hood: ['Harlem', 'Manhattan'], price: 1150, beds: 2, photos: 0, sourceOnly: true },
  { src: 'junehomes', label: 'June Homes', type: R, title: 'Full Bedroom A', hood: ['Hamilton Heights', 'Manhattan'], price: 1225, beds: 3, move: '2027-01-31', furnished: true, photos: 4, caption: true },
  { src: 'roomster', label: 'Roomster', type: 'LEASE_TAKEOVER', title: 'Studio lease takeover in LIC', hood: ['Long Island City', 'Queens'], price: 1650, whole: true, beds: 0, move: '2026-10-05', photos: 6 },
  { src: 'roomster', label: 'Roomster', type: 'UNKNOWN', title: 'Great place, message me', hood: [null, null], photos: 2 },
];

await mkdir('sample/data', { recursive: true });
await mkdir('sample/photos', { recursive: true });
const listings = [];
for (const [i, s] of specs.entries()) {
  const photos = [];
  for (let k = 1; k <= s.photos; k++) {
    const name = `s${i}-${k}.svg`;
    await writeFile(`sample/photos/${name}`, svg(k, hues[(i + k) % hues.length], `${s.label} — test image`));
    photos.push({ url: `https://sample.invalid/${name}`, caption: s.caption ? (k === 1 ? 'This room' : 'Shared space in this apartment') : null });
  }
  const l = normalizeListing({
    source: s.src, sourceId: `sample-${i}`, sourceLabel: s.label, originalUrl: `https://example.com/sample-listing-${i}`,
    title: s.title, description: 'SAMPLE LISTING. This text was generated for interface testing and does not describe a real apartment.\n\nIt exists so the layout, filters and gallery can be checked without live data.',
    listingType: field(s.type, 'structured'),
    price: s.price ? { monthly: s.price, max: s.price, type: s.whole ? 'whole_unit' : 'room_share', basis: s.likely ? 'explicit' : 'structured' } : undefined,
    priceConfidence: s.likely ? 'likely' : undefined,
    totalRent: field(s.total, 'structured'),
    bedrooms: field(s.beds, 'structured'),
    bathrooms: field(s.baths, 'structured'),
    bathroomType: field(s.baths && s.beds > s.baths ? 'shared' : null, 'calculated'),
    roommates: field(s.mates, 'explicit'),
    postedBy: field(s.company ? 'company' : null, 'explicit'),
    moveIn: s.move ? field({ date: s.move, text: s.move }, 'structured') : undefined,
    neighborhood: field(s.hood[0], 'structured'),
    borough: field(s.hood[1], s.hoodBasis || 'calculated'),
    laundry: field(s.laundry, 'explicit'),
    furnished: field(s.furnished, 'structured'),
    roomType: field(s.type === R ? 'private' : null, 'structured'),
    photos,
    photoStatus: s.sourceOnly ? 'source_only' : undefined,
    postedAt: new Date(Date.now() - (i + 1) * 5 * 3600e3).toISOString(),
  }, { dataKind: 'SAMPLE' });
  // Photos are served locally by the dev server under /sample-photos/.
  l.photos = l.photos.map((p) => ({ ...p, url: p.url.replace('https://sample.invalid/', '/sample-photos/'), thumb: p.thumb.replace('https://sample.invalid/', '/sample-photos/') }));
  listings.push(l);
}
// One cross-source duplicate, to exercise the "Found on" UI.
listings[1].sources.push({ source: 'reddit', label: 'r/NYCapartments', url: 'https://example.com/sample-dup', postedAt: null });

const now = new Date().toISOString();
await writeFile('sample/data/listings.json', JSON.stringify({ generatedAt: now, dataKind: 'SAMPLE', listings }));
await writeFile('sample/data/status.json', JSON.stringify({
  generatedAt: now, dataKind: 'SAMPLE', criteria: { maxShare: 1700 },
  totals: { listings: listings.length, withPhotos: listings.filter((l) => l.photos.length).length, duplicatesMerged: 1, dropped: {}, photosChecked: 0, photosLoaded: 0 },
  sources: [
    ...['junehomes', 'roomster'].map((id) => {
      const mine = listings.filter((l) => l.source === id);
      return { id, name: mine[0].sourceLabel, status: 'LIVE', retrieved: mine.length + 3, count: mine.length + 3, inDataset: mine.length, withPhotos: mine.filter((l) => l.photos.length).length, discarded: { 'over budget': 3 }, quality: quality(mine), reason: 'SAMPLE status' };
    }),
    { id: 'reddit', name: 'Reddit', status: 'AUTH_REQUIRED', count: 0, inDataset: 1, withPhotos: 0, reason: 'SAMPLE status' },
    { id: 'diggz', name: 'Diggz', status: 'UNVERIFIED', count: 0, inDataset: 0, withPhotos: 0, reason: 'SAMPLE status' },
  ],
  excluded: EXCLUDED,
}));
console.log(`wrote ${listings.length} SAMPLE listings to sample/`);
