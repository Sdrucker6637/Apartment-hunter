// June Homes (junehomes.com): furnished private rooms in shared NYC
// apartments. Access basis (verified 2026-09-25 by probe): robots.txt allows
// /residences/*, terms of use contain no scraping/automated-access clause.
// Data: schema.org Apartment JSON-LD on the index and detail pages.

import { fetchText, jsonLdBlocks, pageText, RobotsDisallowedError } from '../http.js';
import { findNeighborhood } from '../neighborhoods.js';
import { field } from '../schema.js';

const ORIGIN = 'https://junehomes.com';
const INDEX = `${ORIGIN}/residences/new-york-city-ny?hometype=private_rooms`;

export const meta = {
  id: 'junehomes',
  name: 'June Homes',
  kind: 'Furnished rooms in managed shared apartments',
  access: 'Public pages; robots.txt allows; terms have no scraping clause (checked 2026-09-25)',
  photos: 'Direct from listing (storage.googleapis.com), hotlink-accessible',
};

const MONTH_FMT = /(\d{2})\/(\d{2})\/(\d{4})/;

function roomIdFromUrl(url) {
  return /\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1] ?? null;
}

// ".../residences/new-york-city-ny/{hood-slug}/{home-slug}/{roomId}"
function hoodFromUrl(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const slug = parts[2] || '';
  return slug.replace(/-(queens|brooklyn|manhattan|bronx)$/, '').replace(/-/g, ' ');
}

