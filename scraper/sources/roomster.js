// Roomster (roomster.com): rooms and apartments offered in NYC.
// Access basis (verified 2026-09-25 by probe): robots.txt allows these paths;
// terms of use contain no scraping/automated-access clause. Messaging a
// poster requires a Roomster account, so contact goes via the listing page.
// Data: schema.org ItemList JSON-LD on index pages; detail pages add geo + gallery.

import { fetchText, jsonLdBlocks, pageText, decodeEntities, RobotsDisallowedError } from '../http.js';
import { extractText } from '../extract.js';
import { findNeighborhood } from '../neighborhoods.js';
import { field } from '../schema.js';
import { boroughFromCoords } from '../geo.js';

const ORIGIN = 'https://roomster.com';
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
  const raw = priceOf(item);
  const price = raw >= 400 && raw <= 15000 ? raw : NaN; // e.g. "$175" nightly rates → unknown
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
    listingType: field(kind === 'room' ? 'ROOM_IN_SHARED_APARTMENT' : 'ENTIRE_APARTMENT', 'structured'),
    moveIn: field(avail ? { date: String(avail).slice(0, 10), text: String(avail).slice(0, 10) } : null, 'structured'),
    neighborhood: field(hood.neighborhood, hood.neighborhood ? 'explicit' : null),
    borough: field(hood.borough, hood.borough ? 'calculated' : null),
    contactUrl: `${ORIGIN}/listings/${id}`,
    contactMethod: 'Roomster message (account required)',
    photos,
    postedAt: item.datePosted || null,
  };
}

// Applies the shared text extractor (scraper/extract.js) to fields the
// structured data didn't give.
function fillFromText(listing, text) {
  const x = extractText({ title: listing.title, text, postedAt: listing.postedAt });
  const set = (key, value, basis) => {
    if ((listing[key]?.value ?? null) == null && value != null) listing[key] = field(value, basis);
  };
  if (x.seeking) listing.postType = 'seeking';
  // "Bedrooms: 2" in the Residence section is a site field; free text is weaker.
  if (x.bedroomsLabeled && x.bedrooms != null) listing.bedrooms = field(x.bedrooms, 'structured');
  set('bedrooms', x.bedrooms, 'explicit');
  set('bathrooms', x.bathrooms, 'explicit');
  set('availableRooms', x.roomsAvailable, 'explicit');
  set('roommates', x.roommates, 'explicit');
  // The listing's own words can refine the category it was filed under.
  if (x.listingType === 'SUBLET' || x.listingType === 'LEASE_TAKEOVER') listing.listingType = field(x.listingType, 'explicit');
  if (/\bprivate\s+(?:bed)?room\b/i.test(text)) set('roomType', 'private', 'explicit');
  else if (/\bshared\s+(?:bed)?room\b|\broom\s*share\b|\bdivider\b/i.test(text)) set('roomType', 'shared', 'explicit');
  set('laundry', x.laundry, 'explicit');
  set('furnished', x.furnished, 'explicit');
  set('utilitiesIncluded', x.utilitiesIncluded, 'explicit');
  if (x.postedBy) listing.postedBy = field(x.postedBy, 'explicit');
  if ((listing.moveIn?.value ?? null) == null && x.moveIn) listing.moveIn = field(x.moveIn, 'explicit');
  if (!listing.neighborhood?.value && x.neighborhood) {
    listing.neighborhood = field(x.neighborhood, 'explicit');
    listing.borough = field(x.borough, 'calculated');
  }
  // Apartment posts: only take a per-person price if the text states one…
  if (listing.listingKind === 'apartment' && x.priceType === 'room_share' && x.shareBasis !== 'likely') {
    listing.price = { monthly: x.share, max: x.shareMax, type: 'room_share', basis: x.shareBasis === 'calculated' ? 'calculated' : 'explicit' };
  }
  // …or when the whole unit is a studio/1BR, whose full rent is what you'd pay.
  const beds = listing.bedrooms?.value;
  if (listing.listingKind === 'apartment' && listing.price?.monthly == null && listing.totalRent?.value && (beds === 0 || beds === 1)) {
    listing.price = { monthly: listing.totalRent.value, max: listing.totalRent.value, type: 'whole_unit', basis: 'structured' };
  }
  // Coordinates → borough, only when nothing better is known.
  if (!listing.borough?.value && listing.location) {
    const boro = boroughFromCoords(listing.location.lat, listing.location.lng);
    if (boro) listing.borough = field(boro, 'inferred');
  }
  listing.contactEmails = x.contacts.emails;
  listing.contactPhones = x.contacts.phones;
  return listing;
}

// NJ places commonly searched alongside NYC; other out-of-area listings are dropped.
const NEARBY_NJ = /jersey city|hoboken|union city|weehawken|west new york|north bergen/i;

