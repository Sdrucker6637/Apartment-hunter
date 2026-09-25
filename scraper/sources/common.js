// Helpers shared by source adapters.
import { extractText } from '../extract.js';
import { parseListing } from '../parse.js';
import { field } from '../schema.js';
import { boroughFromCoords } from '../geo.js';

// NJ places commonly searched alongside NYC; other out-of-area listings are dropped.
export const NEARBY_NJ = /jersey city|hoboken|union city|weehawken|west new york|north bergen/i;

// Applies the shared text extractor (scraper/extract.js) to fields the
// structured data didn't give.
export function fillFromText(listing, text) {
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


// Shared mapping for free-text posts (Reddit, Facebook Groups): the
// conservative price rules, stated-only roommates, explicit listing types.
// Returns null for posts that are someone SEEKING housing.
export function textPostListing({ title = '', body = '', flair = '', postedAt = null }) {
  const p = parseListing({ title, body, flair, postedAt });
  if (p.postType === 'seeking') return null;
  const basis = (b) => (b ? 'explicit' : null);
  const x = extractText({ title, text: body });
  return {
    title,
    description: body,
    postType: p.postType,
    price: p.price != null ? { monthly: p.price, max: p.priceMax, type: p.priceType, basis: p.priceBasis === 'likely' ? 'explicit' : p.priceBasis } : { monthly: null, type: p.priceType, basis: null },
    priceConfidence: p.priceBasis, // 'likely' kept separately so the UI can show "probably your share"
    totalRent: field(p.totalRent, 'explicit'),
    bedrooms: field(p.bedrooms, 'explicit'),
    bathrooms: field(p.bathrooms, 'explicit'),
    availableRooms: field(p.roomsAvailable, 'explicit'),
    roommates: field(p.roommatesSource === 'stated' ? p.roommates : null, 'explicit'),
    listingType: field(p.listingType, 'explicit'),
    furnished: field(x.furnished, 'explicit'),
    utilitiesIncluded: field(x.utilitiesIncluded, 'explicit'),
    postedBy: field(x.postedBy, 'explicit'),
    moveIn: field(p.moveIn, basis(p.moveIn)),
    neighborhood: field(p.neighborhood, basis(p.neighborhood)),
    borough: field(p.borough, p.borough ? (p.neighborhood ? 'calculated' : 'explicit') : null),
    laundry: x.laundry === 'on_site' ? field('on_site', 'explicit') : field(p.laundry && p.laundry.replace('-', '_'), 'explicit'),
    contactEmails: p.contacts.emails,
    contactPhones: p.contacts.phones,
    postedAt,
  };
}
