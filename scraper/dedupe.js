// Cross-source duplicate detection for normalized listings.
// Two listings are the same apartment when a strong signal matches
// (same source id, same canonical URL, a shared photo, shared contact) or
// when several weaker signals agree (price, bedrooms, neighborhood and
// description text similarity).

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

// Returns { same: boolean, reason } for two normalized listings.
export function compare(a, b) {
  if (a.id === b.id) return { same: true, reason: 'same source id' };
  const ua = canonicalUrl(a.originalUrl);
  if (ua && ua === canonicalUrl(b.originalUrl)) return { same: true, reason: 'same URL' };
  const pa = new Set(a.photos.map((p) => photoKey(p.url)).filter(Boolean));
  if (b.photos.some((p) => pa.has(photoKey(p.url)))) return { same: true, reason: 'shared photo' };
  const ca = contacts(a);
  const sharedContact = [...contacts(b)].some((c) => ca.has(c));

  const priceA = a.price.monthly;
  const priceB = b.price.monthly;
  const samePrice = priceA != null && priceB != null && Math.abs(priceA - priceB) <= 25;
  const sameBeds = a.bedrooms.value != null && a.bedrooms.value === b.bedrooms.value;
  const sameHood = a.neighborhood.value != null && a.neighborhood.value === b.neighborhood.value;
  const sim = textSimilarity(`${a.title} ${a.description}`, `${b.title} ${b.description}`);

  if (sharedContact && (samePrice || sameHood)) return { same: true, reason: 'shared contact + price/neighborhood' };
  if (sim >= 0.6) return { same: true, reason: `text ${sim.toFixed(2)}` };
  if (sim >= 0.35 && samePrice && (sameBeds || sameHood)) return { same: true, reason: `text ${sim.toFixed(2)} + price + beds/neighborhood` };
  return { same: false, reason: null };
}

// Merges duplicates into one listing that links to every source.
// Photos are combined only across a strong match (shared photo/URL/id).
export function dedupe(listings) {
  const groups = [];
  for (const l of [...listings].sort((x, y) => new Date(y.postedAt || 0) - new Date(x.postedAt || 0))) {
    let placed = false;
    for (const g of groups) {
      const { same, reason } = compare(g.primary, l);
      if (!same) continue;
      g.members.push({ listing: l, reason });
      placed = true;
      break;
    }
    if (!placed) groups.push({ primary: l, members: [] });
  }
  return groups.map(({ primary, members }) => {
    if (!members.length) return primary;
    const merged = { ...primary, sources: [...primary.sources], photos: [...primary.photos], duplicateReasons: [] };
    const seenPhotos = new Set(merged.photos.map((p) => photoKey(p.url) || p.url));
    for (const { listing, reason } of members) {
      for (const s of listing.sources) {
        if (!merged.sources.some((x) => x.url === s.url)) merged.sources.push(s);
      }
      merged.duplicateReasons.push({ id: listing.id, reason });
      const strong = /same source id|same URL|shared photo/.test(reason);
      if (strong) {
        for (const p of listing.photos) {
          const k = photoKey(p.url) || p.url;
          if (!seenPhotos.has(k)) { seenPhotos.add(k); merged.photos.push({ ...p, isPrimary: false }); }
        }
      }
      // Fill fields the primary lacks from the duplicate.
      for (const k of ['bedrooms', 'roommates', 'moveIn', 'neighborhood', 'borough', 'laundry', 'furnished', 'roomType', 'totalRent']) {
        if (merged[k]?.value == null && listing[k]?.value != null) merged[k] = listing[k];
      }
      if (merged.price.monthly == null && listing.price.monthly != null) merged.price = listing.price;
    }
    merged.photoStatus = merged.photos.length ? 'available' : merged.photoStatus;
    return merged;
  });
}
