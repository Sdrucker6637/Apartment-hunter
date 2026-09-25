// The one listing shape every source adapter produces. Each extracted field
// records HOW we know it, so the UI never presents a guess as a fact.
//
// Basis values (field provenance):
//   'structured' — taken from the source's own structured data (JSON-LD, API field)
//   'explicit'   — stated in the listing text
//   'calculated' — derived from explicit facts (e.g. total ÷ people when an even split is stated)
//   'inferred'   — our best guess (e.g. roommates = bedrooms − rooms offered)
//   null         — unknown
//
// Source status values (per scraper run):
export const SOURCE_STATUS = [
  'LIVE',                   // fetched and parsed real listings this run
  'LIVE_WITH_LIMITATIONS',  // fetched, but partial data (e.g. no photos, some pages blocked)
  'AUTH_REQUIRED',          // needs credentials we don't have
  'ENVIRONMENT_BLOCKED',    // our runner's network couldn't reach it (not the site's choice)
  'SOURCE_BLOCKED',         // site refused automated requests (403, anti-bot challenge)
  'NO_PUBLIC_ACCESS',       // no permitted access route (terms/robots prohibit, no API)
  'MANUAL_ONLY',            // only via hand-added listings
  'UNVERIFIED',             // adapter exists but hasn't succeeded against live data
];

export const BASIS = ['structured', 'explicit', 'calculated', 'inferred', null];

export function field(value, basis) {
  if (value == null || value === '') return { value: null, basis: null };
  return { value, basis };
}

// Builds a normalized listing from an adapter's partial output, filling
// every field so the frontend can rely on the shape.
export function normalizeListing(partial, { scrapedAt = new Date().toISOString(), dataKind = 'REAL' } = {}) {
  const f = (k) => partial[k] ?? { value: null, basis: null };
  const photos = (partial.photos || []).filter((p) => p && /^https:\/\//.test(p.url));
  return {
    id: `${partial.source}:${partial.sourceId}`,
    dataKind, // 'REAL' from a live source, 'SAMPLE' for fixtures — never mixed in production output
    source: partial.source,
    sourceId: String(partial.sourceId),
    sourceLabel: partial.sourceLabel,
    originalUrl: partial.originalUrl,
    sources: [{ source: partial.source, label: partial.sourceLabel, url: partial.originalUrl, postedAt: partial.postedAt ?? null }],
    title: (partial.title || '').trim(),
    description: (partial.description || '').trim(),

    price: {
      monthly: partial.price?.monthly ?? null,       // what YOU would pay
      max: partial.price?.max ?? partial.price?.monthly ?? null,
      type: partial.price?.type ?? 'unknown',        // room_share | whole_unit | unknown
      basis: partial.price?.basis ?? null,
    },
    totalRent: f('totalRent'),
    bedrooms: f('bedrooms'),
    bathrooms: f('bathrooms'),
    availableRooms: f('availableRooms'),
    roommates: f('roommates'),          // people already living there you'd join
    totalPeople: f('totalPeople'),
    moveIn: f('moveIn'),                // value: { date: 'YYYY-MM-DD', text }
    leaseLength: f('leaseLength'),      // value: text, e.g. "12 months", "flexible"
    neighborhood: f('neighborhood'),
    borough: f('borough'),
    location: partial.location ?? null, // { lat, lng, precision: 'approximate' } only if the source publishes it
    furnished: f('furnished'),          // true / false
    roomType: f('roomType'),            // 'private' | 'shared'
    bathroomType: f('bathroomType'),    // 'private' | 'shared'
    laundry: f('laundry'),              // 'in_unit' | 'in_building' | 'none'
    pets: f('pets'),                    // text
    utilitiesIncluded: f('utilitiesIncluded'),
    genderPreference: f('genderPreference'),
    agePreference: f('agePreference'),

    contact: { url: partial.contactUrl || partial.originalUrl, method: partial.contactMethod || 'source_site' },
    contactEmails: partial.contactEmails || [],
    contactPhones: partial.contactPhones || [],
    address: partial.address || null,
    postType: partial.postType || 'offering',
    listingKind: partial.listingKind || (partial.price?.type === 'whole_unit' ? 'apartment' : 'room'),
    priceConfidence: partial.priceConfidence || partial.price?.basis || null,
    manual: !!partial.manual,
    postedAt: partial.postedAt ?? null,
    scrapedAt,

    photos: photos.map((p, i) => ({
      url: p.url,                        // full-size (or largest available)
      thumb: p.thumb || p.url,           // card-sized when the source offers one
      caption: p.caption || null,
      isPrimary: i === 0,
      source: partial.source,
      fromListing: true,
    })),
    photoStatus: photos.length ? 'available' : (partial.photoStatus || 'none'), // available | source_only | none
  };
}
