// Held-out evaluation of the text extractor on listings it was never tuned on.
//
// Process (keep real listing text OUT of the repository):
//   1. Freeze: pick unseen listings from a verify run's retrieved.json,
//      excluding every listing already in a labeled/tuning set. The frozen
//      file records a fingerprint of the extractor code at freeze time.
//        node scripts/holdout.js freeze <retrieved.json> <out.json> [--exclude a.json,b.json] [--n 40] [--seed 7]
//   2. Label: fill in `labels` for every item by reading the full text only
//      (what the listing STATES; null = not stated). Do not run the extractor
//      while labeling.
//   3. Score BEFORE changing any extraction rule:
//        node scripts/holdout.js score <frozen.json> [--details]
//      It reports per field: precision, recall and the unsupported-value rate,
//      and warns if the extractor changed since the freeze (then the numbers
//      are no longer a held-out measurement).
//   4. Only then tune; the next measurement needs a newly frozen set.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractText } from '../scraper/extract.js';

const EXTRACTOR_FILES = ['../scraper/extract.js', '../scraper/parse.js', '../scraper/neighborhoods.js'];
export const FIELDS = ['type', 'share', 'total', 'bedrooms', 'roommates', 'laundry', 'furnished', 'seeking', 'neighborhood'];
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

export async function extractorFingerprint() {
  const h = createHash('sha256');
  for (const f of EXTRACTOR_FILES) h.update(await readFile(new URL(f, import.meta.url)));
  return h.digest('hex').slice(0, 16);
}

// Scores extractor output against labels. "Stated" = label is a value;
// a prediction is "unsupported" when the label says the text doesn't state it.
export function score(items, { extract = extractText } = {}) {
  const stats = Object.fromEntries(FIELDS.map((f) => [f, { stated: 0, predicted: 0, correct: 0, wrong: 0, unsupported: 0, missed: 0 }]));
  const problems = [];
  for (const item of items) {
    const out = extract({ title: item.title, text: item.text });
    // Seeker posts are dropped by the pipeline; only score the seeking flag.
    for (const f of item.labels.seeking ? ['seeking'] : FIELDS) {
      let want = item.labels[f] ?? null;
      let got = pick[f](out) ?? null;
      if (f === 'seeking') { want = want || null; got = got || null; }
      const s = stats[f];
      if (want !== null) s.stated++;
      if (got !== null) s.predicted++;
      if (want === null && got === null) continue;
      if (want === got) s.correct++;
      else if (want === null) { s.unsupported++; problems.push([item.id, f, 'UNSUPPORTED', want, got]); }
      else if (got === null) { s.missed++; problems.push([item.id, f, 'missed', want, got]); }
      else { s.wrong++; problems.push([item.id, f, 'WRONG', want, got]); }
    }
  }
  const rate = (a, b) => (b ? a / b : null);
  const fields = Object.fromEntries(FIELDS.map((f) => {
    const s = stats[f];
    return [f, { ...s, precision: rate(s.correct, s.predicted), recall: rate(s.correct, s.stated), unsupportedRate: rate(s.unsupported, s.predicted) }];
  }));
  return { fields, problems };
}

function report({ fields, problems }, n, details) {
  const pct = (v) => (v == null ? '   —' : `${Math.round(v * 100)}%`.padStart(4));
  console.log(`items: ${n}\n`);
  console.log('field          stated  predicted  precision  recall  wrong  unsupported  missed');
  for (const [f, s] of Object.entries(fields)) {
    console.log(`${f.padEnd(14)} ${String(s.stated).padStart(5)}  ${String(s.predicted).padStart(9)}  ${pct(s.precision).padStart(9)}  ${pct(s.recall).padStart(6)}  ${String(s.wrong).padStart(5)}  ${String(s.unsupported).padStart(11)}  ${String(s.missed).padStart(6)}`);
  }
  const tot = Object.values(fields).reduce((a, s) => ({ p: a.p + s.predicted, c: a.c + s.correct, w: a.w + s.wrong, u: a.u + s.unsupported, st: a.st + s.stated }), { p: 0, c: 0, w: 0, u: 0, st: 0 });
  console.log(`\nall fields: precision ${pct(tot.c / tot.p)}, recall ${pct(tot.c / tot.st)}, wrong ${tot.w}, unsupported ${tot.u} (of ${tot.p} predicted values)`);
  if (details) for (const p of problems) console.log(`  ${p[0]}  ${p[1].padEnd(12)} ${p[2].padEnd(11)} want=${JSON.stringify(p[3])} got=${JSON.stringify(p[4])}`);
}

// Deterministic shuffle so a freeze can be reproduced from the same input.
function shuffled(arr, seed) {
  const a = [...arr];
  let x = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const j = (x >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
  if (cmd === 'freeze') {
    const [from, out] = args;
    const exclude = new Set();
    for (const f of (opt('exclude', '') || '').split(',').filter(Boolean)) {
      for (const it of JSON.parse(await readFile(f, 'utf8')).items) exclude.add(it.id);
    }
    const { listings, scrapedAt } = JSON.parse(await readFile(from, 'utf8'));
    // Text-bearing listings from sources where the text extractor matters.
    const pool = listings.filter((l) => !exclude.has(l.id) && (l.description || '').length >= 80 && l.source !== 'junehomes');
    const n = +opt('n', 40);
    const items = shuffled(pool, +opt('seed', 7)).slice(0, n).map((l) => ({
      id: l.id, source: l.source, category: l.listingKind || null, title: l.title, text: l.description, labels: null,
    }));
    const frozen = { frozenAt: new Date().toISOString(), scrapedAt, extractorFingerprint: await extractorFingerprint(), poolSize: pool.length, excluded: exclude.size, items };
    await writeFile(out, JSON.stringify(frozen, null, 1));
    console.log(`froze ${items.length} of ${pool.length} unseen listings (excluded ${exclude.size} already-labeled ids); extractor ${frozen.extractorFingerprint}`);
  } else if (cmd === 'score') {
    const frozen = JSON.parse(await readFile(args[0], 'utf8'));
    const unlabeled = frozen.items.filter((i) => !i.labels);
    if (unlabeled.length) { console.error(`${unlabeled.length} item(s) still unlabeled`); process.exit(1); }
    const fp = await extractorFingerprint();
    console.log(fp === frozen.extractorFingerprint
      ? `extractor unchanged since freeze (${fp}): this is a held-out measurement`
      : `WARNING: extractor changed since freeze (${frozen.extractorFingerprint} → ${fp}): NOT a held-out measurement`);
    report(score(frozen.items), frozen.items.length, args.includes('--details'));
  } else {
    console.error('usage: node scripts/holdout.js freeze <retrieved.json> <out.json> [--exclude a.json] [--n 40]\n       node scripts/holdout.js score <frozen.json> [--details]');
    process.exit(2);
  }
}
