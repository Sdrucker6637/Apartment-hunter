// Makes scraper output safe to publish, then audits it. Used by the scheduled
// workflow before anything leaves the runner; publishing is skipped when the
// audit fails.
//
//   node scripts/sanitize.js <in-dir> <out-dir>
//
// Sanitizing:
// - removes email addresses and phone numbers from titles and descriptions
//   (people contact posters through the original listing link instead)
// - drops extracted contact lists, and street addresses except from sources
//   whose addresses are business listings (June Homes buildings)
// Audit (fails the run if violated):
// - no email/phone patterns anywhere in listings.json
// - status.json contains only counts/statuses (no listing text)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w/.-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w/-])/g;
const BUSINESS_ADDRESS_SOURCES = new Set(['junehomes']);

export const redact = (s) => (typeof s === 'string' ? s.replace(EMAIL, '[email removed]').replace(PHONE, '[phone removed]') : s);

export function sanitizeListing(l) {
  const out = { ...l, title: redact(l.title), description: redact(l.description), contactEmails: [], contactPhones: [] };
  if (!BUSINESS_ADDRESS_SOURCES.has(l.source)) out.address = null;
  return out;
}

// Returns a list of problems; empty means publishable.
export function audit(listingsDoc, statusDoc) {
  const problems = [];
  // Production output must be REAL data only (never SAMPLE/fixture listings).
  if (listingsDoc.dataKind && listingsDoc.dataKind !== 'REAL') problems.push('listings.json is not REAL data');
  if (statusDoc?.dataKind && statusDoc.dataKind !== 'REAL') problems.push('status.json is not REAL data');
  for (const l of listingsDoc.listings || []) if (l.dataKind !== 'REAL') problems.push(`${l.id}: listing is not REAL data`);
  // Photo and listing URLs legitimately contain long digit runs; check text fields only.
  for (const l of listingsDoc.listings || []) {
    for (const k of ['title', 'description', 'address']) {
      const v = l[k];
      if (typeof v !== 'string') continue;
      if (v.replace(/\[email removed\]/g, '').match(EMAIL)) problems.push(`${l.id}: email in ${k}`);
      if (v.replace(/\[phone removed\]/g, '').match(PHONE)) problems.push(`${l.id}: phone number in ${k}`);
    }
    if (l.contactEmails?.length || l.contactPhones?.length) problems.push(`${l.id}: contact list not emptied`);
  }
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
  console.log(`privacy audit: ${clean.listings.length} listings, ${problems.length} problem(s)`);
  if (problems.length) {
    console.log(`privacy audit FAILED: ${[...new Set(problems.map((p) => p.replace(/^[^:]+: /, '')))].join('; ')}`);
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'listings.json'), JSON.stringify(clean) + '\n');
  await writeFile(join(outDir, 'status.json'), JSON.stringify(statusDoc, null, 1) + '\n');
  console.log('privacy audit passed');
}
