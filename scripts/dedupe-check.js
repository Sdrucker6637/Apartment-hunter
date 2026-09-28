// Dedupe regression against a REAL published dataset (read-only, counts only).
//
//   node scripts/dedupe-check.js <listings.json> [baseline-dedupe.mjs]
//
// 1. stability: re-running dedupe on already-published listings must not
//    merge anything the baseline dedupe (e.g. main's scraper/dedupe.js) would
//    not also merge (published data is sanitized, so re-dedupe of it can
//    differ slightly from the pre-sanitize run with ANY version)
// 2. exact cross-source copies (same photos, new source/URL/id) must all
//    merge back into their original
// 3. near-duplicate copies (reformatted title/description, no shared photo,
//    same neighborhood/price) — reported, merges expected where text overlaps
// 4. different-room copies ("Room B" vs "Room A", same everything else) must
//    never merge
// Copies exist only in memory for this check; nothing is written or published.
// The log contains counts only — never listing text, URLs or contacts.
import { readFile } from 'node:fs/promises';
import { dedupe, roomLabel } from '../scraper/dedupe.js';

const [file, baselinePath] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/dedupe-check.js <listings.json> [baseline-dedupe.mjs]'); process.exit(2); }
const baseline = baselinePath ? (await import(new URL(baselinePath, `file://${process.cwd()}/`).href)).dedupe : null;
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

console.log(`real listings with a room label in the title: ${real.filter((l) => roomLabel(l)).length}`);

// 1. stability (compared with the baseline version when given)
const again = dedupe(real);
const base = baseline ? baseline(real) : null;
console.log(`1. stability: ${real.length} → ${again.length} after re-dedupe (new merges: ${real.length - again.length})${base ? ` · baseline version: ${real.length} → ${base.length}` : ''}`);
const baseExpected = base ? base.length : real.length;

// 2. exact copies (shared photos)
const withPhotos = real.filter((l) => l.photos?.length);
const exact = withPhotos.map((l, i) => copy(l, i, {}));
const r2 = dedupe([...real, ...exact]);
const merged2 = exact.filter((c) => r2.some((g) => g.sources.some((s) => s.url === c.originalUrl) && g.sources.some((s) => s.source !== 'simsource'))).length;
console.log(`2. exact cross-source copies: ${merged2}/${exact.length} merged back into their original · output ${r2.length} (expected ${again.length})`);

// 3. near-duplicates: reformatted text, no shared photo
const near = real.map((l, i) => copy(l, 10000 + i, { title: reformat(l.title), description: reformat(l.description), photos: [] }));
const r3 = dedupe([...real, ...near]);
const merged3 = near.filter((c) => r3.some((g) => g.sources.some((s) => s.url === c.originalUrl) && g.sources.some((s) => s.source !== 'simsource'))).length;
const textless = real.filter((l) => (l.description || '').length < 80).length;
console.log(`3. near-duplicate copies (reformatted, no photo): ${merged3}/${near.length} merged · ${textless} originals have <80 chars of text (weak evidence by design)`);

// 4. different rooms in the same apartment: Room A / Room B copies of the SAME
// original must never share a group. (Copies of two different originals may
// merge when the originals themselves are reposts — that's check 1.)
const roomA = real.map((l, i) => copy(l, 20000 + i, { title: `Room A ${l.title}`, source: 'simsourcea', id: `simsourcea:${i}`, originalUrl: `https://sim.invalid/a/${i}`, sources: [{ source: 'simsourcea', label: 'SimA', url: `https://sim.invalid/a/${i}` }] }));
const roomB = real.map((l, i) => copy(l, 30000 + i, { title: `Room B ${l.title}`, originalUrl: `https://sim.invalid/b/${i}`, sources: [{ source: 'simsource', label: 'Sim', url: `https://sim.invalid/b/${i}` }] }));
const r4 = dedupe([...roomA, ...roomB]);
const wrong4 = real.filter((_, i) => r4.some((g) => g.sources.some((s) => s.url === `https://sim.invalid/a/${i}`) && g.sources.some((s) => s.url === `https://sim.invalid/b/${i}`))).length;
console.log(`4. different-room pairs (same text/photos/price, Room A vs Room B): ${wrong4} wrongly merged of ${roomA.length} pairs (expected 0)`);

const failures = [];
if (again.length < baseExpected) failures.push('stability (merges more than the baseline)');
if (merged2 !== exact.length) failures.push('exact copies');
if (wrong4) failures.push('different rooms');
console.log(failures.length ? `FAILED: ${failures.join(', ')}` : 'dedupe checks passed');
process.exit(failures.length ? 1 : 0);
