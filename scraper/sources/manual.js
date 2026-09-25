// Listings you paste in by hand (e.g. Facebook group posts, which can't be
// collected automatically). Stored in data/manual.json; `overrides` corrects
// any field the parser got wrong. `photos` may list image URLs you add.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseListing } from '../parse.js';
import { extractText } from '../extract.js';
import { field } from '../schema.js';

export const MANUAL_PATH = new URL('../../data/manual.json', import.meta.url);

export const meta = {
  id: 'manual',
  name: 'Added manually',
  kind: 'Posts you paste in (Facebook groups, group chats…)',
  access: 'You add them; nothing is fetched',
  photos: 'Only photos you attach',
};

export function manualId(entry) {
  return createHash('sha1').update(entry.url || entry.text || '').digest('hex').slice(0, 12);
}

export function detectSource(url = '') {
  if (/facebook\.com|fb\.com|fb\.me/i.test(url)) return 'Facebook';
  if (/reddit\.com|redd\.it/i.test(url)) return 'Reddit';
  if (/craigslist\.org/i.test(url)) return 'Craigslist';
  if (/listingsproject\.com/i.test(url)) return 'Listings Project';
  if (/spareroom\.com/i.test(url)) return 'SpareRoom';
  if (/streeteasy\.com/i.test(url)) return 'StreetEasy';
  return 'Other';
}

export async function readManual() {
  try {
    return JSON.parse(await readFile(MANUAL_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export function manualToListing(entry) {
  const text = entry.text || '';
  const [firstLine, ...rest] = text.split('\n');
  const title = entry.title || firstLine.slice(0, 140);
  const body = entry.title ? text : rest.join('\n');
  const origin = detectSource(entry.url);
  const p = parseListing({ title, body, postedAt: entry.addedAt });
  const ex = (v) => field(v, 'explicit');
  const listing = {
    source: 'manual',
    sourceId: manualId(entry),
    sourceLabel: `${origin} (added manually)`,
    originalUrl: entry.url || null,
    title,
    description: body,
    price: p.price != null ? { monthly: p.price, max: p.priceMax, type: p.priceType, basis: p.priceBasis === 'likely' ? 'explicit' : p.priceBasis } : undefined,
    priceConfidence: p.priceBasis,
    totalRent: ex(p.totalRent),
    bedrooms: ex(p.bedrooms),
    bathrooms: ex(p.bathrooms),
    availableRooms: ex(p.roomsAvailable),
    roommates: field(p.roommatesSource === 'stated' ? p.roommates : null, 'explicit'),
    listingType: field(p.listingType, 'explicit'),
    ...(() => {
      const x = extractText({ title: title, text: body });
      return {
        furnished: field(x.furnished, 'explicit'),
        utilitiesIncluded: field(x.utilitiesIncluded, 'explicit'),
        postedBy: field(x.postedBy, 'explicit'),
        ...(x.laundry === 'on_site' ? { laundry: field('on_site', 'explicit') } : {}),
      };
    })(),
    moveIn: ex(p.moveIn),
    neighborhood: ex(p.neighborhood),
    borough: field(p.borough, p.neighborhood ? 'inferred' : 'explicit'),
    laundry: ex(p.laundry && p.laundry.replace('-', '_')),
    contactUrl: entry.url || null,
    contactMethod: `Via ${origin}`,
    contactEmails: p.contacts.emails,
    contactPhones: p.contacts.phones,
    photos: (entry.photos || []).map((url) => ({ url })),
    photoStatus: entry.url ? 'source_only' : 'none',
    postedAt: entry.postedAt || entry.addedAt || null,
    manual: true,
  };
  const o = entry.overrides || {};
  if (o.price != null) listing.price = { monthly: +o.price, max: +o.price, type: 'room_share', basis: 'explicit' };
  for (const k of ['bedrooms', 'roommates', 'neighborhood', 'borough', 'laundry', 'furnished']) {
    if (o[k] != null && o[k] !== '') listing[k] = field(o[k], 'explicit');
  }
  if (o.moveIn) listing.moveIn = field({ date: o.moveIn, text: o.moveIn }, 'explicit');
  return listing;
}

export async function fetchListings() {
  return (await readManual()).map(manualToListing);
}
