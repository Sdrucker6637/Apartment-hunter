// Prepares scraper output for publishing, then audits it. Used by the
// scheduled workflow before anything leaves the runner; publishing is skipped
// when the audit fails.
//
//   node scripts/sanitize.js <in-dir> <out-dir>
//
// Listing text is published as posted, contact details included: posters put
// their phone numbers, emails and names in public posts so renters can reach
// them, and the site shows them (and the extracted contact lists) the same way.
// Street addresses are dropped except from sources whose addresses are
// business listings (June Homes buildings).
// Audit (fails the run if violated):
// - production output is REAL data only (never sample/fixture listings)
// - status.json contains only counts/statuses (no listing text, no emails)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BUSINESS_ADDRESS_SOURCES = new Set(['junehomes']);

export function sanitizeListing(l) {
  const out = { ...l, contactEmails: l.contactEmails || [], contactPhones: l.contactPhones || [] };
  if (!BUSINESS_ADDRESS_SOURCES.has(l.source)) out.address = null;
  return out;
}

// Returns a list of problems; empty means publishable.
export function audit(listingsDoc, statusDoc) {
  const problems = [];
  if (listingsDoc.dataKind && listingsDoc.dataKind !== 'REAL') problems.push('listings.json is not REAL data');
  if (statusDoc?.dataKind && statusDoc.dataKind !== 'REAL') problems.push('status.json is not REAL data');
  for (const l of listingsDoc.listings || []) if (l.dataKind !== 'REAL') problems.push(`${l.id}: listing is not REAL data`);
  const statusText = JSON.stringify(statusDoc);
  const texts = new Set((listingsDoc.listings || []).map((l) => l.description).filter((d) => d && d.length > 40));
  for (const t of texts) if (statusText.includes(t.slice(0, 40))) { problems.push('status.json contains listing text'); break; }
  if (statusText.match(EMAIL)) problems.push('status.json contains an email address');
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inDir, outDir] = process.argv.slice(2);
  if (!inDir || !outDir) { console.error('usage: node scripts/sanitize.js <in-dir> <out-dir>'); process.exit(2); }
  const listingsDoc = JSON.parse(await readFile(join(inDir, 'listings.json'), 'utf8'));
  const statusDoc = JSON.parse(await readFile(join(inDir, 'status.json'), 'utf8'));
  const clean = { ...listingsDoc, sanitized: true, listings: listingsDoc.listings.map(sanitizeListing) };
  const problems = audit(clean, statusDoc);
  // Counts only — never the offending text.
  console.log(`publish audit: ${clean.listings.length} listings, ${problems.length} problem(s)`);
  if (problems.length) {
    console.log(`publish audit FAILED: ${[...new Set(problems.map((p) => p.replace(/^[^:]+: /, '')))].join('; ')}`);
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'listings.json'), JSON.stringify(clean) + '\n');
  await writeFile(join(outDir, 'status.json'), JSON.stringify(statusDoc, null, 1) + '\n');
  console.log('publish audit passed');
  // Counts only: what was published, per source, and its data kind.
  const bySource = {};
  for (const l of clean.listings) for (const src of new Set((l.sources || []).map((x) => x.source).concat(l.source))) bySource[src] = (bySource[src] || 0) + 1;
  const withPhotos = {};
  for (const l of clean.listings) if (l.photos?.length) withPhotos[l.source] = (withPhotos[l.source] || 0) + 1;
  console.log(`published: dataKind=${clean.dataKind} listings=${clean.listings.length} · by source ${JSON.stringify(bySource)} · with photos ${JSON.stringify(withPhotos)} · all REAL=${clean.listings.every((l) => l.dataKind === 'REAL')}`);
}
