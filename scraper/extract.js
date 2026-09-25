// Text extraction layer shared by every source adapter. Deterministic rules
// only (see parse.js), plus generic labeled fields that many listing sites
// render ("Bedrooms: 2", "Furnished: No", an "Amenities" list).
//
// This is the single place a different extractor (e.g. an LLM) could be
// swapped in later: it takes { title, text } and returns the same shape.

import { parseListing } from './parse.js';

const LABEL = (name, value = '([^\\n|]{1,40}?)') => new RegExp(`\\b${name}:\\s*${value}(?=\\s+[A-Z][a-z]+(?:\\s[A-Z]?[a-z]+)?:|\\s*$|\\s{2,}|\\s+(?:Send Message|Save|Amenities))`, 'i');

function amenitiesList(text) {
  const m = /\bAmenities\s+((?:[A-Z][\w/&-]*(?:\s[A-Za-z][\w/&-]*){0,3}\s*){1,40})/.exec(text);
  return m ? m[1] : '';
}

function furnishedFrom(text) {
  const t = text.replace(/furnished common (?:areas?|spaces?)/gi, '');
  const label = /\bFurnished:\s*(Yes|No)\b/i.exec(t);
  if (label) return /yes/i.test(label[1]);
  if (/\bcan be furnished or not\b|\bfurnished or unfurnished\b|furnishing status may/i.test(t)) return null;
  if (/\bunfurnished\b|\bnot furnished\b/i.test(t)) return false;
  if (/\b(?:fully|partially|comes|is|room|apartment|apt)\s+furnished\b|\bfurnished\s+(?:private\s+)?(?:room|bedroom|apartment|apt|studio|with)\b|^furnished\b/im.test(t)) return true;
  return null;
}

export function extractText({ title = '', text = '', postedAt = null } = {}) {
  const all = `${title}\n${text}`;
  const p = parseListing({ title, body: text, postedAt });

  let bedrooms = p.bedrooms;
  const bedLabel = /\bBedrooms?:\s*(\d+|studio)\b/i.exec(all);
  if (bedLabel) bedrooms = /studio/i.test(bedLabel[1]) ? 0 : +bedLabel[1];
  const bathLabel = /\bBathrooms?:\s*(\d+(?:\.\d)?)/i.exec(all);

  let laundry = p.laundry ? p.laundry.replace('-', '_') : null;
  if (!laundry && /laundry[^.()]{0,30}\(in[- ]building\)/i.test(all)) laundry = 'in_building';
  const amen = amenitiesList(all);
  if (!laundry && /\b(?:Laundry|Washer)\b/.test(amen)) laundry = 'on_site';
  // Comma-separated amenity lists: "Elevator, Laundry, Dishwasher, Washer"
  if (!laundry && /(?:^|,\s*)(?:Laundry|Washer(?:\s*\/\s*Dryer)?|Washer\s*&\s*Dryer)\s*(?=,)/m.test(all)) laundry = 'on_site';

  const utilities = /\bnot included\b/i.test(/utilities[^.]{0,30}/i.exec(all)?.[0] || '')
    ? false
    : /\b(?:all\s+)?utilities\s*(?:are\s+|:\s*)?included\b|\butilities included\b/i.test(all) ? true : null;

  const postedBy = /licensed real estate broker|\bbrokerage\b|\bbroker fee\b/i.test(all) ? 'broker'
    : /\bspeak to a june representative\b|\bleasing office\b|\bmanagement company\b|\buse code [A-Z0-9]{4,}\b|\bour team of\b|\bresidents? (?:enjoy|with)\b/i.test(all) ? 'company' : null;

  return {
    seeking: p.postType === 'seeking',
    postType: p.postType,
    listingType: p.listingType,
    share: p.price,
    shareMax: p.priceMax,
    shareBasis: p.priceBasis,
    priceType: p.priceType,
    total: p.totalRent,
    bedrooms,
    bedroomsLabeled: !!bedLabel,
    bathrooms: bathLabel ? +bathLabel[1] : p.bathrooms,
    roomsAvailable: p.roomsAvailable,
    roommates: p.roommatesSource === 'stated' ? p.roommates : null,
    laundry,
    furnished: furnishedFrom(all),
    utilitiesIncluded: utilities,
    moveIn: p.moveIn,
    neighborhood: p.neighborhood,
    borough: p.borough,
    postedBy,
    contacts: p.contacts,
  };
}

export { LABEL, amenitiesList };
