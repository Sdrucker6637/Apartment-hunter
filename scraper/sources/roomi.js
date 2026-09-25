// Roomi (roomiapp.com): rooms and apartments offered in NYC.
//
// Investigation 2026-09-25 (probe/investigate.js, GitHub Actions):
// - roomiapp.com/robots.txt allows the search pages (/rooms-for-rent/…) and
//   DISALLOWS /listings/ (detail pages). We only fetch the search page; the
//   /listings/<id> URL is recorded as the link for people to open.
// - The search page is server-rendered Next.js; its flight payload
//   (self.__next_f) holds ~90 structured listings: price_per_month,
//   room_type, bedrooms, bathrooms, availability_date, lease_duration,
//   amenities, display_location, latitude/longitude, photos.
// - The payload also carries lister profiles (names, school, profile photo,
//   last online). Those are never copied: only listing fields are read.
import { fetchText } from '../http.js';
import { findNeighborhood } from '../neighborhoods.js';
import { field } from '../schema.js';
import { fillFromText, NEARBY_NJ } from './common.js';

const ORIGIN = 'https://roomiapp.com';
const SEARCH_PAGES = ['/rooms-for-rent/new-york'];

export const meta = {
  id: 'roomi',
  name: 'Roomi',
  uniqueIds: true,
  kind: 'Rooms and apartments offered by individuals',
  access: 'Server-rendered search page; robots.txt allows /rooms-for-rent/ and disallows /listings/ (detail pages are never fetched).',
  photos: 'Direct from listing (Roomi image storage)',
};

// Next.js App Router streams its data as JS string chunks: concatenate them.
export function flightText(html) {
  let flight = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { flight += JSON.parse(m[1]); } catch { /* malformed chunk */ }
  }
  return flight;
}

// Every JSON object in the payload that has a price_per_month key.
export function listingObjects(flight) {
  const out = new Map();
  let i = 0;
  while ((i = flight.indexOf('"price_per_month"', i)) !== -1) {
    let depth = 0;
    let s = i;
    for (; s >= 0; s--) {
      const c = flight[s];
      if (c === '}') depth++;
      else if (c === '{') { if (depth === 0) break; depth--; }
    }
    let d = 0;
    let e = s;
    let inStr = false;
    for (; e < flight.length; e++) {
      const c = flight[e];
      if (inStr) { if (c === '\\') e++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) break; }
    }
    try {
      const o = JSON.parse(flight.slice(s, e + 1));
      if (o.id && !out.has(o.id)) out.set(o.id, o);
    } catch { /* not a complete object */ }
    i = Math.max(e, i + 1);
  }
  return [...out.values()];
}

const LEASE = { '12_months': '12 months', flexible: 'Flexible', month_to_month: 'Month to month', '6_months': '6 months' };
const LISTER = {
  'I live here currently, and will be roommates with the new renter': 'lives_here',
  'I live here currently, but will move out before new renter moves in': 'moving_out',
  "I don't live here, and don't plan to in the future": 'not_living_here',
  "I don't live here yet, but am planning to move in soon": 'moving_in',
};
const photoUrl = (p) => (typeof p === 'string' ? p : p?.url || p?.image_url || p?.photo_url || null);

