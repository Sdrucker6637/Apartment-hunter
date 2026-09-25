// Roomster (roomster.com): rooms and apartments offered in NYC.
// Access basis (verified 2026-09-25 by probe): robots.txt allows these paths;
// terms of use contain no scraping/automated-access clause. Messaging a
// poster requires a Roomster account, so contact goes via the listing page.
// Data: schema.org ItemList JSON-LD on index pages; detail pages add geo + gallery.

import { fetchText, jsonLdBlocks, pageText, decodeEntities } from '../http.js';
import { parseListing } from '../parse.js';
import { findNeighborhood } from '../neighborhoods.js';
import { field } from '../schema.js';

const ORIGIN = 'https://roomster.com';
// NYC bounding box used by Roomster's own pagination links.
const BBOX = 'search_params.geo.lat_sw=40.496134&search_params.geo.lng_sw=-74.255591&search_params.geo.lat_ne=40.915533&search_params.geo.lng_ne=-73.700009';
const INDEXES = [
  { path: '/rooms-for-rent/new-york-ny-usa', kind: 'room' },
  { path: '/apartments-for-rent/new-york-ny-usa', kind: 'apartment' },
];

export const meta = {
  id: 'roomster',
  name: 'Roomster',
  kind: 'Rooms and apartments offered by individuals',
  access: 'Public pages; robots.txt allows; terms have no scraping clause (checked 2026-09-25). Messaging needs a Roomster account.',
  photos: 'Direct from listing (cdn-static.roomster.com), hotlink-accessible',
};

const priceOf = (item) => Number(item.offers?.price ?? item.offers?.priceSpecification?.price ?? item.priceSpecification?.price ?? item.price ?? NaN);
const imageOf = (item) => [].concat(item.image || item.photo || []).map((i) => (typeof i === 'string' ? i : i?.url || i?.contentUrl)).filter(Boolean);

// Roomster CDN accepts resize params (the site uses them itself).
const sized = (url, width) => `${url.split('?')[0]}?width=${width}&quality=70&format=webply&auto=webp`;

export function parseIndexItem(listItem, kind) {
  const item = listItem.item || listItem;
  const type = item['@type'];
  if (type === 'Demand') return null; // someone LOOKING for a room, not offering one
  const url = item.url && new URL(item.url.replace(/([^:]\/)\/+/g, '$1'), ORIGIN).href;
  const id = /\/listings\/(\d+)/.exec(url || '')?.[1];
  if (!id) return null;
  const price = priceOf(item);
  const title = decodeEntities(item.name || '');
  const description = decodeEntities(item.description || '');
  const locality = item.address?.addressLocality || item.itemOffered?.address?.addressLocality || item.areaServed?.address?.addressLocality || '';
  const hood = findNeighborhood(title, description, locality);
  const avail = item.availabilityStarts || item.offers?.availabilityStarts;
  const photos = imageOf(item).map((u) => ({ url: sized(u, 1280), thumb: sized(u, 640) }));
  return {
    source: 'roomster',
    sourceId: id,
    sourceLabel: 'Roomster',
    originalUrl: `${ORIGIN}/listings/${id}`,
    title,
    description,
    listingKind: kind,
    price: Number.isFinite(price) && price > 0
      ? { monthly: kind === 'room' ? price : null, max: kind === 'room' ? price : null, type: kind === 'room' ? 'room_share' : 'unknown', basis: kind === 'room' ? 'structured' : null }
      : undefined,
    totalRent: field(kind === 'apartment' && Number.isFinite(price) ? price : null, 'structured'),
    roomType: field(kind === 'room' ? 'private' : null, 'structured'),
    moveIn: field(avail ? { date: String(avail).slice(0, 10), text: String(avail).slice(0, 10) } : null, 'structured'),
    neighborhood: field(hood.neighborhood, hood.neighborhood ? 'explicit' : null),
    borough: field(hood.borough, hood.borough ? 'inferred' : null),
    contactUrl: `${ORIGIN}/listings/${id}`,
    contactMethod: 'Roomster message (account required)',
    photos,
    postedAt: item.datePosted || null,
  };
}

