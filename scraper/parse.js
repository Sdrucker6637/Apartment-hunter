// Pulls structured fields out of free-text housing posts.
// Pure functions with no Node dependencies, so the browser can reuse them.

import { findNeighborhood } from './neighborhoods.js';

const NUMBER_WORDS = {
  zero: 0, no: 0, one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};
const NUM = '(\\d{1,2}|zero|one|two|three|four|five|six)';

function toNumber(s) {
  if (s == null) return null;
  const lower = String(s).toLowerCase();
  if (lower in NUMBER_WORDS) return NUMBER_WORDS[lower];
  const n = parseInt(lower, 10);
  return Number.isFinite(n) ? n : null;
}

// ---------- price ----------

const MIN_RENT = 400;
const MAX_RENT = 15000;

// Amounts like "$1,450", "$1450/mo", "1450/month", "1.5k", "$1.4k".
const PRICE_RE = /(\$\s?)?(\d{1,2}(?:,\d{3}|\d{3})|\d{1,2}(?:\.\d{1,2})?\s?k)\b(\s*(?:\/|per|a)\s*(?:mo(?:nth)?\b|m\b|person|room|each))?/gi;

const NON_RENT_BEFORE = /(deposit|security|broker|fee|utilities|utils|util|internet|wifi|electric|application|app fee|income|salary|earn|make|credit|parking|bonus|off|discount|save|was)\W*(?:\w+\W+){0,2}$/i;
const NON_RENT_AFTER = /^\W*(deposit|security|broker|fee|in utilities|utilities|for utilities|credit score|salary|income|sq|square|ft|off\b)/i;

// Each price candidate: { amount, perPerson, total }.
export function findPrices(text) {
  const out = [];
  if (!text) return out;
  for (const m of text.matchAll(PRICE_RE)) {
    const [raw, dollar, numRaw, unit] = m;
    const idx = m.index;
    let amount;
    if (/k$/i.test(numRaw)) amount = Math.round(parseFloat(numRaw) * 1000);
    else amount = parseInt(numRaw.replace(/,/g, ''), 10);
    // Bare numbers without "$" or "/mo" are too ambiguous (years, street numbers, sq ft).
    if (!dollar && !unit && !/k$/i.test(numRaw)) continue;
    if (amount < MIN_RENT || amount > MAX_RENT) continue;
    // Context stays within the current sentence so "No broker fee. Rent $1,500" still counts.
    const before = text.slice(Math.max(0, idx - 30), idx).split(/[.!?;\n]\s/).pop();
    const after = text.slice(idx + raw.length, idx + raw.length + 25).split(/[.!?;\n]/)[0];
    if (NON_RENT_BEFORE.test(before) || NON_RENT_AFTER.test(after)) continue;
    const ctx = (before + ' ' + after).toLowerCase() + ' ' + (unit || '').toLowerCase();
    const perPerson = /per person|each|per room|\/room|pp\b|\/person|my share|your share|per roommate/.test(ctx);
    const total = /\btotal\b|whole (apt|apartment|unit)|entire (apt|apartment|unit)|for the (apt|apartment|unit)/.test(ctx);
    out.push({ amount, perPerson, total, index: idx });
  }
  return out;
}

// ---------- bedrooms / bathrooms ----------

const BED_RE = new RegExp(`\\b${NUM}\\s*-?\\s*(?:br|bd|bdr|bdrm|bdrms|bed(?:room)?s?|b\\/?r)\\b`, 'i');
const BxB_RE = /\b([1-6])\s*b\s*\/?\s*([1-4](?:\.5)?)\s*b(?:a|ath)?\b/i; // "3b2b", "2b/1b", "3b1ba"
const BATH_RE = new RegExp(`\\b(\\d(?:\\.5)?|one|two|three)\\s*-?\\s*(?:ba|bath(?:room)?s?)\\b`, 'i');

export function findBedrooms(text) {
  if (!text) return null;
  if (/\bstudio\b/i.test(text) && !BED_RE.test(text) && !BxB_RE.test(text)) return 0;
  const bxb = BxB_RE.exec(text);
  const bed = BED_RE.exec(text);
  // Prefer whichever appears first; titles usually lead with the unit size.
  const candidates = [bxb && { n: +bxb[1], i: bxb.index }, bed && { n: toNumber(bed[1]), i: bed.index }]
    .filter((c) => c && c.n != null && c.n > 0 && c.n <= 8);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.i - b.i);
  return candidates[0].n;
}