export function parseListing(o, { now = Date.now() } = {}) {
  if (!o || !o.id || o.status !== 'active') return null;
  const price = Number(o.price_per_month);
  const beds = Number.isFinite(o.bedrooms) ? o.bedrooms : null;
  const entire = o.room_type === 'entire';
  const amen = new Set(o.amenities || []);
  const where = String(o.display_location || '');
  const hood = findNeighborhood(where);
  const nj = /,\s*NJ\b|New Jersey/i.test(where);
  const outOfArea = nj ? !NEARBY_NJ.test(where) : !(/\bNY\b|New York|Kings County|Queens County|Bronx County|Richmond County/i.test(where) || hood.borough);
  const photos = [photoUrl(o.cover_photo_url), ...(o.photos || []).map(photoUrl)]
    .filter((u) => u && /^https:\/\//.test(u))
    .filter((u, i, a) => a.indexOf(u) === i)
    .slice(0, 16)
    .map((url) => ({ url }));
  const avail = o.availability_date ? String(o.availability_date).slice(0, 10) : null;
  const posted = [o.published_at, o.date_activated].filter(Boolean).sort().pop() || null;
  const kind = o.property_type && o.property_type !== 'apartment' ? o.property_type : 'apartment';
  const title = entire
    ? `Entire ${beds === 0 ? 'studio' : beds ? `${beds}BR ` + kind : kind}`
    : `${o.room_type === 'shared' ? 'Shared' : 'Private'} room${beds ? ` in a ${beds}BR ${kind}` : ''}`;

  const listing = {
    source: 'roomi',
    sourceId: o.id,
    sourceLabel: 'Roomi',
    originalUrl: `${ORIGIN}/listings/${o.id}`,
    title: `${title}${where ? ` — ${where.replace(/, (?:NY|Kings County|Queens County|Bronx County|New York County|Richmond County)$/, '')}` : ''}`,
    description: String(o.description || ''),
    listingKind: entire ? 'apartment' : 'room',
    listingType: field(entire ? 'ENTIRE_APARTMENT' : 'ROOM_IN_SHARED_APARTMENT', 'structured'),
    roomType: field(entire ? null : o.room_type === 'shared' ? 'shared' : o.room_type === 'private' ? 'private' : null, 'structured'),
    price: Number.isFinite(price) && price >= 300 && !entire ? { monthly: price, max: price, type: 'room_share', basis: 'structured' } : undefined,
    totalRent: field(entire && Number.isFinite(price) && price >= 300 ? price : null, 'structured'),
    bedrooms: field(beds, 'structured'),
    bathrooms: field(Number.isFinite(o.bathrooms) ? o.bathrooms : null, 'structured'),
    bathroomType: field(amen.has('amenity-private-bath') ? 'private' : null, 'structured'),
    furnished: field(amen.has('amenity-furnished') ? true : null, 'structured'),
    utilitiesIncluded: field(amen.has('amenity-utilities') ? true : null, 'structured'),
    moveIn: field(avail ? { date: avail, text: Date.parse(avail) <= now ? 'Available now' : avail } : null, 'structured'),
    leaseLength: field(o.lease_duration === 'fixed' && o.move_out_date ? `Until ${String(o.move_out_date).slice(0, 10)}` : LEASE[o.lease_duration] || null, 'structured'),
    lister: field(LISTER[o.situation] || null, 'structured'),
    neighborhood: field(hood.neighborhood, hood.neighborhood ? 'structured' : null),
    borough: field(hood.borough, hood.borough ? (hood.neighborhood ? 'calculated' : 'structured') : null),
    location: Number.isFinite(o.latitude) && Number.isFinite(o.longitude) ? { lat: o.latitude, lng: o.longitude, precision: 'approximate' } : null,
    contactUrl: `${ORIGIN}/listings/${o.id}`,
    contactMethod: 'Roomi message (account required)',
    photos,
    postedAt: posted,
    sourceUpdatedAt: o.updated_at || null,
    outOfArea,
  };
  // A sublet: the lister moves out and the lease has a fixed end date.
  if (!entire && o.lease_duration === 'fixed' && o.move_out_date && LISTER[o.situation] === 'moving_out') {
    listing.listingType = field('SUBLET', 'calculated');
  }
  return fillFromText(listing, listing.description);
}

export async function fetchListings({ log = () => {}, now = Date.now() } = {}) {
  const found = new Map();
  for (const path of SEARCH_PAGES) {
    const { body } = await fetchText(ORIGIN + path);
    const objs = listingObjects(flightText(body));
    for (const o of objs) if (!found.has(o.id)) found.set(o.id, o);
    log(`roomi: ${path} -> ${objs.length} listings in page data`);
  }
  if (!found.size) throw new Error('Roomi search page returned no listing data (page structure may have changed)');
  const parsed = [...found.values()].map((o) => parseListing(o, { now })).filter(Boolean);
  const inArea = parsed.filter((l) => !l.outOfArea);
  log(`roomi: ${parsed.length} active listings, ${parsed.length - inArea.length} outside NYC dropped`);
  return inArea;
}