// Applies the free-text extractor to fields the structured data didn't give.
function fillFromText(listing, text) {
  const p = parseListing({ title: listing.title, body: text, postedAt: listing.postedAt });
  const set = (key, value, basis) => {
    if ((listing[key]?.value ?? null) == null && value != null) listing[key] = field(value, basis);
  };
  set('bedrooms', p.bedrooms, 'explicit');
  set('bathrooms', p.bathrooms, 'explicit');
  set('availableRooms', p.roomsAvailable, 'explicit');
  if (p.roommates != null) set('roommates', p.roommates, p.roommatesSource === 'stated' ? 'explicit' : 'inferred');
  set('laundry', p.laundry && p.laundry.replace('-', '_'), 'explicit');
  if ((listing.moveIn?.value ?? null) == null && p.moveIn) listing.moveIn = field(p.moveIn, 'explicit');
  if (!listing.neighborhood?.value && p.neighborhood) {
    listing.neighborhood = field(p.neighborhood, 'explicit');
    listing.borough = field(p.borough, 'inferred');
  }
  // Apartment posts: only take a per-person price if the text states one.
  if (listing.listingKind === 'apartment' && p.priceType === 'room_share' && p.priceBasis !== 'likely') {
    listing.price = { monthly: p.price, max: p.priceMax, type: 'room_share', basis: p.priceBasis === 'calculated' ? 'calculated' : 'explicit' };
  }
  listing.contactEmails = p.contacts.emails;
  listing.contactPhones = p.contacts.phones;
  return listing;
}

export function parseDetail(listing, html) {
  const out = { ...listing };
  const text = pageText(html);
  const thing = jsonLdBlocks(html).find((b) => b.geo);
  if (thing?.geo?.latitude) out.location = { lat: thing.geo.latitude, lng: thing.geo.longitude, precision: 'approximate' };

  // Labeled facts on the detail page ("Bedrooms 2", "Bathrooms 1", "Furnished Yes"...)
  const label = (re) => re.exec(text)?.[1]?.trim();
  const beds = label(/\bBedrooms?\s*:?\s*(\d+)/i);
  const baths = label(/\bBathrooms?\s*:?\s*(\d+(?:\.\d)?)/i);
  const people = label(/(?:People in household|Household size|Roommates?)\s*:?\s*(\d+)/i);
  const furnished = label(/\bFurnished\s*:?\s*(Yes|No)\b/i);
  const pets = label(/\bPets?\s*(?:allowed|OK)?\s*:?\s*(Yes|No)\b/i);
  const bathType = label(/\b(Private|Shared) bathroom\b/i);
  if (beds) out.bedrooms = field(+beds, 'structured');
  if (baths) out.bathrooms = field(+baths, 'structured');
  if (people) {
    out.roommates = field(+people, 'structured');
    out.totalPeople = field(+people + 1, 'calculated');
  }
  if (furnished) out.furnished = field(/yes/i.test(furnished), 'structured');
  if (pets) out.pets = field(/yes/i.test(pets) ? 'Pets allowed' : 'No pets', 'structured');
  if (bathType) out.bathroomType = field(bathType.toLowerCase(), 'structured');

  const full = /(?:About|Description)\s+([\s\S]{40,3000}?)(?:\s{2,}|Amenities|Household|Roommate preferences)/i.exec(text)?.[1];
  if (full && full.length > (out.description || '').length) out.description = full.trim();

  const gallery = [...new Set([...html.matchAll(/https:\/\/cdn-static\.roomster\.com\/pics\/Original\/[A-Za-z0-9-]+\.(?:jpe?g|png|webp)/g)].map((m) => m[0]))];
  if (gallery.length) out.photos = gallery.slice(0, 16).map((u) => ({ url: sized(u, 1280), thumb: sized(u, 640) }));
  return fillFromText(out, `${out.description}\n${text.slice(0, 4000)}`);
}

export async function fetchListings({ maxPages = 3, maxDetails = 45, log = () => {} } = {}) {
  const items = [];
  const seen = new Set();
  for (const { path, kind } of INDEXES) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${ORIGIN}${path}${page > 1 ? `?${BBOX}&search_params.page_number=${page}` : ''}`;
      const { body } = await fetchText(url);
      const list = jsonLdBlocks(body).flatMap((b) => b.itemListElement || b.mainEntity?.itemListElement || []);
      const parsed = list.map((li) => parseIndexItem(li, kind)).filter(Boolean);
      const fresh = parsed.filter((l) => !seen.has(l.sourceId));
      fresh.forEach((l) => seen.add(l.sourceId));
      items.push(...fresh);
      log(`roomster: ${path} page ${page} -> ${list.length} items, ${parsed.length} offers`);
      if (!list.length) break;
    }
  }
  let enriched = 0;
  const out = [];
  for (const item of items) {
    if (enriched < maxDetails) {
      try {
        const { body } = await fetchText(item.originalUrl);
        out.push(parseDetail(item, body));
        enriched++;
        continue;
      } catch (err) {
        log(`roomster: detail failed (${err.message})`);
      }
    }
    out.push(fillFromText(item, item.description));
  }
  log(`roomster: ${items.length} offers, ${enriched} enriched from detail pages`);
  return out;
}