export function findBathrooms(text) {
  if (!text) return null;
  const bxb = BxB_RE.exec(text);
  if (bxb) return parseFloat(bxb[2]);
  const m = BATH_RE.exec(text);
  if (!m) return null;
  const n = toNumber(m[1]) ?? parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

// How many rooms are being offered in this post ("2 rooms available").
const ROOMS_AVAILABLE_RE = new RegExp(`\\b${NUM}\\s+(?:private\\s+|open\\s+|available\\s+|furnished\\s+)?(?:rooms|bedrooms)\\s+(?:available|open|for rent|up for grabs|opening)`, 'i');
const ROOMS_AVAILABLE_RE2 = new RegExp(`\\b(?:renting|filling|looking to fill|have)\\s+${NUM}\\s+(?:rooms|bedrooms)\\b`, 'i');

export function findRoomsAvailable(text) {
  if (!text) return null;
  const m = ROOMS_AVAILABLE_RE.exec(text) || ROOMS_AVAILABLE_RE2.exec(text);
  return m ? toNumber(m[1]) : null;
}

// ---------- roommates ----------

const WHO = '(?:roommates?|roomies?|roomates?|housemates?|flatmates?|people|persons?|guys|girls|women|men|gals|dudes|friends|tenants|others|professionals|grad students|students)';
const ROOMMATE_PATTERNS = [
  // "living with 2 other roommates", "live with two girls", "you'd be living with 1 other person"
  new RegExp(`\\bliv(?:e|ing)\\s+with\\s+${NUM}\\s+(?:other\\s+|current\\s+|existing\\s+|great\\s+|chill\\s+|friendly\\s+|awesome\\s+|lovely\\s+|cool\\s+|easygoing\\s+|easy-going\\s+)*${WHO}`, 'i'),
  // "2 current roommates", "3 other roommates", "two chill roommates"
  new RegExp(`\\b${NUM}\\s+(?:other|current|existing|great|chill|friendly|awesome|lovely|cool|easygoing|easy-going|clean|quiet|fun|female|male)\\s+(?:\\w+\\s+)?${WHO}`, 'i'),
  // "join 2 roommates", "joining two others"
  new RegExp(`\\bjoin(?:ing)?\\s+${NUM}\\s+(?:\\w+\\s+)?${WHO}`, 'i'),
  // "with 2 roommates", "with two others"
  new RegExp(`\\bwith\\s+${NUM}\\s+(?:\\w+\\s+)?${WHO}`, 'i'),
  // "2 roommates" (bare, last resort)
  new RegExp(`\\b${NUM}\\s+(?:roommates|roomies|housemates|flatmates)\\b`, 'i'),
];
const LIVE_WITH_ONE_RE = /\b(?:live|living|be)\s+with\s+(?:me|my\s+(?:partner|boyfriend|girlfriend|bf|gf)\b)|\bjust\s+(?:me|us)\b|\bI(?:'m| am)\s+(?:the\s+only|your)\s+(?:other\s+)?roommate/i;
const LIVE_WITH_COUPLE_RE = /\b(?:live|living)\s+with\s+(?:a|one)\s+couple\b|\bmy\s+(?:partner|boyfriend|girlfriend|bf|gf)\s+and\s+(?:I|me)\b/i;

// Number of people already in the unit that you would be joining.
export function findRoommates(text, { bedrooms, roomsAvailable, kind } = {}) {
  if (!text) return { roommates: null, roommatesSource: null };
  for (const re of ROOMMATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const n = toNumber(m[1]);
    if (n != null && n <= 8) return { roommates: n, roommatesSource: 'stated' };
  }
  if (LIVE_WITH_COUPLE_RE.test(text)) return { roommates: 2, roommatesSource: 'stated' };
  if (LIVE_WITH_ONE_RE.test(text)) return { roommates: 1, roommatesSource: 'stated' };
  if (kind === 'apartment') return { roommates: 0, roommatesSource: 'whole-unit' };
  if (bedrooms != null && bedrooms >= 1) {
    // One person per bedroom, minus the room(s) on offer.
    const n = bedrooms - (roomsAvailable ?? 1);
    if (n >= 0) return { roommates: n, roommatesSource: 'estimated' };
  }
  return { roommates: null, roommatesSource: null };
}

// ---------- laundry ----------

export function findLaundry(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const inUnit = /(w\/d|w\s?&\s?d|washer\s*(?:\/|&|and|-)?\s*dryer|washer-dryer|laundry)\s*(?:is\s+)?(?:in[- ]?unit|in the (?:unit|apartment|apt)|in apt|in-apartment)|in[- ]?unit\s*(?:w\/d|w\s?&\s?d|washer|laundry)|\bwdiu\b|\bw\/d\s*iu\b|washer (?:and|&) dryer in (?:the )?(?:unit|apartment|apt)/;
  const inBuilding = /(w\/d|w\s?&\s?d|washer\s*(?:\/|&|and|-)?\s*dryer|laundry)\s*(?:room\s*)?(?:is\s+)?(?:in[- ]?(?:the\s+)?(?:building|bldg)|on[- ]site|in basement|in the basement|on (?:each|every) floor)|(?:building|bldg|on[- ]site|basement)\s+(?:has\s+(?:a\s+)?)?laundry|laundry\s+room|shared laundry|common laundry/;
  const none = /no (?:w\/d|washer|laundry)|laundromat (?:nearby|next door|around the corner|down the (?:street|block))/;
  if (inUnit.test(t)) return 'in-unit';
  if (inBuilding.test(t)) return 'in-building';
  if (none.test(t)) return 'none';
  return null;
}

// ---------- move-in date ----------

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DATE_TOKEN = `(?:(?:early|mid|late|end of|beginning of|start of|the end of|the beginning of)[-\\s]+)?(?:${MONTH_NAMES})\\.?(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+20\\d\\d)?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|asap|immediately|now|right away`;
const MOVE_IN_CONTEXT = [
  new RegExp(`(?:move[- ]?in|moving in|available|avail\\.?|starting|start date|begins|beginning|lease starts?|occupancy|from|as of|open)\\s*(?:date)?\\s*(?:is|on|:|-|–|—)?\\s*(?:on\\s+|from\\s+|starting\\s+|as of\\s+|around\\s+|approx\\.?\\s+)?(${DATE_TOKEN})\\b`, 'i'),
  new RegExp(`\\b(${DATE_TOKEN})\\s+(?:move[- ]?in|start|availability|lease start)`, 'i'),
];

function pad(n) {
  return String(n).padStart(2, '0');
}

// Resolves a month/day to the next occurrence relative to `ref` (allowing ~1 month of past).
function resolveYear(month, day, ref, explicitYear) {
  if (explicitYear) return explicitYear;
  const y = ref.getUTCFullYear();
  const candidate = Date.UTC(y, month, day);
  const oneMonthAgo = ref.getTime() - 35 * 86400000;
  return candidate < oneMonthAgo ? y + 1 : y;
}

function isoDate(y, m, d) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

export function parseDateToken(token, ref = new Date()) {
  const t = token.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(asap|immediately|now|right away)$/.test(t)) {
    return { date: isoDate(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()), text: 'ASAP' };
  }
  let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    const month = +m[1] - 1;
    const day = +m[2];
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    let year = m[3] ? +m[3] : null;
    if (year && year < 100) year += 2000;
    year = resolveYear(month, day, ref, year);
    return { date: isoDate(year, month, day), text: token.trim() };
  }
  m = new RegExp(`^(early|mid|late|end of|beginning of|start of|the end of|the beginning of)?[-\\s]*(${MONTH_NAMES})\\.?(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s+(20\\d\\d))?$`).exec(t);
  if (m) {
    const month = MONTHS[m[2]];
    let day = m[3] ? +m[3] : 1;
    const qualifier = (m[1] || '').replace(/^the /, '');
    if (!m[3] && qualifier === 'mid') day = 15;
    if (!m[3] && (qualifier === 'late' || qualifier === 'end of')) day = 25;
    if (!m[3] && qualifier === 'early') day = 1;
    if (day < 1 || day > 31) return null;
    const year = resolveYear(month, day, ref, m[4] ? +m[4] : null);
    return { date: isoDate(year, month, day), text: token.trim() };
  }
  return null;
}

