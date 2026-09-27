// Pre-deploy safety gate for the Pages workflow. Compares the freshly built
// data with the previously published data and fails (so nothing is deployed
// and the current site stays up) when the new data looks broken:
//   - listings.json / status.json missing or unparsable
//   - not REAL data
//   - zero listings while the published site had some
//   - status.json not newer than the published one (refresh mode only)
// Logs counts only.
//
//   node scripts/publish-guard.js <previous-dir|-> <new-dir> <refresh|keep>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [prevDir, newDir, mode = 'refresh'] = process.argv.slice(2);
const read = async (dir, f) => JSON.parse(await readFile(join(dir, f), 'utf8'));
const fail = (msg) => { console.log(`publish guard FAILED: ${msg} — not deploying; the current site stays as it is`); process.exit(1); };

let next;
let nextStatus;
try { next = await read(newDir, 'listings.json'); nextStatus = await read(newDir, 'status.json'); } catch (e) { fail(`new data unreadable (${e.message})`); }
let prev = null;
let prevStatus = null;
if (prevDir && prevDir !== '-') {
  try { prev = await read(prevDir, 'listings.json'); prevStatus = await read(prevDir, 'status.json'); } catch { prev = null; }
}

if (!Array.isArray(next.listings)) fail('listings.json has no listings array');
if (next.dataKind !== 'REAL' || next.listings.some((l) => l.dataKind !== 'REAL')) fail('data is not REAL');
const n = next.listings.length;
const p = prev?.listings?.length ?? 0;
if (n === 0 && p > 0) fail(`0 listings would replace ${p} published listings`);
if (mode === 'refresh' && prevStatus?.generatedAt && !(Date.parse(nextStatus.generatedAt) > Date.parse(prevStatus.generatedAt))) fail('status.json was not refreshed');

const bySource = (doc) => {
  const o = {};
  for (const l of doc?.listings || []) o[l.source] = (o[l.source] || 0) + 1;
  return o;
};
console.log(`publish guard passed: ${p} → ${n} listings · before ${JSON.stringify(bySource(prev))} · after ${JSON.stringify(bySource(next))} · generatedAt ${prevStatus?.generatedAt || 'none'} → ${nextStatus.generatedAt}`);
for (const s of nextStatus.sources || []) {
  if (!s.enabled) continue;
  const c = s.sourceStats?.collection;
  console.log(`  ${s.name}: status ${s.status} · in dataset ${s.inDataset ?? 0} · last success ${s.lastSuccessAt || '—'}${s.lastFailureAt === nextStatus.generatedAt ? ' · FAILED this run (earlier listings kept)' : ''}${c ? ` · facebook ${c.mode} · next new collection after ${c.nextCollectionAfter} · month ${c.month}: ${c.monthRecords} records counted` : ''}`);
}
