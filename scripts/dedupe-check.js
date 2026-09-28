// Dedupe regression against a REAL published dataset (read-only, counts only).
//
//   node scripts/dedupe-check.js <listings.json>
//
// 1. stability: re-running dedupe on already-published listings must not
//    merge anything new (no over-merging introduced by rule changes)
// 2. exact cross-source copies (same photos, new source/URL/id) must all
//    merge back into their original
// 3. near-duplicate copies (reformatted title/description, no shared photo,
//    same neighborhood/price) — reported, merges expected where text overlaps
// 4. different-room copies ("Room B" vs "Room A", same everything else) must
//    never merge
// Copies exist only in memory for this check; nothing is written or published.
// The log contains counts only — never listing text, URLs or contacts.
import { readFile } from 'node:fs/promises';
import { dedupe } from '../scraper/dedupe.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/dedupe-check.js <listings.json>'); process.exit(2); }
const data = JSON.parse(await readFile(file, 'utf8'));
const real = (data.listings || []).filter((l) => l.dataKind === 'REAL');
if (!real.length) { console.log('no REAL listings to check'); process.exit(1); }

const copy = (l, n, over) => ({
  ...l,
  id: `simsource:${n}`, source: 'simsource', sourceId: String(n), originalUrl: `https://sim.invalid/listing/${n}`,
  sources: [{ source: 'simsource', label: 'Sim', url: `https://sim.invalid/listing/${n}` }],
  ...over,
});
const reformat = (s) => (s || '').replace(/\s+/g, '  ').replace(/[!.,]/g, (c) => ({ '!': '.', '.': ' .', ',': ' ,' })[c]).toUpperCase();

const bySource = {};
for (const l of real) bySource[l.source] = (bySource[l.source] || 0) + 1;
console.log(`real published listings: ${real.length} (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')})`);

// 1. stability
const again = dedupe(real);
console.log(`1. stability: ${real.length} → ${again.length} after re-dedupe (new merges: ${real.length - again.length})`);

// 2. exact copies (shared photos)
const withPhotos = real.filter((l) => l.photos?.length);
const exact = withPhotos.map((l, i) => copy(l, i, {}));
const r2 = dedupe([...real, ...exact]);
const merged2 = exact.filter((c) => r2.some((g) => g.sources.some((s) => s.url === c.originalUrl) && g.sources.some((s) => s.source !== 'simsource'))).length;
console.log(`2. exact cross-source copies: ${merged2}/${exact.length} merged back into their original · output ${r2.length} (expected ${real.length})`);

// 3. near-duplicates: reformatted text, no shared photo
const near = real.map((l, i) => copy(l, 10000 + i, { title: reformat(l.title), description: reformat(l.description), photos: [] }));
const r3 = dedupe([...real, ...near]);
const merged3 = near.filter((c) => r3.some((g) => g.sources.some((s) => s.url === c.originalUrl) && g.sources.some((s) => s.source !== 'simsource'))).length;
const textless = real.filter((l) => (l.description || '').length < 80).length;
console.log(`3. near-duplicate copies (reformatted, no photo): ${merged3}/${near.length} merged · ${textless} originals have <80 chars of text (weak evidence by design)`);

// 4. different rooms in the same apartment
const roomA = real.map((l, i) => copy(l, 20000 + i, { title: `Room A ${l.title}`, source: 'simsourcea', id: `simsourcea:${i}` }));
const roomB = real.map((l, i) => copy(l, 30000 + i, { title: `Room B ${l.title}`, originalUrl: `https://sim.invalid/b/${i}`, sources: [{ source: 'simsource', label: 'Sim', url: `https://sim.invalid/b/${i}` }] }));
const r4 = dedupe([...roomA, ...roomB]);
console.log(`4. different-room pairs (same text/photos/price, Room A vs Room B): ${roomA.length + roomB.length - r4.length} wrongly merged of ${roomA.length} pairs (expected 0)`);

const failures = [];
if (again.length !== real.length) failures.push('stability');
if (merged2 !== exact.length) failures.push('exact copies');
if (r4.length !== roomA.length + roomB.length) failures.push('different rooms');
console.log(failures.length ? `FAILED: ${failures.join(', ')}` : 'dedupe checks passed');
process.exit(failures.length ? 1 : 0);