export function findMoveIn(text, ref = new Date()) {
  if (!text) return null;
  for (const re of MOVE_IN_CONTEXT) {
    const m = re.exec(text);
    if (!m) continue;
    const parsed = parseDateToken(m[1], ref);
    if (parsed) return parsed;
  }
  return null;
}

// ---------- offering vs. seeking ----------

const SEEKING_FLAIR = /(looking|seeking|searching|in search|wanted|need).*\b(room|apartment|apt|place|housing|sublet)|room wanted|housing wanted|^iso\b|seeking|looking for (a )?room/i;
const OFFERING_FLAIR = /(room|apartment|apt|sublet|sublease|unit|bedroom).*(available|offer|for rent)|roommate wanted|roommates? needed|offering|lease (takeover|transfer)|^(sublet|sublease)$|have (a )?room/i;
const OFFER_TEXT = /\b(room (?:is )?(?:available|for rent|open|opening)|rooms? available|looking for (?:an?\s+|\d\s+|two\s+|one\s+)?(?:new\s+|3rd\s+|third\s+|2nd\s+|second\s+|fourth\s+|4th\s+)?(?:roommates?|roomies?|roomates?|housemates?|someone to (?:take|fill|join|sublet|replace))|available (?:room|bedroom)|lease (?:takeover|transfer|assignment)|take over (?:my|our|the) lease|sublet(?:ting)? (?:my|our)|subleas(?:e|ing) (?:my|our)|join (?:us|our)|replace (?:me|our|my)|need(?:ing)? (?:a |an? )?(?:new )?(?:roommate|roomie|housemate)|room for rent|renting (?:out )?(?:a |my |our |one |the )?(?:room|bedroom)|\[(?:offering|room|have)[^\]]*\])/i;
const SEEK_TEXT = /\b(?:looking for|seeking|searching for|in search of|iso|in need of|need)\s+(?:an?\s+)?(?:room|apartment|apt|place to (?:live|stay)|housing|sublet|studio|1\s*br|1\s*bed(?:room)?|share)\b|\[(?:seeking|looking|iso)[^\]]*\]|\bi(?:'m| am) (?:a )?(?:\d\d\s*(?:m|f|yo)?\s*)?(?:looking|searching|seeking)(?! for (?:an?\s+)?(?:roommate|roomie|housemate))/i;

export function classifyPost({ title = '', body = '', flair = '' }) {
  if (flair) {
    if (OFFERING_FLAIR.test(flair) && !/looking for (a )?room/i.test(flair)) return 'offering';
    if (SEEKING_FLAIR.test(flair)) return 'seeking';
  }
  const titleOffer = OFFER_TEXT.test(title);
  const titleSeek = SEEK_TEXT.test(title);
  if (titleOffer && !titleSeek) return 'offering';
  if (titleSeek && !titleOffer) return 'seeking';
  const bodyOffer = OFFER_TEXT.test(body);
  const bodySeek = SEEK_TEXT.test(body);
  if (bodyOffer && !bodySeek) return 'offering';
  if (bodySeek && !bodyOffer) return 'seeking';
  if (bodyOffer && bodySeek) {
    // Whichever is mentioned first sets the tone of the post.
    return body.search(OFFER_TEXT) <= body.search(SEEK_TEXT) ? 'offering' : 'seeking';
  }
  return 'unknown';
}

const WHOLE_UNIT_RE = /\b(?:lease (?:takeover|transfer|assignment)|take over (?:my|our|the) lease|entire (?:apt|apartment|unit|place)|whole (?:apt|apartment|unit|place)|no[- ]fee (?:\d\s*(?:br|bed)|apartment|apt)|(?:apartment|apt|unit) for rent|sublet(?:ting)? (?:my|our|the) (?:entire |whole )?(?:apt|apartment|studio|1\s*br|one bedroom))\b/i;
const ROOM_RE = /\b(?:room|bedroom)\s+(?:in|available|for rent|for sublet|open)|\broommates?\b|\broomies?\b|\bhousemates?\b|\bprivate room\b|\bshared?\b/i;

export function listingKind(text) {
  if (WHOLE_UNIT_RE.test(text) && !/\b(?:room in|private room|roommates? (?:wanted|needed)|looking for (?:an?\s+)?roommate)/i.test(text)) return 'apartment';
  if (ROOM_RE.test(text)) return 'room';
  return 'room';
}

// ---------- contact info ----------

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(?<!\d)(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;

export function findContacts(text) {
  if (!text) return { emails: [], phones: [] };
  const emails = [...new Set((text.match(EMAIL_RE) || []).map((e) => e.replace(/[.,;:]+$/, '')))].slice(0, 3);
  const phones = [...new Set([...text.matchAll(PHONE_RE)].map((m) => `${m[1]}-${m[2]}-${m[3]}`))]
    .filter((p) => !/^(\d)\1\1-/.test(p)).slice(0, 2);
  return { emails, phones };
}

// ---------- putting it together ----------

// Picks the monthly share for the room you'd take from the price candidates.
function pickSharePrice(prices, { kind, bedrooms, roomsAvailable }) {
  if (!prices.length) return { price: null, priceMax: null, totalRent: null, priceSource: null };
  const perPerson = prices.filter((p) => p.perPerson);
  const totals = prices.filter((p) => p.total);
  const plain = prices.filter((p) => !p.perPerson && !p.total);
  if (perPerson.length) {
    const amts = perPerson.map((p) => p.amount);
    return { price: Math.min(...amts), priceMax: Math.max(...amts), totalRent: totals[0]?.amount ?? null, priceSource: 'stated' };
  }
  const total = totals[0]?.amount ?? (kind === 'apartment' ? plain[0]?.amount : null);
  if (total != null && (kind === 'apartment' || totals.length)) {
    const split = bedrooms && bedrooms > 0 ? bedrooms : null;
    if (split) {
      const share = Math.round(total / split);
      return { price: share, priceMax: share, totalRent: total, priceSource: 'split' };
    }
    if (bedrooms === 0 || bedrooms == null) {
      // Studio or unknown size: the whole rent is your share.
      return { price: total, priceMax: total, totalRent: total, priceSource: 'stated' };
    }
  }
  const amts = (plain.length ? plain : prices).map((p) => p.amount);
  // Posts listing several rooms ("Room A $1,400 / Room B $1,650") give a range.
  const useRange = (roomsAvailable ?? 1) > 1 || amts.length > 1;
  return {
    price: Math.min(...amts),
    priceMax: useRange ? Math.max(...amts) : Math.min(...amts),
    totalRent: null,
    priceSource: 'stated',
  };
}

export function parseListing({ title = '', body = '', flair = '', hints = {}, postedAt = null }) {
  const text = `${title}\n${body}`;
  const ref = postedAt ? new Date(postedAt) : new Date();
  const kind = hints.kind || listingKind(text);
  const bedrooms = hints.bedrooms ?? findBedrooms(title) ?? findBedrooms(body);
  const roomsAvailable = findRoomsAvailable(text);
  const prices = findPrices(title).concat(findPrices(body));
  // A title price is usually the headline rent; if present, don't let body prices widen the range much.
  const titlePrices = findPrices(title);
  const priceInfo = pickSharePrice(titlePrices.length ? titlePrices : prices, { kind, bedrooms, roomsAvailable });
  if (hints.price != null && priceInfo.price == null) {
    Object.assign(priceInfo, { price: hints.price, priceMax: hints.price, priceSource: 'stated' });
  }
  const { roommates, roommatesSource } = findRoommates(text, { bedrooms, roomsAvailable, kind });
  const location = findNeighborhood(hints.neighborhood, title, body);
  return {
    postType: classifyPost({ title, body, flair }),
    kind,
    ...priceInfo,
    bedrooms,
    bathrooms: findBathrooms(text),
    roomsAvailable,
    roommates,
    roommatesSource,
    laundry: findLaundry(text),
    moveIn: findMoveIn(text, ref),
    neighborhood: location.neighborhood,
    borough: location.borough,
    contacts: findContacts(body),
  };
}
