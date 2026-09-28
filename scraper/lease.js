// Lease category: is this an ordinary residential lease, or something else?
// Separate from listingType (ROOM_IN_SHARED_APARTMENT / ENTIRE_APARTMENT /
// SUBLET / LEASE_TAKEOVER / UNKNOWN), which stays as the source/parser said.
//
//   LEASE          ordinary residential lease: room lease, individual-room
//                  lease, whole-apartment lease, month-to-month, 3/6/12-month
//                  or longer — stated by a structured field or explicit text
//   SUBLET         listingType SUBLET
//   LEASE_TAKEOVER listingType LEASE_TAKEOVER
//   SHORT_TERM     nightly/weekly rentals, vacation rentals, hotel-like stays
//   UNKNOWN        nothing explicit either way — kept, never guessed
//
// "Flexible" alone decides nothing: it's common on ordinary leases too.
// Sources whose adapter meta sets `leasesOnly: true` publish LEASE and UNKNOWN
// only (see scraper/index.js); everyone else is unaffected.

const SHORT_TERM = /\$\s?\d[\d,]*(?:\.\d\d)?\s*(?:\/|per|a)\s*(?:night|nite|week|wk)\b|\bnightly\s+(?:rate|price|rental|stay)\b|\bweekly\s+(?:rate|rental|stay|price)\b|\bvacation\s+rental\b|\bholiday\s+(?:let|rental)\b|\bhotel[- ]style\b|\bmin(?:imum)?\.?\s+(?:stay\s+(?:of\s+)?)?\d+\s+nights?\b/i;
const LEASE_TEXT = /\b(?:\d{1,2}|six|twelve|three|nine)[- ](?:month|mo)s?\s+lease\b|\b(?:1|one)[- ]year\s+lease\b|\byear(?:ly|-long)?\s+lease\b|\bmonth[- ]to[- ]month\b|\bannual\s+lease\b|\blong[- ]term\s+(?:lease|rental)\b|\b(?:sign|on)\s+(?:the|your\s+own|a|their\s+own)\s+(?:own\s+)?lease\b|\bindividual\s+(?:room\s+)?lease\b|\bnew\s+lease\b|\blease\s+(?:term|length|duration)\s*[:\-]?\s*(?:\d{1,2}|twelve|six)\s*(?:months?|mos?)\b/i;
// Structured lease-duration values that mean an ordinary lease.
const LEASE_FIELD = /\b(?:[3-9]|1[0-9]|2[0-4])\s*(?:months?|mos?)\b|\b(?:1|one|2|two)\s*years?\b|\byearly\b|\bannual\b|\bmonth[- ]to[- ]month\b|\blong[- ]term\b/i;
const SHORT_FIELD = /\b(?:nightly|weekly|[1-3]\s*weeks?|\d+\s*nights?|days?)\b/i;

export const LEASE_CATEGORIES = ['LEASE', 'SUBLET', 'LEASE_TAKEOVER', 'SHORT_TERM', 'UNKNOWN'];

export function leaseCategory(l) {
  const type = l.listingType?.value;
  if (type === 'SUBLET') return { value: 'SUBLET', basis: l.listingType.basis };
  if (type === 'LEASE_TAKEOVER') return { value: 'LEASE_TAKEOVER', basis: l.listingType.basis };
  const len = typeof l.leaseLength?.value === 'string' ? l.leaseLength.value : '';
  if (len && SHORT_FIELD.test(len) && !LEASE_FIELD.test(len)) return { value: 'SHORT_TERM', basis: l.leaseLength.basis };
  const text = `${l.title || ''}\n${l.description || ''}`;
  if (SHORT_TERM.test(text)) return { value: 'SHORT_TERM', basis: 'explicit' };
  if (len && LEASE_FIELD.test(len)) return { value: 'LEASE', basis: l.leaseLength.basis };
  if (LEASE_TEXT.test(text)) return { value: 'LEASE', basis: 'explicit' };
  return { value: 'UNKNOWN', basis: null };
}

// What a leases-only source may publish.
export const isOrdinaryLeaseOrUnknown = (cat) => cat === 'LEASE' || cat === 'UNKNOWN';
