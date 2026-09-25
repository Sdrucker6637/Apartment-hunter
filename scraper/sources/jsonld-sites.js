// Diggz and Roomies.com both publish NYC room listings as schema.org JSON-LD
// on their public index pages (verified 2026-09-25 by probe). Their terms
// pages sit behind a Cloudflare challenge, so we could NOT confirm whether
// automated access is allowed. These adapters are therefore DISABLED unless
// the owner confirms the terms and sets ENABLE_SOURCES=diggz,roomies.

import { fetchText, jsonLdBlocks, decodeEntities } from '../http.js';
import { parseListing } from '../parse.js';
import { findNeighborhood } from '../neighborhoods.js';
import { field } from '../schema.js';

export const SITES = {
  diggz: {
    meta: {
      id: 'diggz',
      name: 'Diggz',
      kind: 'Rooms offered by individuals',
      access: 'Public index has JSON-LD; terms unverified (Cloudflare challenge on terms page)',
      photos: 'Direct from listing (diggz-pron.s3.amazonaws.com), hotlink-accessible in probe',
    },
    index: 'https://www.diggz.co/rooms-for-rent/new-york-ny',
  },
  roomies: {
    meta: {
      id: 'roomies',
      name: 'Roomies.com',
      kind: 'Rooms offered by individuals',
      access: 'Public index has JSON-LD; terms unverified (Cloudflare challenge on terms page)',
      photos: 'Direct from listing (cloudinary.roomies.pics), hotlink-accessible in probe',
    },
    index: 'https://www.roomies.com/rooms/new-york-ny',
  },
};

export function parseItem(siteId, listItem) {
  const item = listItem.item || listItem;
  const url = item.url;
  if (!url) return null;
  const offer = item.offers || {};
  const price = Number(offer.price ?? offer.priceSpecification?.price);
  const about = item.about || {};
  const title = decodeEntities(item.name || '').split(' | ')[0];
  const description = decodeEntities(item.description || item.name || '');
  const place = item.areaServed?.name || item.areaServed?.address?.addressLocality || '';
  const region = item.areaServed?.address?.addressRegion;
  if (region && region !== 'NY') return null; // Diggz mixes in New Jersey
  const hood = findNeighborhood(place, item.name, description);
  const p = parseListing({ title, body: description });
  const avail = offer.availabilityStarts && !/^19/.test(offer.availabilityStarts) ? offer.availabilityStarts.slice(0, 10) : null;
  const img = [].concat(item.image || []).map((i) => (typeof i === 'string' ? i : i.url)).filter(Boolean);
  return {
    source: siteId,
    sourceId: /(\d+|us_[a-z0-9]+)\/?$/.exec(url)?.[1] || url,
    sourceLabel: SITES[siteId].meta.name,
    originalUrl: url,
    title,
    description,
    price: Number.isFinite(price) && price > 0 ? { monthly: price, max: price, type: 'room_share', basis: 'structured' } : undefined,
    bedrooms: field(about.numberOfBedrooms ?? p.bedrooms, about.numberOfBedrooms != null ? 'structured' : 'explicit'),
    bathrooms: field(about.numberOfBathroomsTotal ?? p.bathrooms, about.numberOfBathroomsTotal != null ? 'structured' : 'explicit'),
    roommates: field(p.roommates, p.roommatesSource === 'stated' ? 'explicit' : 'inferred'),
    furnished: field(/furnished/i.test(item.name || '') ? true : null, 'explicit'),
    pets: field(about.petsAllowed != null ? (about.petsAllowed ? 'Pets allowed' : 'No pets') : null, 'structured'),
    roomType: field('private', 'inferred'),
    moveIn: field(avail ? { date: avail, text: avail } : null, 'structured'),
    neighborhood: field(hood.neighborhood, hood.neighborhood ? 'structured' : null),
    borough: field(hood.borough, hood.borough ? 'inferred' : null),
    laundry: field(p.laundry && p.laundry.replace('-', '_'), 'explicit'),
    location: about.latitude ? { lat: about.latitude, lng: about.longitude, precision: 'approximate' } : null,
    contactUrl: url,
    contactMethod: `${SITES[siteId].meta.name} message (account required)`,
    photos: img.map((u) => ({ url: u })),
    postedAt: item.datePosted || null,
  };
}

export async function fetchListings(siteId, { log = () => {} } = {}) {
  const { body } = await fetchText(SITES[siteId].index);
  const list = jsonLdBlocks(body).flatMap((b) => b.itemListElement || b.mainEntity?.itemListElement || []);
  const out = list.map((li) => parseItem(siteId, li)).filter(Boolean);
  log(`${siteId}: ${list.length} items, ${out.length} in NY`);
  return out;
}
