// Cross-source duplicate detection for normalized listings. See compare()
// for the evidence rules; merged listings keep every original source URL.

const STOP = new Set('the a an and or of in to for with is are on at this that my our your we i you it be room apartment apt available'.split(' '));

export function canonicalUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref|fbclid|gclid|source)/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return null;
  }
}

// Photo identity ignores resizing params and CDN size segments.
export function photoKey(url) {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').pop().replace(/\.(large|medium|small|featured|thumb)(?=\.)/i, '').replace(/\.(jpe?g|png|webp)$/i, '');
    return file.length >= 8 ? file.toLowerCase() : null;
  } catch {
    return null;
  }
}

function shingles(text, n = 3) {
  const words = (text || '').toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function textSimilarity(a, b) {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

const contacts = (l) => new Set([...(l.contactEmails || []), ...(l.contactPhones || [])].map((c) => c.toLowerCase()));

// "123 W. 45th Street, Apt 4B" → "123 w 45 st". Unit numbers are dropped:
// a building holds many units, so an address match is supporting evidence only.
export function normalizeAddress(addr) {
  if (!addr) return null;
  const s = String(addr).toLowerCase()
    .replace(/\b(?:apt|apartment|unit|suite|ste|fl|floor|room|rm)\b\.?\s*#?\s*[\w-]+/g, ' ')
    .replace(/#\s*[\w-]+/g, ' ')
    .replace(/,.*$/, '')
    .replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1')
    .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\bplace\b/g, 'pl').replace(/\broad\b/g, 'rd')
    .replace(/\bboulevard\b/g, 'blvd').replace(/\bparkway\b/g, 'pkwy').replace(/\bdrive\b/g, 'dr').replace(/\blane\b/g, 'ln')
    .replace(/\bwest\b/g, 'w').replace(/\beast\b/g, 'e').replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^\d+[a-z]?(?:-\d+)? \S+/.test(s) ? s : null; // needs a house number + street
}

function metersBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const KIND = { ROOM_IN_SHARED_APARTMENT: 'room', SUBLET: 'either', LEASE_TAKEOVER: 'either', ENTIRE_APARTMENT: 'whole' };
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const close = (x, y, tol) => Math.abs(x - y) <= Math.max(25, Math.max(x, y) * tol);

// Facts two listings state differently. Any conflict vetoes a merge that
// isn't backed by the same URL, id or photo.
export function conflicts(a, b) {
  const out = [];
  if (a.bedrooms.value != null && b.bedrooms.value != null && a.bedrooms.value !== b.bedrooms.value) out.push('bedrooms differ');
  const ka = KIND[a.listingType.value];
  const kb = KIND[b.listingType.value];
  if (ka && kb && ka !== 'either' && kb !== 'either' && ka !== kb) out.push('room vs entire apartment');
  if (a.price.share != null && b.price.share != null && !close(a.price.share, b.price.share, 0.1)) out.push('your share differs');
  if (a.price.total != null && b.price.total != null && !close(a.price.total, b.price.total, 0.1)) out.push('total rent differs');
  if (a.borough.value && b.borough.value && a.borough.value !== b.borough.value) out.push('borough differs');
  const ma = a.moveIn.value?.date;
  const mb = b.moveIn.value?.date;
  if (ma && mb && dayDiff(ma, mb) > 45) out.push('move-in dates far apart');
  return out;
}

// Returns { same, reason, evidence } for two normalized listings.
// `uniqueIdSources`: sources whose IDs are always distinct units (adapter
// meta `uniqueIds: true`), so two IDs from them are never merged.
//
// Across sources the rule is: an identity signal (same URL / shared photo)
// merges on its own; otherwise we need at least 4 points of evidence that
// include something SPECIFIC to the listing (description text, contact,
// street address, map position). Generic facts alone — price, bedrooms,
// neighborhood, move-in — never merge two listings, however many agree.
export function compare(a, b, { uniqueIdSources = new Set() } = {}) {
  if (a.id === b.id) return { same: true, reason: 'same source id', evidence: ['same source id'] };
  if (a.source === b.source) {
    // Within one source, only merge reposts: near-identical text at the same price.
    if (uniqueIdSources.has(a.source)) return { same: false, reason: null };
    const sim = textSimilarity(`${a.title} ${a.description}`, `${b.title} ${b.description}`);
    const priceA = a.price.share ?? a.price.total;
    const priceB = b.price.share ?? b.price.total;
    if (sim >= 0.95 && priceA === priceB) return { same: true, reason: `repost (text ${sim.toFixed(2)}, same price)`, evidence: ['repost'] };
    return { same: false, reason: null };
  }
  const ua = canonicalUrl(a.originalUrl);
  if (ua && ua === canonicalUrl(b.originalUrl)) return { same: true, reason: 'same URL', evidence: ['same URL'] };
  const vetoes = conflicts(a, b);
  const pa = new Set(a.photos.map((p) => photoKey(p.url)).filter(Boolean));
  if (b.photos.some((p) => pa.has(photoKey(p.url))) && !vetoes.length) return { same: true, reason: 'shared photo', evidence: ['shared photo'] };
  if (vetoes.length) return { same: false, reason: null, vetoes };

  const evidence = [];
  let score = 0;
  let specific = false;
  let unitSpecific = false; // evidence about THIS listing, not just its building
  const add = (pts, label, isSpecific = false, isUnit = true) => {
    score += pts; evidence.push(label);
    if (isSpecific) { specific = true; if (isUnit) unitSpecific = true; }
  };

  const sim = textSimilarity(`${a.title} ${a.description}`, `${b.title} ${b.description}`);
  if (sim >= 0.6) add(4, `description ${sim.toFixed(2)} similar`, true);
  else if (sim >= 0.35) add(2, `description ${sim.toFixed(2)} similar`, true);
  else if (sim >= 0.2) add(1, `description ${sim.toFixed(2)} similar`, true);
  const ca = contacts(a);
  if ([...contacts(b)].some((c) => ca.has(c))) add(3, 'same contact', true);
  const na = normalizeAddress(a.address);
  if (na && na === normalizeAddress(b.address)) add(2, 'same street address', true, false);
  if (a.location && b.location) {
    const m = metersBetween(a.location, b.location);
    if (m <= 120) add(2, `map pins ${Math.round(m)} m apart`, true, false);
  }
  if (a.price.share != null && b.price.share != null && close(a.price.share, b.price.share, 0.02)) add(1, 'same share');
  else if (a.price.total != null && b.price.total != null && close(a.price.total, b.price.total, 0.02)) add(1, 'same total');
  if (a.bedrooms.value != null && a.bedrooms.value === b.bedrooms.value) add(1, 'same bedrooms');
  if (a.neighborhood.value && a.neighborhood.value === b.neighborhood.value) add(1, 'same neighborhood');
  const ma = a.moveIn.value?.date;
  const mb = b.moveIn.value?.date;
  if (ma && mb && dayDiff(ma, mb) <= 7) add(1, 'same move-in week');

  // buildingOnly: the specific evidence locates the building, not the unit;
  // dedupe() then refuses the merge when that building holds several units.
  if (specific && score >= 4) return { same: true, reason: evidence.join(' + '), evidence, buildingOnly: !unitSpecific };
  return { same: false, reason: null, evidence };
}

// Merges duplicates into one listing that links to every source.
// Photos are combined only across a strong match (shared photo/URL/id).
const sameBuilding = (x, y) => {
  const nx = normalizeAddress(x.address);
  if (nx && nx === normalizeAddress(y.address)) return true;
  return !!(x.location && y.location && metersBetween(x.location, y.location) <= 120);
};

export function dedupe(listings, opts = {}) {
  const uniqueIdSources = opts.uniqueIdSources || new Set();
  const groups = [];
  for (const l of [...listings].sort((x, y) => new Date(y.postedAt || 0) - new Date(x.postedAt || 0))) {
    let placed = false;
    for (const g of groups) {
      const r = compare(g.primary, l, opts);
      if (!r.same) continue;
      const all = [g.primary, ...g.members.map((m) => m.listing)];
      // Never put two different units of a unique-ID source in one group.
      if (uniqueIdSources.has(l.source) && all.some((x) => x.source === l.source && x.id !== l.id)) continue;
      // Building-level evidence only: ambiguous if either source has several units in that building.
      if (r.buildingOnly) {
        const units = (src, ref) => listings.filter((x) => x.source === src && sameBuilding(x, ref)).length;
        if (units(l.source, g.primary) > 1 || units(g.primary.source, l) > 1) continue;
      }
      g.members.push({ listing: l, reason: r.reason });
      placed = true;
      break;
    }
    if (!placed) groups.push({ primary: l, members: [] });
  }
  return groups.map(({ primary, members }) => {
    if (!members.length) return { ...primary, sourceCount: 1 };
    const merged = { ...primary, sources: [...primary.sources], photos: [...primary.photos], duplicateReasons: [] };
    const seenPhotos = new Set(merged.photos.map((p) => photoKey(p.url) || p.url));
    for (const { listing, reason } of members) {
      for (const s of listing.sources) {
        if (!merged.sources.some((x) => x.url === s.url)) merged.sources.push(s);
      }
      merged.duplicateReasons.push({ id: listing.id, reason });
      const strong = /same source id|same URL|shared photo|repost/.test(reason);
      if (strong) {
        for (const p of listing.photos) {
          const k = photoKey(p.url) || p.url;
          if (!seenPhotos.has(k)) { seenPhotos.add(k); merged.photos.push({ ...p, isPrimary: false }); }
        }
      }
      // Fill fields the primary lacks from the duplicate.
      for (const k of ['bedrooms', 'roommates', 'moveIn', 'neighborhood', 'borough', 'laundry', 'furnished', 'roomType']) {
        if (merged[k]?.value == null && listing[k]?.value != null) merged[k] = listing[k];
      }
      if (merged.price.share == null && listing.price.share != null) merged.price = listing.price;
      if (merged.listingType.value === 'UNKNOWN' && listing.listingType.value !== 'UNKNOWN') merged.listingType = listing.listingType;
    }
    merged.photoStatus = merged.photos.length ? 'available' : merged.photoStatus;
    merged.photoCount = merged.photos.length;
    merged.sourceCount = new Set(merged.sources.map((s) => s.source)).size;
    return merged;
  });
}
