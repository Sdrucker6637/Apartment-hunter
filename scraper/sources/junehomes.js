// June Homes (junehomes.com): furnished private rooms in shared NYC
// apartments. Access basis (verified 2026-09-25 by probe): robots.txt allows
// /residences/*, terms of use contain no scraping/automated-access clause.
// Data: schema.org Apartment JSON-LD on the index and detail pages.

import { fetchText, jsonLdBlocks, pageText } from '../http.js';
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

  // Gallery: this room's photos first, then shared-space photos of the same home.
  const urls = [...new Set([...html.matchAll(/https:\/\/storage\.googleapis\.com\/junehomes\/media\/(?:roompicture|residencepicture)\/\d+\/[a-f0-9]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]))];
  const primary = listing.photos[0]?.url;
  const firstRoom = /roompicture\/(\d+)\//.exec(urls.find((u) => u.includes('/roompicture/')) || '')?.[1];
  const room = urls.filter((u) => firstRoom && u.includes(`/roompicture/${firstRoom}/`));
  const shared = urls.filter((u) => u.includes('/residencepicture/'));
  const gallery = [...new Set([primary, ...room, ...shared].filter(Boolean))].slice(0, 16);
  out.photos = gallery.map((url) => ({ url }));
  return out;
}

export async function fetchListings({ maxPages = 4, maxDetails = 40, log = () => {} } = {}) {
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const { body } = await fetchText(page === 1 ? INDEX : `${INDEX}&page=${page}`);
    const found = jsonLdBlocks(body).filter((b) => b['@type'] === 'Apartment').map(parseIndexItem).filter(Boolean);
    const fresh = found.filter((l) => l.sourceId && !seen.has(l.sourceId));
    fresh.forEach((l) => seen.add(l.sourceId));
    items.push(...fresh);
    log(`junehomes: page ${page} -> ${found.length} rooms`);
    if (!found.length) break;
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
        log(`junehomes: detail failed (${err.message})`);
      }
    }
    out.push(item);
  }
  log(`junehomes: ${items.length} rooms, ${enriched} enriched from detail pages`);
  return out;
}
