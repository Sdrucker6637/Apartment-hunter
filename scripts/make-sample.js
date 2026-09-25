// Generates SAMPLE data for UI development into ./sample/ (git-ignored).
// Everything here is fake and labeled dataKind: 'SAMPLE'; the photos are
// SVGs that literally say "SAMPLE PHOTO". Never mixed into public/data.
//
//   node scripts/make-sample.js && DATA_DIR=sample npm start
import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeListing, field } from '../scraper/schema.js';
import { EXCLUDED } from '../scraper/sources/index.js';

const hues = [12, 38, 145, 200, 265, 320];
const svg = (n, hue, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
<rect width="1200" height="900" fill="hsl(${hue} 30% 82%)"/><rect x="0" y="600" width="1200" height="300" fill="hsl(${hue} 22% 70%)"/>
<rect x="160" y="170" width="360" height="300" fill="hsl(${hue} 25% 94%)"/><rect x="700" y="260" width="330" height="340" fill="hsl(${hue} 20% 60%)"/>
<text x="600" y="820" font-family="Helvetica,Arial" font-size="64" font-weight="800" text-anchor="middle" fill="#222">SAMPLE PHOTO ${n}</text>
<text x="600" y="100" font-family="Helvetica,Arial" font-size="36" text-anchor="middle" fill="#333">${label}</text></svg>`;

const specs = [
  { src: 'junehomes', label: 'June Homes', title: 'Queen Bedroom C', hood: ['Prospect Lefferts Gardens', 'Brooklyn'], price: 1175, beds: 3, mates: [2, 'inferred'], move: '2026-11-01', laundry: 'in_building', furnished: true, photos: 5 },
  { src: 'roomster', label: 'Roomster', title: 'Sunny private room near the L', hood: ['Bushwick', 'Brooklyn'], price: 1350, beds: 3, mates: [2, 'structured'], move: '2026-10-15', laundry: 'in_unit', photos: 8 },
  { src: 'roomster', label: 'Roomster', title: 'Room in 2BR with private bath', hood: [null, 'Queens'], hoodBasis: 'inferred', price: 1250, beds: 2, mates: [1, 'structured'], move: '2026-10-01', photos: 1 },
  { src: 'roomster', label: 'Roomster', title: '2BR apartment, whole unit', hood: ['Crown Heights', 'Brooklyn'], total: 3000, beds: 2, kind: 'apartment', move: '2026-11-15', photos: 3 },
  { src: 'reddit', label: 'r/RoommatesNYC', title: 'Looking for a 3rd roommate — Astoria 3BR', hood: ['Astoria', 'Queens'], price: 1400, likely: true, beds: 3, mates: [2, 'explicit'], move: '2026-12-01', laundry: 'in_building', photos: 0 },
  { src: 'manual', label: 'Facebook (added manually)', title: 'Room in Harlem 2BR', hood: ['Harlem', 'Manhattan'], price: 1150, beds: 2, mates: [1, 'inferred'], photos: 0, sourceOnly: true },
  { src: 'junehomes', label: 'June Homes', title: 'Full Bedroom A', hood: ['Hamilton Heights', 'Manhattan'], price: 1225, beds: 3, mates: [2, 'inferred'], move: '2027-01-31', furnished: true, photos: 4 },
  { src: 'roomster', label: 'Roomster', title: 'Studio for rent', hood: ['Long Island City', 'Queens'], price: 1650, whole: true, beds: 0, mates: [0, 'inferred'], move: '2026-10-05', photos: 6 },
];

await mkdir('sample/data', { recursive: true });
await mkdir('sample/photos', { recursive: true });
const listings = [];
for (const [i, s] of specs.entries()) {
  const photos = [];
  for (let k = 1; k <= s.photos; k++) {
    const name = `s${i}-${k}.svg`;
    await writeFile(`sample/photos/${name}`, svg(k, hues[(i + k) % hues.length], `${s.label} — test image`));
    photos.push({ url: `https://sample.invalid/${name}` });
  }
  const l = normalizeListing({
    source: s.src, sourceId: `sample-${i}`, sourceLabel: s.label, originalUrl: `https://example.com/sample-listing-${i}`,
    title: s.title, description: 'SAMPLE LISTING. This text was generated for interface testing and does not describe a real apartment.\n\nIt exists so the layout, filters and gallery can be checked without live data.',
    listingKind: s.kind,
    price: s.price ? { monthly: s.price, max: s.price, type: s.whole ? 'whole_unit' : 'room_share', basis: s.likely ? 'explicit' : 'structured' } : undefined,
    priceConfidence: s.likely ? 'likely' : undefined,
    totalRent: field(s.total, 'structured'),
    bedrooms: field(s.beds, 'structured'),
    roommates: s.mates ? field(s.mates[0], s.mates[1]) : undefined,
    moveIn: s.move ? field({ date: s.move, text: s.move }, 'structured') : undefined,
    neighborhood: field(s.hood[0], 'structured'),
    borough: field(s.hood[1], s.hoodBasis || 'inferred'),
    laundry: field(s.laundry, 'explicit'),
    furnished: field(s.furnished, 'structured'),
    roomType: field(s.kind === 'apartment' ? null : 'private', 'structured'),
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
    { id: 'junehomes', name: 'June Homes', status: 'LIVE', count: 2, inDataset: 2, withPhotos: 2, reason: 'SAMPLE status', coverage: { price: 100, bedrooms: 100 } },
    { id: 'roomster', name: 'Roomster', status: 'LIVE_WITH_LIMITATIONS', count: 4, inDataset: 4, withPhotos: 4, reason: 'SAMPLE status' },
    { id: 'reddit', name: 'Reddit', status: 'AUTH_REQUIRED', count: 0, inDataset: 1, withPhotos: 0, reason: 'SAMPLE status' },
  ],
  excluded: EXCLUDED,
}));
console.log(`wrote ${listings.length} SAMPLE listings to sample/`);
