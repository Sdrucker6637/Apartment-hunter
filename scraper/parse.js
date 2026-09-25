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
const PRICE_RE = /(\$\s?)?(\d{1,2},\d{3}|\d{3,5}|\d{1,2}(?:\.\d{1,2})?\s?k)\b(?!\s*(?:sq|square|ft|sf)\b)(\s*(?:\/|per|a|an)\s*(?:mo(?:nth)?\b|m\b|person|room|each|week\b|wk\b|day\b|night\b))?/gi;
const NON_MONTHLY_AFTER = /^\s*(?:\/|per|a|an|each)?\s*(?:week|wk|day|night)\b|^\s*(?:weekly|daily|nightly)\b/i;

const NON_RENT_BEFORE = /(deposit|security|broker|fee|utilities|utils|util|internet|wifi|electric|application|app fee|income|salary|earn|make|credit|parking|bonus|off|discount|save|was)\W*(?:\w+\W+){0,2}$/i;
const NON_RENT_AFTER = /^\s{0,2}(?:security\s+)?(?:deposit|security|broker|fee|in utilities|for utilities|utilities\s+(?:per|a|\/|fee|cost)|credit score|salary|income|sq|square|ft|off\b)/i;

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
    // Weekly / daily / nightly amounts are not monthly rent.
    if (unit && /week|wk|day|night/i.test(unit)) continue;
    if (NON_MONTHLY_AFTER.test(text.slice(idx + raw.length, idx + raw.length + 12))) continue;
    // A price written "/mo" or "/month" is rent even if a deposit is mentioned next to it.
    const monthlyUnit = unit && /mo/i.test(unit);
    if (NON_RENT_BEFORE.test(before) || (!monthlyUnit && NON_RENT_AFTER.test(after))) continue;
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
// Only STATED counts of the people you'd be joining. Nothing is estimated:
// "family of 3", "4BR apartment" or "looking for 2 roommates" do not tell us
// how many people already live there.
const ADJ = '(?:other|current|existing|great|chill|friendly|awesome|lovely|cool|easygoing|easy-going|clean|quiet|fun|female|male|working|young|wonderful|amazing|nice|super)';
const ROOMMATE_PATTERNS = [
  // "living with 2 other roommates", "you'd be living with 1 other person"
  new RegExp(`\\bliv(?:e|ing)\\s+with\\s+${NUM}\\s+(?:${ADJ}\\s+)*${WHO}`, 'i'),
  // "share (the apartment) with two others"
  new RegExp(`\\bshar(?:e|ing)\\s+(?:the\\s+|this\\s+|an?\\s+|our\\s+)?(?:apartment|apt|place|unit|home|house|space\\s+)?\\s*with\\s+${NUM}\\s+(?:${ADJ}\\s+)*${WHO}`, 'i'),
  // "2 current roommates", "two chill roommates"
  new RegExp(`\\b${NUM}\\s+${ADJ}\\s+(?:\\w+\\s+)?${WHO}`, 'i'),
  // "join 2 roommates", "joining two others"
  new RegExp(`\\bjoin(?:ing)?\\s+${NUM}\\s+(?:${ADJ}\\s+)*${WHO}`, 'i'),
  // "with 2 roommates"
  new RegExp(`\\bwith\\s+${NUM}\\s+(?:${ADJ}\\s+)*${WHO}`, 'i'),
];
// Wanting N roommates is about rooms on offer, not people already there.
const WANTING_BEFORE = /(?:looking\s+for|seeking|searching\s+for|need(?:ing)?|want(?:ing)?|hoping\s+to\s+find|to\s+find)\s*(?:\S+\s+){0,2}$/i;
const LIVE_WITH_ONE_RE = /\b(?:live|living|be)\s+with\s+(?:me|my\s+(?:partner|boyfriend|girlfriend|bf|gf)\b)|\bI(?:'m| am)\s+(?:the\s+only|your)\s+(?:other\s+)?roommate|\bjust\s+me\s+(?:living\s+)?(?:here|in\s+the\s+apartment)/i;
const LIVE_WITH_TWO_RE = /\b(?:live|living)\s+with\s+(?:a|one)\s+couple\b|\b(?:me\s+and\s+my|my)\s+(?:roommate|roomie|partner|boyfriend|girlfriend|bf|gf|friend|sister|brother)\s+and\s+(?:I|me)\b|\bme\s+and\s+(?:my\s+)?(?:roommate|roomie|partner|boyfriend|girlfriend|friend)\b|\bthe\s+two\s+of\s+us\b/i;
const THREE_OF_US_RE = /\bthe\s+three\s+of\s+us\b/i;

// Number of people already in the unit that you would be joining (stated only).
export function findRoommates(text) {
  if (!text) return { roommates: null, roommatesSource: null };
  for (const re of ROOMMATE_PATTERNS) {
    const g = new RegExp(re.source, 'gi');
    for (const m of text.matchAll(g)) {
      if (WANTING_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      const n = toNumber(m[1]);
      if (n != null && n <= 8) return { roommates: n, roommatesSource: 'stated' };
    }
  }
  if (THREE_OF_US_RE.test(text)) return { roommates: 3, roommatesSource: 'stated' };
  // "you'll be living with one NB person, one guy, and two girls (including me)"
  const list = /\bliv(?:e|ing)\s+with\s+((?:(?:and\s+)?(?:\d|one|two|three|four)\s+(?:[\w-]+\s+){0,2}?(?:person|people|guys?|girls?|women|woman|men|man|roommates?|others?)\b[\s,]*){2,5})/i.exec(text);
  if (list) {
    const n = [...list[1].matchAll(/\b(\d|one|two|three|four)\b/gi)].reduce((a, m) => a + toNumber(m[1]), 0);
    if (n > 0 && n <= 8) return { roommates: n, roommatesSource: 'stated' };
  }
  if (LIVE_WITH_TWO_RE.test(text)) return { roommates: 2, roommatesSource: 'stated' };
  if (LIVE_WITH_ONE_RE.test(text)) return { roommates: 1, roommatesSource: 'stated' };
  if (/\bonly\s+you\s+and\s+(?:I|me)\s+(?:will\s+)?live\b|\bjust\s+(?:you\s+and\s+(?:I|me)|the\s+two\s+of\s+us)\b/i.test(text)) return { roommates: 1, roommatesSource: 'stated' };
  return { roommates: null, roommatesSource: null };
}

// ---------- listing type ----------
// Only from explicit wording; UNKNOWN otherwise.
const TYPE_RULES = [
  ['LEASE_TAKEOVER', /\blease\s+(?:take[- ]?over|transfer|assignment|break)\b|\btak(?:e|ing)\s+over\s+(?:my|our|the)\s+lease\b/i],
  ['SUBLET', /\bsub-?let(?:ting)?\b|\bsub-?leas(?:e|ing)\b|\bshort[- ]term\s+(?:rental|stay|sublet|room|housing)\b/i],
  ['ROOM_IN_SHARED_APARTMENT', /\b(?:private|spare|furnished|master|sunny|big|large|cozy|small)?\s*(?:bed)?room\s+(?:for\s+rent|available|open|in\s+(?:a|an|my|our|the)\b|in\s+(?:a\s+)?(?:\d|two|three|four|five)\s*-?\s*(?:br|bd|bed(?:room)?)s?\b)|\b(?:\d|one|two|three|four)\s+(?:private\s+)?(?:bed)?rooms?\s+(?!(?:[\w-]+\s+){0,2}(?:apartment|apt|unit|flat|house|home)\b)(?:[\w-]+\s+){0,4}(?:available|open(?:ing)?(?:\s+up)?|for\s+rent)\b|\broom(?:mate|ie)s?\s+(?:wanted|needed)\b|\blooking\s+for\s+(?:an?\s+|\w+\s+)?(?:roommate|roomie|housemate)|\bshared\s+(?:apartment|apt|house|home)\b|\broom\s*share\b|\bto\s+fill\s+(?:(?:the|our|a|my)\s+)?(?:\w+\s+)?(?:bed)?room\b|\bprivate\s+(?:bed)?room\b|\bspare\s+(?:bed)?room\b|\bsecond\s+bedroom\b|\b(?:this|the)\s+room\s+(?:is|can\s+be)\b|\broom\s+is\s+available\b|\bshared\s+common\s+(?:areas?|spaces?)\b|^\W*(?:big\s+|large\s+|sunny\s+|cozy\s+)?(?:bed)?room\s+with\b/im],
  ['ENTIRE_APARTMENT', /\b(?:entire|whole)\s+(?:apartment|apt|unit|place|home|house|floor)\b|\b(?:vacant|empty)\s+(?:apartment|apt|unit)\b|\b(?:apartment|apt|studio|house|\d\s?br|\d[- ]bed(?:room)?(?:\s+apartment)?)\s+for\s+rent\b|\b(?:\d|one|two|three|four)[- ]?(?:bed(?:room)?|br)s?\s*(?:[/,]\s*(?:\d|one|two)[- ]?(?:full\s+)?bath(?:room)?s?\s*)?(?:w\/\s*\w+\s+)?(?:apartment|apt|flat|unit|residences?)\b|\bapartment\s+(?:is\s+)?(?:available|for\s+rent)\b|\bstudio\s+(?:in|apartment|apt|with|offers|lease)\b|^\W*studio\b|\b\d\s?BR\s+in\b|\b(?:my|the|this)\s+flat\b|\blisting\s+a\s+(?:vacant\s+)?(?:apartment|apt|place)\b/im],
];

export function findListingType(text) {
  for (const [type, re] of TYPE_RULES) if (re.test(text || '')) return type;
  return null;
}

// ---------- laundry ----------

export function findLaundry(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const inUnit = /(w\/d|w\s?&\s?d|washer\s*(?:\/|&|and|-)?\s*dryer|washer-dryer|laundry)\s*(?:is\s+)?(?:in[- ]?unit|in the (?:unit|apartment|apt)|in apt|in-apartment)|in[- ]?unit\s*(?:w\/d|w\s?&\s?d|washer|laundry)|\bwdiu\b|\bw\/d\s*iu\b|washer (?:and|&) dryer in (?:the )?(?:unit|apartment|apt)/;
  const inBuilding = /(w\/d|w\s?&\s?d|washer\s*(?:\/|&|and|-)?\s*dryer|laundry)\s*(?:room\s*)?(?:is\s+)?(?:available\s+)?(?:in[- ]?(?:the\s+)?(?:building|bldg)|on[- ]site|in basement|in the basement|on (?:each|every) floor)|(?:building|bldg|on[- ]site|basement)\s+(?:has\s+(?:a\s+)?)?laundry|laundry\s+room|shared laundry|common laundry/;
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
  const t = findListingType(text);
  return t === 'ENTIRE_APARTMENT' || t === 'LEASE_TAKEOVER' ? 'apartment' : 'room';
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

// Decides what YOU would pay. Never divides a total by bedrooms unless the
// post says the rent is split evenly. Returns
//   { price, priceMax, totalRent, priceType, priceBasis }
// priceType:  'room_share' | 'whole_unit' | 'unknown'
// priceBasis: 'explicit'   — stated as your/per-person/room price
//             'likely'     — a room post quoting one plausible amount
//             'calculated' — total ÷ people, because an even split is stated
//             null         — unknown / needs confirmation
const EVEN_SPLIT_RE = /split (?:(?:it|the rent|rent|everything)\s+)?(?:evenly|equally|down the middle|\d+ ways|(?:two|three|four) ways)|divided (?:evenly|equally)|(?:even|equal) split|split 50\/50/i;
const SPLIT_WAYS_RE = /split (\d|two|three|four) ways/i;
const ROOM_PRICE_CONTEXT = /(?:room|bedroom)(?:\s+[a-z0-9]{1,2}\b)?\s+(?:is\s+|available\s+|for rent\s+|goes\s+)?(?:for|at|is|:|-|–|—)?\s*(?:only\s+|just\s+)?$|(?:private|master|available|open|your|the|furnished|sunny|large|small|big)\s+(?:room|bedroom)[^.$\n]{0,25}$/i;
const LIKELY_SHARE_MAX = 2200; // a single plain amount above this in a multi-bedroom post is probably the whole unit

function pickSharePrice(prices, text, { kind, bedrooms, roomsAvailable }) {
  const none = { price: null, priceMax: null, totalRent: null, priceType: 'unknown', priceBasis: null };
  if (!prices.length) return none;
  const perPerson = prices.filter((p) => p.perPerson || ROOM_PRICE_CONTEXT.test(text.slice(Math.max(0, p.index - 40), p.index)));
  const totals = prices.filter((p) => p.total && !perPerson.includes(p));
  const plain = prices.filter((p) => !perPerson.includes(p) && !totals.includes(p));
  const totalRent = totals[0]?.amount ?? null;

  if (perPerson.length) {
    const amts = perPerson.map((p) => p.amount);
    return { price: Math.min(...amts), priceMax: Math.max(...amts), totalRent, priceType: 'room_share', priceBasis: 'explicit' };
  }

  const wholeAmount = totalRent ?? (kind === 'apartment' ? plain[0]?.amount : null)
    ?? (plain.length === 1 && bedrooms >= 2 && plain[0].amount > LIKELY_SHARE_MAX ? plain[0].amount : null);
  if (wholeAmount != null) {
    if (EVEN_SPLIT_RE.test(text)) {
      const ways = SPLIT_WAYS_RE.exec(text);
      const people = ways ? ({ two: 2, three: 3, four: 4 }[ways[1].toLowerCase()] ?? +ways[1]) : bedrooms;
      if (people >= 2) {
        const share = Math.round(wholeAmount / people);
        return { price: share, priceMax: share, totalRent: wholeAmount, priceType: 'room_share', priceBasis: 'calculated' };
      }
    }
    if (bedrooms === 0 || (bedrooms === 1 && kind === 'apartment')) {
      // A studio/1BR taken over whole: the whole rent is what you'd pay.
      return { price: wholeAmount, priceMax: wholeAmount, totalRent: wholeAmount, priceType: 'whole_unit', priceBasis: 'explicit' };
    }
    return { ...none, totalRent: wholeAmount };
  }

  const amts = plain.map((p) => p.amount);
  if (!amts.length) return none;
  // Several prices in a room post ("Room A $1,400 / Room B $1,650") read as a range.
  const useRange = (roomsAvailable ?? 1) > 1 || amts.length > 1;
  return {
    price: Math.min(...amts),
    priceMax: useRange ? Math.max(...amts) : Math.min(...amts),
    totalRent: null,
    priceType: 'room_share',
    priceBasis: 'likely',
  };
}

export function parseListing({ title = '', body = '', flair = '', hints = {}, postedAt = null }) {
  const text = `${title}\n${body}`;
  const ref = postedAt ? new Date(postedAt) : new Date();
  const kind = hints.kind || listingKind(text);
  let bedrooms = hints.bedrooms ?? findBedrooms(title) ?? findBedrooms(body);
  if (bedrooms === 1 && kind === 'room' && hints.bedrooms == null
    && !/\b(?:1|one)[- ]?(?:br|bd|bed(?:room)?)\s+(?:apartment|apt|unit|flat)|\b1b1b\b|\bin (?:a|my|our) (?:1|one)[- ]?(?:br|bed(?:room)?)/i.test(text)) {
    bedrooms = null; // "1 bedroom for rent" = the room on offer, not the apartment size
  }
  const roomsAvailable = findRoomsAvailable(text);
  const prices = findPrices(text);
  // A title price is usually the headline rent; if present, don't let body prices widen the range much.
  const titlePrices = findPrices(title);
  const priceInfo = pickSharePrice(titlePrices.length ? titlePrices : prices, titlePrices.length ? title : text, { kind, bedrooms, roomsAvailable });
  if (priceInfo.price == null && titlePrices.length && prices.length > titlePrices.length) {
    // The title only gave a total; the body may still state the room price.
    const fromBody = pickSharePrice(findPrices(body), body, { kind, bedrooms, roomsAvailable });
    if (fromBody.price != null) Object.assign(priceInfo, fromBody, { totalRent: priceInfo.totalRent ?? fromBody.totalRent });
  }
  if (hints.price != null && priceInfo.price == null) {
    Object.assign(priceInfo, { price: hints.price, priceMax: hints.price, priceType: 'unknown', priceBasis: 'likely' });
  }
  const { roommates, roommatesSource } = findRoommates(text);
  const location = findNeighborhood(hints.neighborhood, title, body);
  return {
    postType: classifyPost({ title, body, flair }),
    kind,
    listingType: findListingType(text),
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
