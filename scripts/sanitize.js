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
// - removes posters' first/last names where the text explicitly introduces or
//   addresses a person (redactNames below); the rest of the text — price,
//   dates, neighborhood, "I'm 25, a nurse" — is kept
// Audit (fails the run if violated):
// - no email/phone patterns anywhere in listings.json
// - status.json contains only counts/statuses (no listing text)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w/.-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w/-])/g;
const BUSINESS_ADDRESS_SOURCES = new Set(['junehomes']);

// Personal names. Deterministic and deliberately narrow: a capitalized word is
// removed only right after an explicit name cue, never by guessing which
// capitalized words are names. Cues, from the real Facebook audit:
//   "my name is Jane (Doe)", "name's Jane", "Name: Jane"
//   "Hi/Hey/Hello/Yo…, I'm Jane" / "this is Jane" (after a greeting), and
//   "I'm Jane," / "I'm Jane!" / "I'm Jane -" / "I'm Jane and I…" anywhere
//   "DM/message/text/call/contact/email/ask for/reach out to Jane", "Mr./Ms./Dr. Jane Doe"
//   a sign-off line: "Best,\nJane"
//   third parties: "my friend/roommate/sister… Jane", "Meet Jane:", "Join Jane in…",
//   "About Jane:", "connect you with Jane"
// Once a cue identifies a name, its other occurrences in the same text are
// removed too ("Amy also has two cats").
// Over-redacting a non-name after such a cue is acceptable; listing facts
// (prices, dates, places) never follow these cues.
const NAME = String.raw`\p{Lu}[\p{Ll}'’-]+`;
const FULL_NAME = String.raw`${NAME}(?:\s+${NAME})?`;
const NOT_A_NAME = new Set(['Mr', 'Ms', 'Mrs', 'Dr', 'Me', 'Us', 'Now', 'Today', 'Info', 'Anytime', 'For', 'The', 'Our', 'My', 'Your', 'Directly', 'Here', 'Details', 'Via', 'With', 'If', 'And', 'Or', 'On', 'At', 'In', 'To', 'A', 'An', 'Not', 'So', 'Also', 'Just', 'Looking', 'Moving', 'Currently', 'Available', 'Interested', 'Excited', 'Happy', 'Female', 'Male', 'Based', 'From', 'Still', 'Very', 'Super', 'Please', 'Asap', 'ASAP']);
const NAME_CUES = [
  new RegExp(String.raw`(\b[Mm][Yy]\s+[Nn][Aa][Mm][Ee]\s+[Ii][Ss]\s+|\b[Mm]y\s+name['’]s\s+|\b[Nn]ame['’]s\s+|\b[Nn]ame:\s*)(${FULL_NAME})`, 'gu'),
  new RegExp(String.raw`(\b(?:[Hh]i|[Hh]ey|[Hh]ello|[Yy]o|[Ww]hat['’]?s\s+up)\b[^\n.?]{0,20}?\b(?:[Ii]['’]m|[Ii]\s+am|[Tt]his\s+is)\s+)(${NAME})`, 'gu'),
  new RegExp(String.raw`(\bI['’]m\s+|\bI\s+am\s+)(${NAME})(?=\s*(?:[,!]|\(|[-–—]\s|\s+and\s+I\b|\s+\d))`, 'gu'),
  new RegExp(String.raw`(\b(?:DM|dm|[Mm]essage|[Tt]ext|[Cc]all|[Cc]ontact|[Ee]mail|[Aa]sk\s+for|[Rr]each\s+out\s+to)\s+(?:(?:Mr|Ms|Mrs|Dr)\.?\s+)?)(${FULL_NAME})`, 'gu'),
  new RegExp(String.raw`(\b(?:Mr|Ms|Mrs|Dr)\.?\s+)(${FULL_NAME})`, 'gu'),
  new RegExp(String.raw`(\b[Mm]y\s+(?:friend|roommate|roomie|housemate|partner|sister|brother|cousin|boyfriend|girlfriend|husband|wife|daughter|son|colleague|coworker)\s+)(${NAME})`, 'gu'),
  new RegExp(String.raw`(\b(?:Meet|Join)\s+)(${NAME})(?=\s*(?::|!|,|\s+in\b|\s+and\b|\s+at\b))`, 'gu'),
  new RegExp(String.raw`(\bAbout\s+)(${NAME})(?=\s*:)`, 'gu'),
  new RegExp(String.raw`(\bconnect\s+(?:you\s+)?with\s+)(${NAME})`, 'gu'),
  new RegExp(String.raw`(\b(?:Best|Thanks|Thank\s+you|Cheers|Regards|Best\s+regards|Sincerely|Warmly|xo),?[ \t]*\n+[ \t]*)(${FULL_NAME})(?=[ \t]*(?:\n|$))`, 'gu'),
];

export function redactNames(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  const found = new Set();
  for (const re of NAME_CUES) {
    out = out.replace(re, (m, cue, name) => {
      const first = name.split(/\s+/)[0];
      if (NOT_A_NAME.has(first) || NOT_A_NAME.has(first[0].toUpperCase() + first.slice(1).toLowerCase())) return m;
      for (const part of name.split(/\s+/)) found.add(part);
      return `${cue}[name removed]`;
    });
  }
  for (const n of found) out = out.replace(new RegExp(String.raw`(?<![\p{L}\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\p{L}\p{N}])`, 'gu'), '[name removed]');
  return out;
}

export const redact = (s) => (typeof s === 'string' ? redactNames(s.replace(EMAIL, '[email removed]').replace(PHONE, '[phone removed]')) : s);

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
      if (k !== 'address' && redactNames(v) !== v) problems.push(`${l.id}: personal name in ${k}`);
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
  // Counts only: what was published, per source, and its data kind.
  const bySource = {};
  for (const l of clean.listings) for (const src of new Set((l.sources || []).map((x) => x.source).concat(l.source))) bySource[src] = (bySource[src] || 0) + 1;
  const withPhotos = {};
  for (const l of clean.listings) if (l.photos?.length) withPhotos[l.source] = (withPhotos[l.source] || 0) + 1;
  console.log(`published: dataKind=${clean.dataKind} listings=${clean.listings.length} · by source ${JSON.stringify(bySource)} · with photos ${JSON.stringify(withPhotos)} · all REAL=${clean.listings.every((l) => l.dataKind === 'REAL')}`);
}
