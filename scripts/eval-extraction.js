// Scores the text extractor against any hand-labeled set of real listings
// (e.g. the tuning set). For a genuinely held-out measurement use
// scripts/holdout.js (freeze → label → score before tuning).
//
//   node scripts/eval-extraction.js path/to/labeled.json [--details]
//
// Labeled files contain real listing text and must not be committed while
// the repository is public.
import { readFile } from 'node:fs/promises';
import { score } from './holdout.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/eval-extraction.js <labeled.json> [--details]');
  process.exit(2);
}
const { items } = JSON.parse(await readFile(file, 'utf8'));
const { fields, problems } = score(items);
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
console.log(`Extraction on ${items.length} labeled listings (NOT held-out if these were used for tuning)\n`);
for (const [f, s] of Object.entries(fields)) console.log(`${f.padEnd(13)} stated ${String(s.stated).padStart(3)}  precision ${pct(s.precision).padStart(4)}  recall ${pct(s.recall).padStart(4)}  wrong ${s.wrong}  unsupported ${s.unsupported}  missed ${s.missed}`);
if (process.argv.includes('--details')) for (const p of problems) console.log(`  ${p[0]}  ${p[1].padEnd(12)} ${p[2].padEnd(11)} want=${JSON.stringify(p[3])} got=${JSON.stringify(p[4])}`);