// Index cards show "Available from MM/DD/YYYY # 873-B"; the bedroom ID is the
// home number from the URL plus the letter in the room name ("Full Bedroom B").
export function availabilityByBedroom(html) {
  const text = pageText(html);
  const out = new Map();
  for (const m of text.matchAll(/Available from\s+(\d{2})\/(\d{2})\/(\d{4})\s*#\s*(\d+-[A-Z0-9]+)/g)) {
    out.set(m[4], { date: `${m[3]}-${m[1]}-${m[2]}`, text: `${m[1]}/${m[2]}/${m[3]}` });
  }
  return out;
}

export function bedroomId(ld) {
  const home = /\/residences\/new-york-city-ny\/[^/]+\/(\d+)-/.exec(ld.url || '')?.[1];
  const letter = /Bedroom\s+([A-Z0-9]+)\s*$/.exec(ld.name || '')?.[1];
  return home && letter ? `${home}-${letter}` : null;
}

export function parseIndexItem(ld) {
  const url = ld.url || ld['@id']?.replace(/#.*$/, '');
  if (!url || !/\/residences\/new-york-city-ny\//.test(url)) return null;
  const hood = findNeighborhood(hoodFromUrl(url), ld.address?.addressRegion, ld.description);
  const bedroomsInUnit = /in a (\d+)-bedroom apartment/i.exec(ld.description || '')?.[1];
  const beds = bedroomsInUnit ? +bedroomsInUnit : null;
  const price = ld.offers?.price != null ? Number(ld.offers.price) : null;
  const image = typeof ld.image === 'string' ? ld.image : ld.image?.url || ld.photo?.url;
  return {
    source: 'junehomes',
    sourceId: roomIdFromUrl(url),
    sourceLabel: 'June Homes',
    originalUrl: url,
    title: ld.name || 'Private room',
    description: ld.description || '',
    price: price ? { monthly: price, max: price, type: 'room_share', basis: 'structured' } : undefined,
    bedrooms: field(beds, 'explicit'),
    availableRooms: field(1, 'structured'),
    // June rents each bedroom separately; others may be occupied or vacant.
    roommates: field(beds ? beds - 1 : null, 'inferred'),
    roomType: field('private', 'structured'),
    neighborhood: field(hood.neighborhood, hood.neighborhood ? 'structured' : null),
    borough: field(hood.borough, hood.borough ? 'inferred' : null),
    location: ld.geo?.latitude ? { lat: ld.geo.latitude, lng: ld.geo.longitude, precision: 'building' } : null,
    address: ld.address?.streetAddress || null,
    contactUrl: url,
    contactMethod: 'June Homes booking page',
    photos: image ? [{ url: image }] : [],
    postedAt: null,
  };
}

// Enriches a listing from its detail page: full gallery, amenities, move-in.
export function parseDetail(listing, html) {
  const out = { ...listing };
  const blocks = jsonLdBlocks(html);
  const apt = blocks.find((b) => b['@type'] === 'Apartment');
  const text = pageText(html);

  const amenities = (apt?.amenityFeature || []).map((a) => a.name).filter(Boolean);
  const amenityText = amenities.join(' | ') + ' ' + (/Amenities([\s\S]{0,800})/.exec(text)?.[1] || '');
  if (/\bFurnished\b/i.test(amenityText)) out.furnished = field(true, 'structured');
  if (/washer|laundry/i.test(amenityText)) {
    out.laundry = field(/in[- ]unit|washer\/dryer in/i.test(amenityText) ? 'in_unit' : 'in_building', 'structured');
  }
  if (apt?.petsAllowed != null) out.pets = field(apt.petsAllowed ? 'Pets allowed' : 'No pets', 'structured');

  const beds = /Bedrooms\s+(\d+)/.exec(text)?.[1];
  if (beds) {
    out.bedrooms = field(+beds, 'structured');
    out.roommates = field(+beds - 1, 'inferred');
    out.totalPeople = field(+beds, 'inferred');
  }
  const baths = /\bBath\s+(\d+(?:\.\d)?)/.exec(text)?.[1];
  if (baths) out.bathrooms = field(+baths, 'structured');
  if (beds && baths) out.bathroomType = field(+baths >= +beds ? 'private' : 'shared', 'inferred');

  const avail = /Available (?:from|on)\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1];
  if (avail) {
    const [, mm, dd, yyyy] = MONTH_FMT.exec(avail);
    out.moveIn = field({ date: `${yyyy}-${mm}-${dd}`, text: avail }, 'structured');
  } else if (/Available (?:now|immediately)/i.test(text)) {
    out.moveIn = field({ date: new Date().toISOString().slice(0, 10), text: 'Now' }, 'structured');
  }
  const minStay = /(?:Minimum stay|Min\.? (?:lease|stay))\s*:?\s*(\d+\s*(?:months?|days?|weeks?))/i.exec(text)?.[1];
  if (minStay) out.leaseLength = field(`Minimum ${minStay}`, 'structured');
  if (/utilities (?:are )?included|all utilities included/i.test(text)) out.utilitiesIncluded = field(true, 'explicit');

  // Gallery: this room's own photo (from its structured data), then the
  // apartment's shared-space photos. Detail pages also show photos of the
  // OTHER bedrooms, which we can't attribute reliably, so those are left out.
  const shared = [...new Set([...html.matchAll(/https:\/\/storage\.googleapis\.com\/junehomes\/media\/residencepicture\/\d+\/[a-f0-9]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]))]
    .filter((u) => u !== apt?.accommodationFloorPlan?.layoutImage);
  const primary = listing.photos[0]?.url || apt?.photo?.url;
  out.photos = [
    ...(primary ? [{ url: primary, caption: 'This room' }] : []),
    ...shared.slice(0, 15).map((url) => ({ url, caption: 'Shared space in this apartment' })),
  ];
  return out;
}

// robots.txt disallows "?page=N" pagination, so we walk the per-neighborhood
// index pages that the city page links to (plain paths, allowed).
export function neighborhoodIndexLinks(html) {
  return [...new Set([...html.matchAll(/href="(?:https:\/\/junehomes\.com)?(\/residences\/new-york-city-ny\/[a-z0-9-]+)\/?"/g)].map((m) => m[1]))];
}

export async function fetchListings({ maxPages = 12, maxDetails = 100, maxShare = Infinity, log = () => {} } = {}) {
  const items = [];
  const seen = new Set();
  const skipped = [];
  const queue = [INDEX];
  const visited = new Set();
  while (queue.length && visited.size < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    let body;
    try {
      ({ body } = await fetchText(url));
    } catch (err) {
      if (err instanceof RobotsDisallowedError) { skipped.push(url); continue; }
      if (visited.size === 1) throw err; // the main index failing is a source failure
      log(`junehomes: index page failed (${err.message})`);
      continue;
    }
    const avail = availabilityByBedroom(body);
    const found = jsonLdBlocks(body).filter((b) => b['@type'] === 'Apartment').map((ld) => {
      const item = parseIndexItem(ld);
      const a = item && avail.get(bedroomId(ld));
      if (a) item.moveIn = field(a, 'structured');
      return item;
    }).filter(Boolean);
    const fresh = found.filter((l) => l.sourceId && !seen.has(l.sourceId));
    fresh.forEach((l) => seen.add(l.sourceId));
    items.push(...fresh);
    log(`junehomes: index ${visited.size} -> ${found.length} rooms (${fresh.length} new)`);
    for (const path of neighborhoodIndexLinks(body)) {
      const next = `${ORIGIN}${path}`;
      if (!visited.has(next) && !queue.includes(next)) queue.push(next);
    }
  }
  if (skipped.length) log(`junehomes: ${skipped.length} index page(s) skipped — disallowed by robots.txt`);
  let enriched = 0;
  const out = [];
  let skippedOverBudget = 0;
  for (const item of items) {
    // Listings already known to be over budget are dropped later; don't fetch their pages.
    if (item.price?.monthly != null && item.price.monthly > maxShare) { skippedOverBudget++; out.push(item); continue; }
    if (enriched < maxDetails) {
      try {
        const { body } = await fetchText(item.originalUrl);
        out.push(parseDetail(item, body));
        enriched++;
        continue;
      } catch (err) {
        log(`junehomes: detail failed (${err.name})`);
      }
    }
    out.push(item);
  }
  log(`junehomes: ${items.length} rooms from ${visited.size} index pages, ${enriched} enriched from detail pages, ${skippedOverBudget} over budget (not fetched)`);
  return out;
}
