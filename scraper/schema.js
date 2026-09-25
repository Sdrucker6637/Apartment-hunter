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

export const LISTING_TYPES = ['ROOM_IN_SHARED_APARTMENT', 'ENTIRE_APARTMENT', 'SUBLET', 'LEASE_TAKEOVER', 'UNKNOWN'];

// Counts of people must be STATED by the listing. An inferred count (e.g.
// bedrooms − 1, or "family of 3") looks plausible and is often wrong, so it
// is refused here for every source.
const NEVER_INFER = ['roommates', 'totalPeople'];

// Price model. `share` is what YOU would pay each month; it is only ever set
// from a stated per-person/room price, a whole-unit rent for a studio/1BR
// taken over entirely, or total ÷ people when the listing states an even split.
function priceModel(partial) {
  const p = partial.price || {};
  const share = p.monthly ?? null;
  const shareBasis = share == null ? null : (partial.priceConfidence === 'likely' ? 'likely' : p.basis ?? null);
  const total = partial.totalRent?.value ?? (p.type === 'whole_unit' ? share : null);
  const totalBasis = partial.totalRent?.value != null ? partial.totalRent.basis : (p.type === 'whole_unit' ? p.basis : null);
  let split = null;
  if (p.type === 'whole_unit') split = 'whole_unit';
  else if (share != null && p.basis === 'calculated') split = 'even_split_stated';
  else if (share != null && total != null && share !== total) split = 'room_price_stated';
  return {
    share,
    shareMax: share == null ? null : (p.max ?? share),
    shareBasis,        // structured | explicit | calculated | likely | null
    total,             // whole-apartment monthly rent, when stated
    totalBasis,
    split,             // whole_unit | even_split_stated | room_price_stated | null
    status: share != null ? 'known' : total != null ? 'needs_confirmation' : 'not_listed',
  };
}

// Builds a normalized listing from an adapter's partial output, filling
// every field so the frontend can rely on the shape.
export function normalizeListing(partial, { scrapedAt = new Date().toISOString(), dataKind = 'REAL' } = {}) {
  const f = (k) => {
    const v = partial[k] ?? { value: null, basis: null };
    return NEVER_INFER.includes(k) && v.basis === 'inferred' ? { value: null, basis: null } : v;
  };
  const photos = (partial.photos || []).filter((p) => p && /^https:\/\//.test(p.url));
  const type = partial.listingType?.value && LISTING_TYPES.includes(partial.listingType.value) ? partial.listingType : { value: 'UNKNOWN', basis: null };
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

    listingType: type,                  // { value: LISTING_TYPES[i], basis }
    price: priceModel(partial),
    bedrooms: f('bedrooms'),            // bedrooms in the whole apartment (0 = studio)
    bathrooms: f('bathrooms'),
    availableRooms: f('availableRooms'),
    roommates: f('roommates'),          // people already living there you'd join — stated only
    totalPeople: f('totalPeople'),
    moveIn: f('moveIn'),                // value: { date: 'YYYY-MM-DD', text }
    leaseLength: f('leaseLength'),      // value: text, e.g. "12 months", "flexible"
    neighborhood: f('neighborhood'),
    borough: f('borough'),
    location: partial.location ?? null, // { lat, lng, precision } only if the source publishes it
    furnished: f('furnished'),          // true / false
    roomType: f('roomType'),            // 'private' | 'shared'
    bathroomType: f('bathroomType'),    // 'private' | 'shared'
    laundry: f('laundry'),              // 'in_unit' | 'in_building' | 'none'
    pets: f('pets'),                    // text
    utilitiesIncluded: f('utilitiesIncluded'),
    genderPreference: f('genderPreference'),
    agePreference: f('agePreference'),
    postedBy: f('postedBy'),            // 'company' | 'broker' when the listing says so
    lister: f('lister'),                // 'lives_here' | 'moving_out' | 'not_living_here' | 'moving_in' (source's own field)

    contact: { url: partial.contactUrl || partial.originalUrl, method: partial.contactMethod || null },
    contactEmails: partial.contactEmails || [],
    contactPhones: partial.contactPhones || [],
    address: partial.address || null,
    postType: partial.postType || 'offering',
    postedAt: partial.postedAt ?? null,
    postedAtApproximate: !!partial.postedAtApproximate,
    sourceUpdatedAt: partial.sourceUpdatedAt ?? null, // when the source says the listing was last edited
    scrapedAt,

    photos: photos.map((p, i) => ({
      url: p.url,                        // full-size (or largest available)
      thumb: p.thumb || p.url,           // card-sized when the source offers one
      caption: p.caption || null,        // e.g. "Shared space in this apartment"
      isPrimary: i === 0,
      source: partial.source,
      fromListing: true,
      validation: 'unchecked',           // → 'ok' | 'failed' after scraper/photos.js
      expiresAt: p.expiresAt || null,    // signed CDN links (e.g. Facebook) stop working after this
    })),
    photoCount: photos.length,
    photoStatus: photos.length ? 'available' : (partial.photoStatus || 'none'), // available | source_only | none
  };
}