// Detail pages have a few labeled fields: "Price/month", "Listing Type",
// "Available Date", a location line ("Astoria, Queens, NY, USA"),
// "Description", and "Additional information" ("Furnished: No"…). Anything
// else comes from the free-text parser and is labeled as such.
export function parseDetail(listing, html) {
  const out = { ...listing };
  const text = pageText(html).replace(/\s+/g, ' ').replace(/\b(?:ID Checked|Email Validated|Phone Validated|Verified|Premium)\b/g, '|');
  const thing = jsonLdBlocks(html).find((b) => b.geo);
  if (thing?.geo?.latitude) out.location = { lat: thing.geo.latitude, lng: thing.geo.longitude, precision: 'approximate' };

  const loc = /([A-Z][\w.'’&-]*(?: [\w.'’&-]+)*(?:, [A-Z][\w .'’&-]*)*), (NY|NJ|[A-Z]{2}), USA\s+Description/.exec(text);
  if (loc) {
    out.locationLine = `${loc[1]}, ${loc[2]}`;
    if (loc[2] !== 'NY' && !(loc[2] === 'NJ' && NEARBY_NJ.test(loc[1]))) out.outOfArea = true;
    const hood = findNeighborhood(loc[1]);
    if (loc[2] === 'NJ' && !hood.borough) hood.borough = 'New Jersey';
    if (!out.neighborhood?.value && hood.neighborhood) out.neighborhood = field(hood.neighborhood, 'structured');
    if (hood.borough) out.borough = field(hood.borough, hood.neighborhood ? 'calculated' : 'structured');
  }

  const desc = /, USA\s+Description\s+([\s\S]{15,4000}?)\s+(?:Additional information|Residence Building Type|Lifestyle|Show all photos|Report|$)/.exec(text)?.[1];
  if (desc && desc.length >= (out.description || '').length * 0.6) out.description = desc.trim();

  // Roomster's own category, e.g. "Listing Type Room for rent".
  const cat = /Listing Type\s+(.{3,40}?)\s+(?:Available Date|Move-in|Price)/i.exec(text)?.[1];
  if (cat) {
    const t = /sub-?let|sub-?lease/i.test(cat) ? 'SUBLET' : /room/i.test(cat) ? 'ROOM_IN_SHARED_APARTMENT' : /apartment|entire|house|studio/i.test(cat) ? 'ENTIRE_APARTMENT' : null;
    if (t) out.listingType = field(t, 'structured');
  }

  const furnished = /\bFurnished:\s*(Yes|No)\b/i.exec(text)?.[1];
  if (furnished) out.furnished = field(/yes/i.test(furnished), 'structured');
  const pets = /\bPets?(?: allowed)?:\s*(Yes|No)\b/i.exec(text)?.[1];
  if (pets) out.pets = field(/yes/i.test(pets) ? 'Pets allowed' : 'No pets', 'structured');

  // "New about 16 hours ago" → approximate posting time.
  const age = /\b(?:about\s+)?(\d+|an?)\s+(minute|hour|day|week|month)s?\s+ago\b/i.exec(text);
  if (age && !out.postedAt) {
    const n = /^an?$/i.test(age[1]) ? 1 : +age[1];
    const unit = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[age[2].toLowerCase()];
    out.postedAt = new Date(Date.now() - n * unit).toISOString();
    out.postedAtApproximate = true;
  }

  const gallery = [...new Set([...html.matchAll(/https:\/\/cdn-static\.roomster\.com\/pics\/Original\/[A-Za-z0-9-]+\.(?:jpe?g|png|webp)/g)].map((m) => m[0]))];
  if (gallery.length) out.photos = gallery.slice(0, 16).map((u) => ({ url: sized(u, 1280), thumb: sized(u, 640) }));
  return fillFromText(out, out.description);
}

// robots.txt disallows "?search_params" pagination, so we visit the
// per-neighborhood index pages Roomster links to (plain paths, allowed).
export function neighborhoodIndexLinks(html, prefix) {
  const re = new RegExp(`href="(?:https:\\/\\/(?:www\\.)?roomster\\.com)?(\\/${prefix}\\/[a-z0-9'&#;-]+-new-york-ny-usa)"`, 'g');
  return [...new Set([...html.matchAll(re)].map((m) => decodeEntities(m[1])))].filter((p) => !p.endsWith(`/${prefix}/new-york-ny-usa`));
}

export async function fetchListings({ maxPages = 14, maxDetails = 120, maxShare = Infinity, log = () => {} } = {}) {
  const items = [];
  const seen = new Set();
  let skipped = 0;
  let pages = 0;
  for (const { path, kind } of INDEXES) {
    const prefix = path.split('/')[1];
    const queue = [path];
    const visited = new Set();
    while (queue.length && visited.size < Math.ceil(maxPages / INDEXES.length)) {
      const p = queue.shift();
      if (visited.has(p)) continue;
      visited.add(p);
      let body;
      try {
        ({ body } = await fetchText(ORIGIN + p));
      } catch (err) {
        if (err instanceof RobotsDisallowedError) { skipped++; continue; }
        if (visited.size === 1 && !items.length) throw err;
        log(`roomster: index page failed (${err.name})`);
        continue;
      }
      pages++;
      const list = jsonLdBlocks(body).flatMap((b) => b.itemListElement || b.mainEntity?.itemListElement || []);
      const parsed = list.map((li) => parseIndexItem(li, kind)).filter(Boolean);
      const fresh = parsed.filter((l) => !seen.has(l.sourceId));
      fresh.forEach((l) => seen.add(l.sourceId));
      items.push(...fresh);
      log(`roomster: ${prefix} index ${visited.size} -> ${list.length} items, ${parsed.length} offers, ${fresh.length} new`);
      for (const next of neighborhoodIndexLinks(body, prefix)) if (!visited.has(next) && !queue.includes(next)) queue.push(next);
    }
  }
  if (skipped) log(`roomster: ${skipped} index page(s) skipped — disallowed by robots.txt`);
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
        log(`roomster: detail failed (${err.name})`);
      }
    }
    out.push(fillFromText(item, item.description));
  }
  const inArea = out.filter((l) => !l.outOfArea);
  log(`roomster: ${items.length} offers from ${pages} index pages, ${enriched} enriched from detail pages, ${skippedOverBudget} over budget (not fetched), ${out.length - inArea.length} outside NYC dropped`);
  return inArea;
}
