// Measures text-extraction accuracy against a hand-labeled set of REAL
// listings. Labels record what the listing text actually states (null = not
// stated), so "spurious" counts values we produced that the text doesn't say.
//
//   node scripts/eval-extraction.js path/to/gold.json [--details]
//
// The gold file contains real (redacted) listing text and must not be
// committed while the repository is public.
import { readFile } from 'node:fs/promises';
import { extractText } from '../scraper/extract.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/eval-extraction.js <gold.json> [--details]');
  process.exit(2);
}
const details = process.argv.includes('--details');
const { items } = JSON.parse(await readFile(file, 'utf8'));
const FIELDS = ['type', 'share', 'total', 'bedrooms', 'roommates', 'laundry', 'furnished', 'seeking', 'neighborhood'];
const pick = {
  type: (x) => x.listingType,
  share: (x) => (x.priceType === 'room_share' || x.priceType === 'whole_unit' ? x.share : null),
  total: (x) => x.total,
  bedrooms: (x) => x.bedrooms,
  roommates: (x) => x.roommates,
  laundry: (x) => x.laundry,
  furnished: (x) => x.furnished,
  seeking: (x) => x.seeking,
  neighborhood: (x) => x.neighborhood,
};

const stats = Object.fromEntries(FIELDS.map((f) => [f, { correct: 0, wrong: 0, missed: 0, spurious: 0, stated: 0 }]));
const problems = [];
for (const item of items) {
  const out = extractText({ title: item.title, text: item.text });
  // Seeker posts are dropped by the pipeline; only score the seeking flag.
  for (const f of item.labels.seeking ? ['seeking'] : FIELDS) {
    const want = item.labels[f] ?? null;
    const got = pick[f](out) ?? null;
    const s = stats[f];
    if (want !== null && want !== false) s.stated++;
    if (want === got || (want === null && got === false && f === 'seeking')) s.correct++;
    else if (want === null) { s.spurious++; problems.push([item.id, f, 'SPURIOUS', want, got]); }
    else if (got === null) { s.missed++; problems.push([item.id, f, 'missed', want, got]); }
    else { s.wrong++; problems.push([item.id, f, 'WRONG', want, got]); }
  }
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
console.log(`Extraction accuracy on ${items.length} hand-labeled real listings\n`);
console.log('field          stated  found   wrong/spurious   missed   exact-match');
for (const f of FIELDS) {
  const s = stats[f];
  const found = s.stated - s.missed - s.wrong;
  console.log(`${f.padEnd(14)} ${String(s.stated).padStart(5)}  ${pct(found, s.stated).padStart(5)}   ${String(s.wrong + s.spurious).padStart(8)}         ${String(s.missed).padStart(4)}     ${pct(s.correct, items.length).padStart(5)}`);
}
const bad = Object.values(stats).reduce((n, s) => n + s.wrong + s.spurious, 0);
console.log(`\nwrong or unsupported values (the dangerous kind): ${bad}`);
if (details) for (const p of problems) console.log(`  ${p[0]}  ${p[1].padEnd(12)} ${p[2].padEnd(8)} want=${JSON.stringify(p[3])} got=${JSON.stringify(p[4])}`);
