// Apartment Hunter front end: one NYC search across every connected source.
// Reads data/listings.json + data/status.json from the scraper (sanitized,
// REAL data in production). Filters, shortlist and hidden listings are
// remembered in this browser only (localStorage).
//
// The UI only presents what the scraper produced. It never computes a share
// from total rent, never infers roommates from bedrooms, and shows unknown
// fields as "not specified".

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const STORE = 'apartment-hunter:v3';
const BOROS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island', 'New Jersey'];
const BORO_VAR = { Manhattan: '--b-manhattan', Brooklyn: '--b-brooklyn', Queens: '--b-queens', Bronx: '--b-bronx', 'Staten Island': '--b-staten', 'New Jersey': '--b-nj' };
const BORO_SHORT = { Manhattan: 'Manhattan', Brooklyn: 'Brooklyn', Queens: 'Queens', Bronx: 'The Bronx', 'Staten Island': 'Staten Island', 'New Jersey': 'New Jersey' };
const TYPES = [
  ['ROOM_IN_SHARED_APARTMENT', 'Rooms', 'Room in a shared apartment'],
  ['ENTIRE_APARTMENT', 'Entire places', 'Entire apartment'],
  ['SUBLET', 'Sublets', 'Sublet'],
  ['LEASE_TAKEOVER', 'Lease takeovers', 'Lease takeover'],
];
const TYPE_PLURAL = { ROOM_IN_SHARED_APARTMENT: ['room', 'rooms'], ENTIRE_APARTMENT: ['entire place', 'entire places'], SUBLET: ['sublet', 'sublets'], LEASE_TAKEOVER: ['lease takeover', 'lease takeovers'], UNKNOWN: ['listing', 'listings'] };
const LAUNDRY = { in_unit: 'Washer/dryer in unit', in_building: 'Laundry in building', on_site: 'Laundry on site', none: 'No laundry on site' };
const LAUNDRY_SHORT = { in_unit: 'W/D in unit', in_building: 'Laundry in bldg', on_site: 'Laundry on site', none: 'No laundry' };
const LISTER = { lives_here: 'Lives there and stays', moving_out: 'Lives there, moving out', not_living_here: "Doesn't live there", moving_in: 'Moving in soon' };

const DEFAULTS = {
  types: [], maxPrice: null, boros: [], hoods: [], moveBy: '', roommates: [], bedrooms: [],
  toggles: [], sources: null, q: '', roomType: 'any', postedBy: 'any',
  includeUnknown: false, showHidden: false, savedOnly: false, sort: 'price-asc',
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- persistence (same key and shape as before) ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
const stored = loadStore();
const state = {
  f: { ...structuredClone(DEFAULTS), ...(stored.f || {}) },
  saved: new Set(stored.saved || []),
  hidden: new Set(stored.hidden || []),
  listings: [], byId: new Map(), status: null, dataKind: 'REAL', maxShare: 1700,
  view: 'browse', loaded: false, loadError: false,
};
// Views replace the old "saved only" / "show hidden" toggles.
state.f.savedOnly = false;
state.f.showHidden = false;
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify({ f: state.f, saved: [...state.saved], hidden: [...state.hidden] })); } catch { /* storage unavailable */ }
}

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const icon = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const boroVar = (b) => `var(${BORO_VAR[b] || '--b-unknown'})`;
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function fmtDate(v, { long = false } = {}) {
  if (!v?.date) return null;
  const d = new Date(`${v.date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return v.text;
  if (d.getTime() < Date.now()) return 'Now';
  return d.toLocaleDateString('en-US', { month: long ? 'long' : 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
const sourceMeta = (id) => state.status?.sources?.find((s) => s.id === id);
const sourceName = (id) => sourceMeta(id)?.name || id;
// Source labels look like "Facebook · <group name>" or "Roomster".
function splitLabel(label) {
  const [platform, ...rest] = String(label || '').split(' · ');
  return { platform, detail: rest.join(' · ') || null };
}
const platformOf = (l) => splitLabel(l.sources[0]?.label || l.sourceLabel).platform;
const sourceNames = (l) => [...new Set(l.sources.map((s) => s.label))];

// Provenance labels shown next to facts.
function basisLabel(basis, l) {
  if (basis === 'structured') return [`Stated by ${platformOf(l)}`, 'stated'];
  if (basis === 'explicit') return ['Stated in listing', 'stated'];
  if (basis === 'calculated') return ['Calculated', 'calc'];
  if (basis === 'inferred') return ['Estimated', 'est'];
  if (basis === 'likely') return ['Likely your share', 'likely'];
  return ['Not stated', 'unknown'];
}
const chip = (basis, l) => { const [t, c] = basisLabel(basis, l); return `<span class="basis ${c}">${esc(t)}</span>`; };

// ---------- how a listing reads ----------
function typeLabel(l) {
  const t = l.listingType.value;
  const beds = l.bedrooms.value;
  if (t === 'ROOM_IN_SHARED_APARTMENT') return l.availableRooms.value > 1 ? `${l.availableRooms.value} rooms` : 'Room';
  if (t === 'ENTIRE_APARTMENT') return beds === 0 ? 'Entire studio' : beds ? `Entire ${beds}BR` : 'Entire place';
  if (t === 'SUBLET') return 'Sublet';
  if (t === 'LEASE_TAKEOVER') return 'Lease takeover';
  return 'Listing';
}

// The price as a person would read it. Tone 'ok' = stated share,
// 'caution' = needs confirmation, 'none' = no price.
function priceInfo(l) {
  const p = l.price;
  if (p.status === 'known' && p.share != null) {
    const range = p.shareMax && p.shareMax !== p.share;
    const amount = range ? `${money(p.share)}–${money(p.shareMax).slice(1)}` : money(p.share);
    let note;
    let tone = 'ok';
    if (p.split === 'whole_unit') note = 'Whole place · you pay the full rent';
    else if (p.split === 'even_split_stated') note = `Your share · even split of ${money(p.total)}`;
    else if (p.split === 'room_price_stated') note = `Your room · ${money(p.total)} total`;
    else if (p.shareBasis === 'likely') { note = range ? 'Likely your share · rooms vary · confirm' : 'Likely your share · confirm with poster'; tone = 'caution'; }
    else if (p.shareBasis === 'inferred') { note = 'Estimated share · confirm with poster'; tone = 'caution'; }
    else note = range ? 'Your share · rooms at different prices' : 'Your share';
    return { amount, per: '/mo', note, tone };
  }
  if (p.status === 'needs_confirmation' && p.total != null) {
    return { amount: money(p.total), per: '/mo total', note: 'Total rent · your share not specified', tone: 'caution' };
  }
  return { amount: null, per: '', note: 'Price not listed · ask the poster', tone: 'none' };
}

function apartmentText(l) {
  const beds = l.bedrooms.value;
  const baths = l.bathrooms.value;
  if (beds == null) return null;
  const size = beds === 0 ? 'studio' : `${beds}BR`;
  const bath = baths ? ` · ${baths} bath${baths === 1 ? '' : 's'}${l.bathroomType.value === 'shared' ? ' (shared)' : ''}` : '';
  if (l.listingType.value === 'ROOM_IN_SHARED_APARTMENT') return `Room in a ${size}${bath}`;
  return `${beds === 0 ? 'Studio' : size}${bath}`;
}

function roommatesText(l) {
  const n = l.roommates.value;
  if (n == null) return null;
  return n === 0 ? 'No current roommates' : plural(n, 'roommate', 'roommates');
}

// Known facts only, in order of importance for a card.
function cardFacts(l) {
  const t = l.listingType.value;
  return [
    apartmentText(l),
    roommatesText(l),
    l.laundry.value ? LAUNDRY_SHORT[l.laundry.value] : null,
    l.furnished.value === true ? 'Furnished' : null,
    l.roomType.value === 'private' && t !== 'ENTIRE_APARTMENT' ? 'Private room' : null,
    l.roomType.value === 'shared' ? 'Shared room' : null,
    l.utilitiesIncluded.value === true ? 'Utilities incl.' : null,
    l.postedBy.value ? (l.postedBy.value === 'broker' ? 'Broker' : 'Company') : null,
  ].filter(Boolean);
}

function placeOf(l) {
  const hood = l.neighborhood.value;
  const boro = l.borough.value;
  return { hood, boro, headline: hood || (boro ? BORO_SHORT[boro] || boro : null), estimated: l.borough.basis === 'inferred' && !hood };
}

// ---------- photos ----------
function photoImg(p, l, i, { eager = false, thumb = true } = {}) {
  const src = thumb ? p.thumb || p.url : p.url;
  const alt = `Photo ${i + 1} of ${l.photos.length}${p.caption ? ` — ${p.caption}` : ''}`;
  const full = src !== p.url ? ` data-full="${esc(p.url)}"` : '';
  return `<img ${eager ? `src="${esc(src)}"` : `data-src="${esc(src)}"`}${full} alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

function noPhoto(l, { link = true } = {}) {
  const url = safeUrl(l.originalUrl);
  const { headline } = placeOf(l);
  return `<div class="nophoto"><span class="nophoto-k">No photos in this post</span>
    <span class="nophoto-place">${esc(headline || 'New York')}</span>
    ${link && url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">See the original post ↗</a>` : ''}</div>`;
}

function media(l) {
  const saved = state.saved.has(l.id);
  const type = `<span class="ph-type">${esc(typeLabel(l))}</span>`;
  const save = `<button type="button" class="save-btn" data-act="save" aria-pressed="${saved}" aria-label="${saved ? 'Remove from shortlist' : 'Save to shortlist'}">${icon(saved ? 'heart-fill' : 'heart')}</button>`;
  const sample = l.dataKind === 'SAMPLE' ? '<span class="ph-type" style="top:auto;bottom:12px;background:var(--caution);color:#fff">SAMPLE</span>' : '';
  if (!l.photos.length) return `<div class="ph">${noPhoto(l)}${type}${save}${sample}</div>`;
  const n = l.photos.length;
  const slides = l.photos.map((p, i) => `<div class="ph-slide">${photoImg(p, l, i, { eager: i === 0 })}</div>`).join('');
  const nav = n > 1 ? `<button type="button" class="ph-nav prev" data-act="prev" aria-label="Previous photo" disabled>${icon('left')}</button><button type="button" class="ph-nav next" data-act="next" aria-label="Next photo">${icon('right')}</button>` : '';
  const bars = n > 1 ? `<div class="ph-bars">${l.photos.slice(0, 8).map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')}</div>` : '';
  return `<div class="ph" data-count="${n}"><div class="ph-track" data-act="open" tabindex="-1">${slides}</div>${type}${save}${sample}${nav}${bars}<span class="ph-count">1 / ${n}</span></div>`;
}

// ---------- card ----------
function sourceLine(l) {
  const { platform, detail } = splitLabel(l.sources[0]?.label || l.sourceLabel);
  const more = new Set(l.sources.map((s) => s.source)).size - 1;
  return `<span class="src"><b>${esc(platform)}${more > 0 ? ` +${more}` : ''}</b>${detail ? `<span class="grp">${esc(detail)}</span>` : ''}${l.postedAt ? `<span class="ago">· ${l.postedAtApproximate ? '~' : ''}${esc(ago(l.postedAt))}</span>` : ''}</span>`;
}

function card(l, i = 0, { hideAction = 'hide' } = {}) {
  const pr = priceInfo(l);
  const move = fmtDate(l.moveIn.value);
  const { hood, boro, headline } = placeOf(l);
  const facts = cardFacts(l).slice(0, 5);
  const label = `${headline || 'Location not specified'}${pr.amount ? `, ${pr.amount}${pr.per}` : ''} — ${l.title || typeLabel(l)}`;
  return `<article class="card" data-id="${esc(l.id)}" style="--i:${Math.min(i, 12)}">
    ${media(l)}
    <div class="card-body">
      <div class="price-row">
        ${pr.amount ? `<p class="price">${esc(pr.amount)}<span class="per">${esc(pr.per)}</span></p>` : '<p class="price none">Price not listed</p>'}
        <p class="movein${move ? '' : ' unknown'}"><small>Move-in</small>${move ? esc(move) : 'Not specified'}</p>
      </div>
      <p class="price-note ${pr.tone}">${esc(pr.note)}</p>
      <h3 class="hood${headline ? '' : ' unknown'}"><a class="card-link" href="#listing=${encodeURIComponent(l.id)}" aria-label="${esc(label)}">${esc(headline || 'Location not specified')}</a>${hood && boro ? `<span class="boro" style="--c:${boroVar(boro)}"><i></i>${esc(BORO_SHORT[boro] || boro)}</span>` : ''}</h3>
      ${facts.length ? `<p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>` : ''}
      <div class="card-foot">${sourceLine(l)}
        <button type="button" class="hide-btn" data-act="${hideAction}">${hideAction === 'hide' ? 'Hide' : 'Remove'}</button>
      </div>
    </div>
  </article>`;
}

function skeletons(n = 6) {
  return Array.from({ length: n }, () => `<div class="card skeleton" aria-hidden="true"><div class="ph"></div><div class="card-body"><div class="sk-line" style="width:40%;height:24px"></div><div class="sk-line" style="width:65%"></div><div class="sk-line" style="width:85%"></div></div></div>`).join('');
}

// ---------- filtering ----------
// Each check returns true (pass), false (fail) or null (listing doesn't say).
function checks(l, f) {
  const out = {};
  if (f.types.length) out.type = l.listingType.value === 'UNKNOWN' ? null : f.types.includes(l.listingType.value);
  if (f.maxPrice != null && f.maxPrice < state.maxShare) out.price = l.price.share == null ? null : l.price.share <= f.maxPrice;
  if (f.boros.length || f.hoods.length) {
    const hood = l.neighborhood.value;
    const boro = l.borough.value;
    out.where = !hood && !boro ? null : (hood && f.hoods.includes(hood)) || (boro && f.boros.includes(boro)) || false;
  }
  if (f.moveBy) out.moveIn = l.moveIn.value?.date ? l.moveIn.value.date <= f.moveBy : null;
  if (f.roommates.length) out.roommates = l.roommates.value == null ? null : f.roommates.includes(l.roommates.value >= 3 ? '3' : String(l.roommates.value));
  if (f.bedrooms.length) out.bedrooms = l.bedrooms.value == null ? null : f.bedrooms.includes(l.bedrooms.value >= 4 ? '4' : String(l.bedrooms.value));
  for (const t of f.toggles) {
    if (t === 'laundry:unit') out.laundry = l.laundry.value == null ? null : l.laundry.value === 'in_unit';
    if (t === 'laundry:building' && !f.toggles.includes('laundry:unit')) out.laundry = l.laundry.value == null ? null : l.laundry.value !== 'none';
    if (t === 'furnished') out.furnished = l.furnished.value == null ? null : l.furnished.value === true;
    if (t === 'room:private') out.privateRoom = l.listingType.value === 'ENTIRE_APARTMENT' ? false : l.roomType.value == null ? null : l.roomType.value === 'private';
    if (t === 'photos') out.photos = l.photos.length > 0;
  }
  if (f.roomType !== 'any') out.roomType = l.roomType.value == null ? null : l.roomType.value === f.roomType;
  if (f.postedBy === 'people') out.postedBy = !l.postedBy.value;
  if (f.sources) out.source = l.sources.some((s) => f.sources.includes(s.source));
  if (f.q) {
    const hay = `${l.title} ${l.description} ${l.neighborhood.value || ''} ${l.borough.value || ''}`.toLowerCase();
    out.q = f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }
  return out;
}
const UNKNOWN_LABEL = { type: 'type', price: 'share', where: 'location', moveIn: 'move-in date', roommates: 'roommates', bedrooms: 'bedrooms', laundry: 'laundry', furnished: 'furnishing', privateRoom: 'room type', roomType: 'room type' };

function applyFilters(f = state.f) {
  const results = [];
  const unknownOnly = {}; // filter -> listings excluded only because they don't say
  for (const l of state.listings) {
    if (state.hidden.has(l.id)) continue;
    const c = Object.entries(checks(l, f));
    if (c.some(([, v]) => v === false)) continue;
    const unknowns = c.filter(([, v]) => v === null).map(([k]) => k);
    if (unknowns.length && !f.includeUnknown) {
      if (unknowns.length === 1) unknownOnly[unknowns[0]] = (unknownOnly[unknowns[0]] || 0) + 1;
      continue;
    }
    results.push(l);
  }
  return { results: results.sort(SORTS[f.sort] || SORTS['price-asc']), unknownOnly };
}

const nullsLast = (a, b, cmp) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : cmp(a, b));
const SORTS = {
  'price-asc': (a, b) => nullsLast(a.price.share ?? a.price.total, b.price.share ?? b.price.total, (x, y) => x - y) || (a.price.share == null) - (b.price.share == null),
  'price-desc': (a, b) => nullsLast(a.price.share, b.price.share, (x, y) => y - x),
  newest: (a, b) => nullsLast(a.postedAt, b.postedAt, (x, y) => Date.parse(y) - Date.parse(x)),
  movein: (a, b) => nullsLast(a.moveIn.value?.date, b.moveIn.value?.date, (x, y) => x.localeCompare(y)),
  'roommates-asc': (a, b) => nullsLast(a.roommates.value, b.roommates.value, (x, y) => x - y),
  'roommates-desc': (a, b) => nullsLast(a.roommates.value, b.roommates.value, (x, y) => y - x),
};

// Active filters as removable chips: [label, patch].
function activeFilters() {
  const f = state.f;
  const out = [];
  for (const t of f.types) out.push([TYPES.find(([v]) => v === t)?.[1] || t, { types: f.types.filter((x) => x !== t) }]);
  if (f.maxPrice != null && f.maxPrice < state.maxShare) out.push([`Share ≤ ${money(f.maxPrice)}`, { maxPrice: null }]);
  for (const b of f.boros) out.push([BORO_SHORT[b] || b, { boros: f.boros.filter((x) => x !== b) }]);
  for (const h of f.hoods) out.push([h, { hoods: f.hoods.filter((x) => x !== h) }]);
  if (f.moveBy) out.push([`Move in by ${fmtDate({ date: f.moveBy }) === 'Now' ? 'now' : fmtDate({ date: f.moveBy })}`, { moveBy: '' }]);
  for (const b of f.bedrooms) out.push([b === '0' ? 'Studio' : b === '4' ? '4+ bedrooms' : `${b} bedroom${b === '1' ? '' : 's'}`, { bedrooms: f.bedrooms.filter((x) => x !== b) }]);
  for (const r of f.roommates) out.push([r === '0' ? 'No roommates' : `${r === '3' ? '3+' : r} roommate${r === '1' ? '' : 's'}`, { roommates: f.roommates.filter((x) => x !== r) }]);
  if (f.roomType !== 'any') out.push([f.roomType === 'private' ? 'Private room' : 'Shared room', { roomType: 'any' }]);
  const TOG = { 'laundry:unit': 'W/D in unit', 'laundry:building': 'Laundry in building', furnished: 'Furnished', 'room:private': 'Private room', photos: 'Has photos' };
  for (const t of f.toggles) out.push([TOG[t] || t, { toggles: f.toggles.filter((x) => x !== t) }]);
  if (f.sources) out.push([`Only ${f.sources.map(sourceName).join(' + ')}`, { sources: null }]);
  if (f.postedBy === 'people') out.push(['Not brokers', { postedBy: 'any' }]);
  if (f.q) out.push([`“${f.q}”`, { q: '' }]);
  if (f.includeUnknown) out.push(['Including listings that don’t say', { includeUnknown: false }]);
  return out;
}

// ---------- rendering: browse ----------
function renderBrowse() {
  const grid = $('#grid');
  const empty = $('#empty');
  grid.setAttribute('aria-busy', String(!state.loaded));
  if (!state.loaded) { grid.innerHTML = skeletons(); empty.hidden = true; return; }
  if (state.loadError) {
    grid.innerHTML = '';
    empty.hidden = false;
    empty.innerHTML = `<div class="state-art"></div><span class="state-k">Connection problem</span><h2>We couldn't load <em>the listings</em></h2><p>Your shortlist is safe in this browser. Check your connection and try again.</p><div class="actions"><button type="button" class="btn primary" data-retry>Try again</button></div>`;
    return;
  }
  const { results, unknownOnly } = applyFilters();
  const prev = new Set($$('.card', grid).map((c) => c.dataset.id));
  grid.innerHTML = results.map((l, i) => card(l, prev.has(l.id) ? 0 : i)).join('');
  if (prev.size) $$('.card', grid).forEach((c) => { if (prev.has(c.dataset.id)) c.style.animation = 'none'; });
  const n = results.length;
  $('#summary').innerHTML = state.listings.length ? `<strong>${plural(n, 'listing', 'listings')}</strong>${n !== state.listings.length - state.hidden.size ? ` <span class="muted">of ${state.listings.length - [...state.hidden].filter((id) => state.byId.has(id)).length}</span>` : ''}` : '';
  const chips = activeFilters();
  $('#active-filters').innerHTML = chips.map(([label], i) => `<button type="button" class="achip" data-chip="${i}" aria-label="Remove filter: ${esc(label)}">${esc(label)}${icon('x')}</button>`).join('') + (chips.length ? '<button type="button" class="clear-all" data-reset>Clear all</button>' : '');
  const hiddenUnknown = Object.entries(unknownOnly);
  const note = $('#unknown-note');
  note.hidden = !hiddenUnknown.length || state.f.includeUnknown;
  if (!note.hidden) {
    const total = hiddenUnknown.reduce((a, [, c]) => a + c, 0);
    note.innerHTML = `${plural(total, 'more listing doesn’t', 'more listings don’t')} mention ${esc(hiddenUnknown.map(([k]) => UNKNOWN_LABEL[k] || k).join(' or '))}, so ${total === 1 ? 'it’s' : 'they’re'} not shown. <button type="button" class="text-btn" data-include-unknown>Show ${total === 1 ? 'it' : 'them'} too</button>`;
  }
  empty.hidden = n > 0;
  if (!state.listings.length) {
    const anyLive = state.status?.sources?.some((s) => ['LIVE', 'LIVE_WITH_LIMITATIONS'].includes(s.status));
    empty.innerHTML = `<div class="state-art"></div><span class="state-k">Nothing to show yet</span><h2>No listings are <em>available</em> right now</h2><p>${anyLive ? 'The sources were checked, but nothing within the budget turned up this time. New posts are collected regularly.' : 'No source is connected at the moment.'}</p><div class="actions"><a class="btn primary" href="#/about">See where listings come from</a></div>`;
  } else if (!n) {
    const loosen = chips.slice(0, 3).map(([label], i) => `<button type="button" class="achip" data-chip="${i}">${esc(label)}${icon('x')}</button>`).join('');
    empty.innerHTML = `<div class="state-art"></div><span class="state-k">No matches</span><h2>Nothing fits <em>all of that</em> yet</h2><p>New York moves fast, but this combination is narrower than what's listed right now. Try removing a filter${hiddenUnknown.length && !state.f.includeUnknown ? ', or include listings that don’t mention something' : ''}.</p><div class="actions">${loosen}<button type="button" class="btn primary" data-reset>Clear all filters</button></div>`;
  }
  syncSearchbar();
}

function syncSearchbar() {
  const f = state.f;
  const where = [...f.hoods, ...f.boros.map((b) => BORO_SHORT[b] || b)];
  $('#where-v').textContent = where.length ? (where.length > 2 ? `${where.slice(0, 2).join(', ')} +${where.length - 2}` : where.join(', ')) : 'Anywhere';
  $('#where-btn').classList.toggle('set', where.length > 0);
  const priceSet = f.maxPrice != null && f.maxPrice < state.maxShare;
  $('#price-v').textContent = priceSet ? `Up to ${money(f.maxPrice)}` : 'Any price';
  $('#price-btn').classList.toggle('set', priceSet);
  const n = activeFilters().filter(([label]) => !label.startsWith('“')).length;
  $('#filters-count').hidden = !n;
  $('#filters-count').textContent = n;
}

function renderMasthead() {
  const all = state.listings.filter((l) => !state.hidden.has(l.id));
  const d = new Date();
  $('#dateline .dl-date').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const fresh = state.status?.generatedAt ? `Updated ${ago(state.status.generatedAt)}` : '';
  $('#dateline .dl-fresh').textContent = fresh;
  $('#dateline .dl-fresh').hidden = !fresh;
  if (!state.loaded) return;
  const byType = {};
  for (const l of all) byType[l.listingType.value] = (byType[l.listingType.value] || 0) + 1;
  $('#headline-count').textContent = all.length ? `${all.length} places to live` : 'No listings yet';
  $('.headline-rest').textContent = all.length ? 'across New York' : '';
  const live = (state.status?.sources || []).filter((s) => s.inDataset).map((s) => s.name);
  const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const mix = Object.entries(byType).sort((a, b) => b[1] - a[1]).filter(([t]) => t !== 'UNKNOWN').map(([t, c]) => plural(c, ...TYPE_PLURAL[t])).join(', ');
  $('#dek').textContent = all.length ? `${mix[0].toUpperCase()}${mix.slice(1)} — gathered from ${live.length ? joinAnd(live.map((n) => (n === 'Facebook' ? 'public Facebook housing groups' : n))) : 'public listings'}, each one linked back to its original post.` : '';
  // Borough index: a small map legend that doubles as a filter.
  const counts = {};
  for (const l of all) if (l.borough.value) counts[l.borough.value] = (counts[l.borough.value] || 0) + 1;
  $('#boro-index').innerHTML = BOROS.filter((b) => counts[b]).map((b) => `<button type="button" class="bi" data-boro="${esc(b)}" aria-pressed="${state.f.boros.includes(b)}" style="--c:${boroVar(b)}"><span class="bi-k"><i></i>${esc(BORO_SHORT[b] || b)}</span><span class="bi-n">${counts[b]}</span></button>`).join('');
}

function renderTypes() {
  const counts = {};
  const visible = state.listings.filter((l) => !state.hidden.has(l.id));
  for (const l of visible) counts[l.listingType.value] = (counts[l.listingType.value] || 0) + 1;
  $('#types').innerHTML = [['', 'All'], ...TYPES].map(([v, label]) => {
    const on = v ? state.f.types.length === 1 && state.f.types[0] === v : !state.f.types.length;
    const c = v ? counts[v] || 0 : visible.length;
    return `<button type="button" data-value="${v}" aria-pressed="${on}"${v && !c ? ' disabled' : ''}>${esc(label)}<span class="n">${c}</span></button>`;
  }).join('');
}

// ---------- rendering: filter drawer ----------
function renderDrawer() {
  const f = state.f;
  const max = f.maxPrice ?? state.maxShare;
  const range = $('#max-price');
  range.max = state.maxShare;
  range.value = max;
  range.style.setProperty('--fill', `${((max - range.min) / (state.maxShare - range.min)) * 100}%`);
  $('#max-price-out').textContent = max >= state.maxShare ? 'Any price' : `Up to ${money(max)}`;
  $('#range-max').textContent = `${money(state.maxShare)}`;
  const counts = {};
  for (const l of state.listings) if (!state.hidden.has(l.id)) counts[l.listingType.value] = (counts[l.listingType.value] || 0) + 1;
  $('#f-types').innerHTML = TYPES.map(([v, , long]) => `<label class="check-row${counts[v] ? '' : ' off'}"><input type="checkbox" data-type="${v}" ${f.types.includes(v) ? 'checked' : ''} ${counts[v] ? '' : 'disabled'}><span>${esc(long)}</span><span class="n">${counts[v] || 0}</span></label>`).join('');
  const bc = {};
  for (const l of state.listings) if (l.borough.value) bc[l.borough.value] = (bc[l.borough.value] || 0) + 1;
  $('#f-boros').innerHTML = BOROS.filter((b) => bc[b]).map((b) => `<button type="button" data-boro="${esc(b)}" aria-pressed="${f.boros.includes(b)}" style="--c:${boroVar(b)}"><i class="sw"></i>${esc(BORO_SHORT[b] || b)}<span class="n">${bc[b]}</span></button>`).join('');
  $('#f-hoods').innerHTML = f.hoods.map((h) => `<button type="button" class="achip" data-unhood="${esc(h)}" aria-label="Remove ${esc(h)}">${esc(h)}${icon('x')}</button>`).join('');
  $('#f-hoods-btn').textContent = f.hoods.length ? `Neighborhoods (${f.hoods.length})` : 'Choose neighborhoods';
  $('#move-by').value = f.moveBy;
  $$('#roommates button').forEach((b) => b.setAttribute('aria-pressed', f.roommates.includes(b.dataset.value)));
  $$('#bedrooms button').forEach((b) => b.setAttribute('aria-pressed', f.bedrooms.includes(b.dataset.value)));
  $$('#toggles button').forEach((b) => b.setAttribute('aria-pressed', f.toggles.includes(b.dataset.t)));
  for (const [id, key] of [['roomtype', 'roomType'], ['postedby', 'postedBy']]) $$(`#${id} button`).forEach((b) => b.setAttribute('aria-checked', b.dataset.value === f[key]));
  $('#include-unknown').checked = f.includeUnknown;
  const st = state.status?.sources || [];
  $('#sources').innerHTML = st.filter((s) => s.inDataset).map((s) => {
    const on = !f.sources || f.sources.includes(s.id);
    return `<label class="check-row"><input type="checkbox" data-src="${esc(s.id)}" ${on ? 'checked' : ''}><span>${esc(s.name)}</span><span class="n">${s.inDataset}</span></label>`;
  }).join('') || '<p class="fnote">No source has listings right now.</p>';
  const n = applyFilters().results.length;
  $('#filters-apply').textContent = n ? `Show ${plural(n, 'listing', 'listings')}` : 'No matches — adjust filters';
}

function renderMoveBy() {
  const sel = $('#move-by');
  const now = new Date();
  const opts = [['', 'Any time'], [now.toISOString().slice(0, 10), 'Now / as soon as possible']];
  for (let i = 0; i < 9; i++) {
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
    opts.push([end.toISOString().slice(0, 10), `By the end of ${end.toLocaleDateString('en-US', { month: 'long', ...(end.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`]);
  }
  if (state.f.moveBy && !opts.some(([v]) => v === state.f.moveBy)) opts.push([state.f.moveBy, `By ${fmtDate({ date: state.f.moveBy })}`]);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
}

function renderWhere() {
  const q = $('#hood-q').value.trim().toLowerCase();
  const groups = new Map();
  for (const l of state.listings) {
    if (!l.neighborhood.value) continue;
    const boro = l.borough.value || 'Other';
    if (!groups.has(boro)) groups.set(boro, new Map());
    groups.get(boro).set(l.neighborhood.value, (groups.get(boro).get(l.neighborhood.value) || 0) + 1);
  }
  const order = (b) => { const i = BOROS.indexOf(b); return i < 0 ? 99 : i; };
  $('#where-list').innerHTML = [...groups.entries()].sort(([a], [b]) => order(a) - order(b)).map(([boro, hoods]) => {
    const items = [...hoods.entries()].filter(([h]) => !q || h.toLowerCase().includes(q) || boro.toLowerCase().includes(q)).sort(([a], [b]) => a.localeCompare(b));
    if (!items.length) return '';
    return `<div class="boro-group"><div class="boro-head" style="--c:${boroVar(boro)}"><i></i>${esc(BORO_SHORT[boro] || boro)}</div>
      ${items.map(([h, n]) => `<label class="hood-row"><input type="checkbox" data-hood="${esc(h)}" ${state.f.hoods.includes(h) ? 'checked' : ''}><span>${esc(h)}</span><span class="n">${n}</span></label>`).join('')}</div>`;
  }).join('') || `<p class="fnote" style="padding:20px 0">No neighborhood matches “${esc(q)}”.</p>`;
  const n = applyFilters().results.length;
  $('#where-apply').textContent = n ? `Show ${plural(n, 'listing', 'listings')}` : 'No matches';
}

// ---------- rendering: shortlist, hidden ----------
function renderSaved() {
  const ids = [...state.saved].reverse();
  const items = ids.map((id) => state.byId.get(id)).filter(Boolean);
  const missing = ids.length - items.length;
  $('#saved-grid').innerHTML = items.map((l, i) => card(l, i, { hideAction: 'unsave' })).join('');
  $('#saved-dek').textContent = items.length ? `${plural(items.length, 'listing', 'listings')} saved. Open one to compare prices and move-in dates, then contact the poster on the original site.` : '';
  const miss = $('#saved-missing');
  miss.hidden = !state.loaded || !missing;
  if (!miss.hidden) miss.innerHTML = `${plural(missing, 'saved listing is', 'saved listings are')} no longer in the current results — the post was probably filled or taken down. <button type="button" class="text-btn" data-prune>Remove ${missing === 1 ? 'it' : 'them'}</button>`;
  const empty = $('#saved-empty');
  empty.hidden = items.length > 0 || !state.loaded;
  empty.innerHTML = `<div class="state-art"></div><span class="state-k">Nothing saved yet</span><h2>Start a <em>shortlist</em></h2><p>Tap the heart on any listing to keep it here while you look. Your shortlist stays in this browser — no account needed.</p><div class="actions"><a class="btn primary" href="#/">Browse listings</a></div>`;
}

function renderHidden() {
  const items = [...state.hidden].reverse().map((id) => state.byId.get(id)).filter(Boolean);
  $('#hidden-dek').textContent = items.length ? `${plural(items.length, 'listing is', 'listings are')} kept out of Browse. Restore any of them at any time.` : '';
  $('#hidden-list').innerHTML = items.map((l, i) => {
    const pr = priceInfo(l);
    const { headline, boro, hood } = placeOf(l);
    const ph = l.photos[0];
    return `<li class="hrow" data-id="${esc(l.id)}" style="animation-delay:${Math.min(i, 10) * 25}ms">
      <div class="hrow-ph">${ph ? `<img src="${esc(ph.thumb || ph.url)}"${ph.thumb && ph.thumb !== ph.url ? ` data-full="${esc(ph.url)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer">` : noPhoto(l, { link: false })}</div>
      <div class="hrow-main"><h3 class="hood"><a class="card-link" href="#listing=${encodeURIComponent(l.id)}">${esc(headline || 'Location not specified')}</a>${hood && boro ? `<span class="boro" style="--c:${boroVar(boro)}"><i></i>${esc(BORO_SHORT[boro] || boro)}</span>` : ''}</h3>
        <p>${esc(typeLabel(l))} · ${esc(pr.amount ? `${pr.amount}${pr.per}` : 'Price not listed')} · ${esc(platformOf(l))}</p></div>
      <button type="button" class="btn" data-restore="${esc(l.id)}">${icon('undo')}Restore</button>
    </li>`;
  }).join('');
  $('#hidden-list').hidden = !items.length;
  const empty = $('#hidden-empty');
  empty.hidden = items.length > 0 || !state.loaded;
  empty.innerHTML = `<div class="state-art"></div><span class="state-k">Nothing hidden</span><h2>A clean <em>slate</em></h2><p>When a listing isn't right — wrong block, wrong vibe, already gone — choose <strong>Hide</strong> on its card. It disappears from Browse and waits here in case you change your mind.</p><div class="actions"><a class="btn primary" href="#/">Back to browsing</a></div>`;
}

function renderCounts() {
  const saved = [...state.saved].filter((id) => !state.loaded || state.byId.has(id)).length;
  const hidden = [...state.hidden].filter((id) => !state.loaded || state.byId.has(id)).length;
  $$('[data-count="saved"]').forEach((e) => { e.textContent = saved || ''; });
  $$('[data-count="hidden"]').forEach((e) => { e.textContent = hidden || ''; });
}

// ---------- rendering: about ----------
const STATUS_LABEL = {
  LIVE: 'LIVE', LIVE_WITH_LIMITATIONS: 'LIVE · LIMITED', BLOCKED: 'BLOCKED', AUTH_REQUIRED: 'LOGIN / CREDENTIALS REQUIRED',
  PERMISSION_REQUIRED: 'PERMISSION REQUIRED', NO_PUBLIC_ACCESS: 'NO PUBLIC ACCESS', DISABLED: 'DISABLED', UNVERIFIED: 'UNVERIFIED',
};
const PERMITTED = { yes: 'Permitted', no: 'Not permitted', unclear: 'Unclear', 'api-only': 'Only via official API' };
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : v === 'partial' ? 'Partly' : '—');
const CONSUMER_SOURCE = {
  facebook: 'Public New York housing groups, where people post their own rooms, sublets and lease takeovers.',
  roomster: 'A roommate-matching site with rooms and apartment shares posted by the people living there.',
  reddit: 'NYC housing and roommate subreddits.',
  junehomes: 'Furnished rooms in managed shared apartments.',
};

function renderAbout() {
  const st = state.status;
  $('#about-dateline').textContent = st?.generatedAt ? `About the listings · updated ${ago(st.generatedAt)}` : 'About the listings';
  const live = (st?.sources || []).filter((s) => s.inDataset);
  const groupsOf = (id) => [...new Set(state.listings.flatMap((l) => l.sources.filter((s) => s.source === id).map((s) => splitLabel(s.label).detail)).filter(Boolean))];
  const srcCards = live.map((s) => {
    const groups = groupsOf(s.id);
    return `<div class="ab-src"><span class="ab-src-k">Source</span><h3>${esc(s.name)}</h3><span class="big">${s.inDataset}</span><p>${esc(CONSUMER_SOURCE[s.id] || s.kind || '')}</p>${groups.length ? `<p class="muted" style="font-size:13px">${esc(groups.join(' · '))}</p>` : ''}${s.lastSuccessAt ? `<p class="muted" style="font-size:13px">Last checked ${esc(ago(s.lastSuccessAt))}</p>` : ''}</div>`;
  }).join('') || '<div class="ab-src"><p>No source has listings at the moment.</p></div>';
  const ex = (label, amount, per, note, tone) => `<div><p class="price${amount ? '' : ' none'}">${esc(amount || 'Price not listed')}<span class="per">${esc(per)}</span></p><p class="price-note ${tone}">${esc(label)}</p><p>${esc(note)}</p></div>`;
  $('#about-body').innerHTML = `
    <section><div class="ab-sources">${srcCards}</div></section>
    <section><h2 class="ab-h">How to read a <em>price</em></h2>
      <div class="legend">
        ${ex('Your share', '$1,450', '/mo', 'The listing states what you would pay for your room or bed.', 'ok')}
        ${ex('Likely your share · confirm with poster', '$1,450', '/mo', 'A single rent in a room post. It is probably the room price, but the post doesn’t say so outright.', 'caution')}
        ${ex('Total rent · your share not specified', '$3,900', '/mo total', 'The post gives rent for the whole apartment only. Your part is up to the people living there.', 'caution')}
        ${ex('Price not listed · ask the poster', null, '', 'The post doesn’t mention rent.', 'none')}
      </div></section>
    <section><h2 class="ab-h">What we <em>never</em> do</h2>
      <ul class="rules">
        <li><strong>Split rent by bedrooms</strong><span>A $3,900 three-bedroom is shown as $3,900 total — never as $1,300 each.</span></li>
        <li><strong>Guess roommates</strong><span>A roommate count appears only when the listing states it.</span></li>
        <li><strong>Invent details</strong><span>Unknown move-in dates, neighborhoods and amenities are shown as not specified.</span></li>
        <li><strong>Use stock photos</strong><span>Every photo comes from the original post. No photos means the post had none.</span></li>
        <li><strong>Publish contact details</strong><span>Emails, phone numbers and names in posts are removed. Get in touch through the original post.</span></li>
        <li><strong>Claim a listing</strong><span>Apartment Hunter doesn't own or verify listings. Always check with the poster, and never send money for a place you haven't seen.</span></li>
      </ul></section>
    <section><details class="tech"><summary><div><h2 class="ab-h">Technical source status</h2><p>Coverage, collection method and data quality for each source, from the latest run.</p></div></summary><div id="status-body"></div></details></section>`;
  renderStatus();
}

function renderStatus() {
  const st = state.status;
  const body = $('#status-body');
  if (!body) return;
  if (!st) { body.innerHTML = '<p>No scraper run has been recorded yet.</p>'; return; }
  const t = st.totals;
  const bar = (label, v) => `<div class="qbar"><span>${esc(label)}</span><i style="--p:${v}%"></i><b>${v}%</b></div>`;
  const cov = (q) => {
    const c = q.coverage;
    return [['Your share', c.yourShare], ['Price or total', c.priceOrTotal], ['Listing type', c.listingType], ['Bedrooms', c.bedrooms], ['Roommates stated', c.roommatesStated], ['Neighborhood', c.neighborhood], ['Borough', c.borough], ['Move-in', c.moveIn], ['Laundry', c.laundry], ['Furnished', c.furnished], ['Photos', c.photos]].map(([k, v]) => bar(k, v)).join('');
  };
  const reviewHtml = (s) => {
    const r = s.review;
    if (!r) return '';
    const rows = [
      ['Site', s.domain], ['Listing content reachable', yesNo(r.technicallyAccessible)], ['Scraping tested', yesNo(r.scrapingTested)],
      ['robots.txt', r.robots], ['Terms reviewed', yesNo(r.termsReviewed)], ['Automated access', PERMITTED[r.automatedAccessPermitted] || '—'],
      ['Enabled', s.enabled ? 'Yes' : 'No'], ['Pagination', r.pagination], ['Photos', r.photos],
      ['Last success', s.lastSuccessAt ? ago(s.lastSuccessAt) : '—'], ['Last failure', s.lastFailureAt ? `${ago(s.lastFailureAt)} — ${s.failureReason || ''}` : '—'],
    ].filter(([, v]) => v);
    return `<details class="src-review"><summary>Investigation details (checked ${esc(r.checkedAt)})</summary>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${r.termsNotes?.length ? `<p><strong>Terms notes</strong></p><ul>${r.termsNotes.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${r.blockers?.length ? `<p><strong>Blockers</strong></p><ul>${r.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${r.pagesTested?.length ? `<p><strong>Pages tested:</strong> ${esc(r.pagesTested.join(' · '))}</p>` : ''}
      ${s.nextStep ? `<p><strong>Next step:</strong> ${esc(s.nextStep)}</p>` : ''}
    </details>`;
  };
  const src = (s) => {
    const q = s.quality;
    const discarded = Object.entries(s.discarded || {}).map(([r, n]) => `${n} ${r}`).join(', ');
    const via = s.sourceStats?.provider ? ` · collected via ${esc(s.sourceStats.provider)}` : '';
    return `<div class="srow"><div class="srow-head"><span class="srow-name">${esc(s.name)}</span><span class="src-state ${esc(s.status)}">${esc(STATUS_LABEL[s.status] || s.status)}</span></div>
      <p class="srow-meta">${s.retrieved ? `${s.retrieved} retrieved · <strong>${s.inDataset} in results</strong>${discarded ? ` · set aside: ${esc(discarded)}` : ''}` : esc(s.kind || '')}${s.lastSuccessAt ? ` · last success ${esc(ago(s.lastSuccessAt))}` : ''}${via}</p>
      ${s.reason ? `<p class="srow-reason">${esc(s.reason)}</p>` : ''}
      ${q ? `<div class="qgrid">${cov(q)}</div><p class="srow-meta">${Object.entries(q.types).map(([k, v]) => `${v} ${esc(TYPE_PLURAL[k]?.[v === 1 ? 0 : 1] || k)}`).join(' · ')} · ${q.needsConfirmation} need price confirmation · ${q.inferredFields} estimated values</p>` : ''}
      ${reviewHtml(s)}</div>`;
  };
  const ex = (s) => `<div class="srow"><div class="srow-head"><span class="srow-name">${esc(s.name)}</span><span class="src-state ${esc(s.status)}">${esc(STATUS_LABEL[s.status] || s.status)}</span></div><p class="srow-reason">${esc(s.reason)} <em>(checked ${esc(s.checkedAt)})</em></p></div>`;
  body.innerHTML = `
    <p class="muted" style="margin:0">From the scraper run ${esc(ago(st.generatedAt))} (${esc(new Date(st.generatedAt).toLocaleString())}). Every number here comes from that run.</p>
    <div class="status-summary">
      <div class="stat"><b>${t.listings}</b><span>${st.dataKind === 'SAMPLE' ? 'SAMPLE' : 'real'} listings</span></div>
      <div class="stat"><b>${t.withPhotos}/${t.listings}</b><span>have photos</span></div>
      <div class="stat"><b>${t.photosLoaded}/${t.photosChecked}</b><span>photos verified loading</span></div>
      <div class="stat"><b>${t.duplicatesMerged}</b><span>duplicates merged</span></div>
    </div>
    <h4>Sources — status and coverage</h4>
    <p class="muted" style="margin:0 0 8px;font-size:13px">Coverage is the share of a source's listings where the field is known. “Roommates stated” only counts numbers the listing actually states.</p>
    <div class="src-list">${st.sources.map(src).join('')}</div>
    <h4>Not searched, and why</h4>
    <div class="src-list">${(st.excluded || []).map(ex).join('')}</div>`;
}

function renderSourceNotice() {
  const st = state.status;
  const failed = (st?.sources || []).filter((s) => s.enabled && s.lastFailureAt && s.lastFailureAt === st.generatedAt);
  const el = $('#source-notice');
  el.hidden = !failed.length;
  if (failed.length) el.innerHTML = `${esc(failed.map((s) => s.name).join(' and '))} couldn’t be refreshed on the latest check — ${failed.some((s) => s.inDataset) ? 'showing the listings it had before.' : 'its listings may be missing for now.'} <a href="#/about">Details</a>`;
}

// ---------- card photo carousel ----------
function loadSlide(slide) {
  const img = slide?.querySelector('img[data-src]');
  if (img) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
}
function trackIndex(track) { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); }
function syncCarousel(ph) {
  const track = ph.querySelector('.ph-track');
  const n = Number(ph.dataset.count);
  const i = Math.min(n - 1, trackIndex(track));
  const slides = track.children;
  loadSlide(slides[i]); loadSlide(slides[i + 1]);
  const cnt = ph.querySelector('.ph-count');
  if (cnt) cnt.textContent = `${i + 1} / ${n}`;
  $$('.ph-bars span', ph).forEach((s, k) => s.classList.toggle('on', k === Math.min(i, 7) || (i >= 7 && k === 7)));
  const prev = ph.querySelector('.ph-nav.prev');
  const next = ph.querySelector('.ph-nav.next');
  if (prev) prev.disabled = i === 0;
  if (next) next.disabled = i >= n - 1;
}
function stepCarousel(ph, d) {
  const track = ph.querySelector('.ph-track');
  const i = trackIndex(track) + d;
  loadSlide(track.children[i]);
  track.scrollTo({ left: i * track.clientWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}

// ---------- detail ----------
let current = null;
let openedFromApp = false;
function openDetail(id) {
  const l = state.byId.get(id);
  const dlg = $('#detail-dialog');
  const content = $('#detail-content');
  if (!l) {
    if (!state.loaded) return;
    current = null;
    content.innerHTML = `<div class="d-bar"><button type="button" class="d-back" data-close>${icon('left')}Back</button></div>
      <div class="d-gone state"><div class="state-art"></div><span class="state-k">Listing unavailable</span><h2>This place is <em>no longer listed</em></h2><p>The post was probably filled, edited or taken down since this link was shared. Here's what's available now.</p><div class="actions"><button type="button" class="btn primary" data-close>Browse current listings</button></div></div>`;
    if (!dlg.open) dlg.showModal();
    return;
  }
  current = l;
  const names = sourceNames(l);
  const platform = platformOf(l);
  const pr = priceInfo(l);
  const { hood, boro, headline, estimated } = placeOf(l);
  const photos = l.photos;
  const n = photos.length;
  const mosaicN = Math.min(n, 5);
  const gallery = n ? `<div class="d-gallery"><div class="d-mosaic n${mosaicN}">
        ${photos.slice(0, mosaicN).map((p, i) => `<button type="button" data-photo="${i}" aria-label="Open photo ${i + 1} of ${n}"><img src="${esc(i === 0 ? p.url : p.thumb || p.url)}"${i && p.thumb && p.thumb !== p.url ? ` data-full="${esc(p.url)}"` : ''} alt="" referrerpolicy="no-referrer" ${i ? 'loading="lazy"' : ''}></button>`).join('')}
        ${n > 1 ? `<button type="button" class="d-all" data-photo="0">${icon('expand')}${n > mosaicN ? `All ${n} photos` : 'View photos'}</button>` : ''}
      </div>
      <div class="d-gallery-wrap"><div class="d-strip" id="d-strip">${photos.map((p, i) => `<button type="button" data-photo="${i}" aria-label="Open photo ${i + 1} of ${n}"><img ${i < 2 ? `src="${esc(p.url)}"` : `data-src="${esc(p.url)}"`} alt="" referrerpolicy="no-referrer"></button>`).join('')}</div><span class="d-strip-count" id="d-strip-count">1 / ${n}</span></div></div>`
    : `<div class="d-gallery"><div class="d-nophoto">${noPhoto(l)}</div></div>`;

  const key = (ic, label, value) => `<div class="d-key${value ? '' : ' unknown'}">${icon(ic)}<dt>${esc(label)}</dt><dd>${value ? esc(value) : 'Not specified'}</dd></div>`;
  const t = l.listingType.value;
  const beds = l.bedrooms.value;
  const rmVal = l.roommates.value != null ? (l.roommates.value === 0 ? 'None — just you' : plural(l.roommates.value, 'person', 'people')) : (t === 'ENTIRE_APARTMENT' ? 'Entire place' : null);
  const keys = [
    key('cal', 'Move-in', fmtDate(l.moveIn.value, { long: true })),
    key('bed', 'Apartment', apartmentText(l) || (beds === 0 ? 'Studio' : null)),
    key('people', 'Already living there', rmVal),
    key('wash', 'Laundry', l.laundry.value ? LAUNDRY[l.laundry.value] : null),
    key('sofa', 'Furnished', l.furnished.value == null ? null : l.furnished.value ? 'Yes' : 'No'),
    key('lease', 'Lease', l.leaseLength.value || null),
  ].join('');

  // Full provenance: every field and where it comes from.
  const unknown = [];
  const F = (label, value, basis) => {
    if (value == null) { unknown.push(label); return ''; }
    return `<dt>${esc(label)}</dt><dd>${value}${chip(basis, l)}</dd>`;
  };
  const yn = (v) => (v == null ? null : v ? 'Yes' : 'No');
  const rm = l.roommates.value;
  const facts = [
    F('Existing roommates', rm != null ? (rm === 0 ? 'None' : String(rm)) : null, l.roommates.basis),
    F('Bedrooms in apartment', beds != null ? (beds === 0 ? 'Studio' : String(beds)) : null, l.bedrooms.basis),
    F('Bathrooms', l.bathrooms.value != null ? `${l.bathrooms.value}${l.bathroomType.value ? ` (${l.bathroomType.value})` : ''}` : null, l.bathrooms.basis),
    F('Rooms available', l.availableRooms.value != null ? String(l.availableRooms.value) : null, l.availableRooms.basis),
    F('Move-in', fmtDate(l.moveIn.value, { long: true }), l.moveIn.basis),
    F('Lease', l.leaseLength.value ? esc(l.leaseLength.value) : null, l.leaseLength.basis),
    F('Laundry', l.laundry.value ? LAUNDRY[l.laundry.value] : null, l.laundry.basis),
    F('Furnished', yn(l.furnished.value), l.furnished.basis),
    F('Room', l.roomType.value ? (l.roomType.value === 'private' ? 'Private' : 'Shared') : null, l.roomType.basis),
    F('Utilities included', yn(l.utilitiesIncluded.value), l.utilitiesIncluded.basis),
    F('Pets', l.pets.value ? esc(l.pets.value) : null, l.pets.basis),
    F('Roommate preference', l.genderPreference.value ? esc(l.genderPreference.value) : null, l.genderPreference.basis),
    F('Person who listed it', l.lister?.value ? LISTER[l.lister.value] : null, l.lister?.basis),
    F('Neighborhood', hood ? esc(hood) : null, l.neighborhood.basis),
    F('Borough', boro ? esc(boro) : null, l.borough.basis),
  ].join('');

  const p = l.price;
  const priceRows = [
    ['Your share', p.share != null ? `${money(p.share)}${p.shareMax && p.shareMax !== p.share ? `–${money(p.shareMax)}` : ''}/mo` : 'Not specified', p.share != null ? chip(p.shareBasis, l) : ''],
    ['Whole apartment', p.total != null ? `${money(p.total)}/mo` : 'Not stated', p.total != null ? chip(p.totalBasis, l) : ''],
    ['Split', { whole_unit: 'You pay it all', even_split_stated: 'Evenly (stated)', room_price_stated: 'Room priced separately' }[p.split] || (p.share != null ? 'As listed' : 'Not stated'), ''],
  ].map(([k, v, c]) => `<tr><th scope="row">${k}</th><td>${esc(v)}${c}</td></tr>`).join('');

  const url = safeUrl(l.originalUrl);
  const contact = safeUrl(l.contact.url) || url;
  const saved = state.saved.has(l.id);
  const hidden = state.hidden.has(l.id);
  const desc = l.description || '';
  const long = desc.length > 900;
  const eyebrow = [`<span class="type">${esc(typeLabel(l))}</span>`, l.postedAt ? `<span>Posted ${l.postedAtApproximate ? 'about ' : ''}${esc(ago(l.postedAt))}</span>` : '', `<span>${esc(platform)}</span>`].filter(Boolean).join('');
  content.innerHTML = `
    <div class="d-bar">
      <button type="button" class="d-back" data-close>${icon('left')}<span>Back to listings</span></button>
      <span class="spacer"></span>
      <button type="button" class="btn" data-dact="save" aria-pressed="${saved}" aria-label="${saved ? 'Remove from shortlist' : 'Save to shortlist'}">${icon(saved ? 'heart-fill' : 'heart')}<span class="btn-label">${saved ? 'Saved' : 'Save'}</span></button>
      <button type="button" class="btn" data-dact="hide" aria-label="${hidden ? 'Restore to Browse' : 'Hide this listing'}">${icon(hidden ? 'undo' : 'eye-off')}<span class="btn-label">${hidden ? 'Restore' : 'Hide'}</span></button>
    </div>
    ${gallery}
    <div class="d-body">
      <div class="d-main">
        <p class="d-eyebrow">${eyebrow}</p>
        <h2 class="d-place${headline ? '' : ' unknown'}" id="detail-title">${esc(headline || 'Location not specified')}</h2>
        ${hood && boro ? `<p class="d-boro" style="--c:${boroVar(boro)}"><i></i>${esc(BORO_SHORT[boro] || boro)}</p>` : estimated ? `<p class="d-boro">${chip('inferred', l)} from the listing's map location</p>` : ''}
        ${l.title ? `<p class="d-title">${esc(l.title)}</p>` : ''}
        <dl class="d-keys">${keys}</dl>
        <section class="d-sec">
          <h3>From the post <span class="muted">— original text, contact details removed</span></h3>
          ${desc ? `<p class="d-desc${long ? ' clamped' : ''}" id="d-desc">${esc(desc)}</p>${long ? '<button type="button" class="text-btn d-more" data-more aria-expanded="false" aria-controls="d-desc">Read the full post</button>' : ''}` : '<p class="d-desc muted">The post has no description.</p>'}
          <p class="d-attrib">Posted${l.postedAt ? ` ${l.postedAtApproximate ? 'about ' : ''}${esc(ago(l.postedAt))}` : ''} on ${esc(names.join(' and '))} · retrieved ${esc(ago(l.scrapedAt))}. Apartment Hunter doesn't own or verify this listing.</p>
        </section>
        <section class="d-sec"><details class="d-details"><summary><span>Every detail, and where it comes from<small>${unknown.length ? `${unknown.length} not stated` : ''}</small></span></summary>
          <dl class="prov">${facts}</dl>
          ${unknown.length ? `<p class="d-unknown"><strong>Not stated in the listing:</strong> ${unknown.map(esc).join(' · ')}</p>` : ''}
        </details></section>
      </div>
      <aside class="d-side" aria-label="Price and contact">
        <div class="d-card">
          ${pr.amount ? `<p class="d-price">${esc(pr.amount)}<span class="per">${esc(pr.per)}</span></p>` : '<p class="d-price none">Price not listed</p>'}
          <p class="price-note ${pr.tone}">${esc(pr.note)}</p>
          <table class="ptable">${priceRows}</table>
          ${contact ? `<a class="btn signal block" href="${esc(contact)}" target="_blank" rel="noopener noreferrer">View original on ${esc(platform)}${icon('out')}</a>` : ''}
          ${l.contact.method ? `<p class="small">${esc(l.contact.method)}</p>` : `<p class="small">Message the poster on ${esc(platform)}. Never send a deposit for a place you haven't seen.</p>`}
        </div>
        <div class="d-sources">
          <h4>${new Set(l.sources.map((x) => x.source)).size > 1 ? `Found on ${new Set(l.sources.map((x) => x.source)).size} sites` : 'Original listing'}</h4>
          ${l.sources.map((s) => { const u = safeUrl(s.url); const { platform: pf, detail } = splitLabel(s.label); return u ? `<a class="d-src" href="${esc(u)}" target="_blank" rel="noopener noreferrer"><span><strong>${esc(pf)}</strong><small>${esc(detail || new URL(u).hostname.replace(/^www\./, ''))}</small></span>${icon('out')}</a>` : `<div class="d-src"><span><strong>${esc(pf)}</strong></span></div>`; }).join('')}
          ${l.postedBy.value ? `<p class="small muted" style="margin-top:10px">This listing says it's posted by a ${l.postedBy.value === 'broker' ? 'real-estate broker' : 'company'}.</p>` : ''}
        </div>
      </aside>
    </div>
    ${contact ? `<div class="d-mobilebar"><div class="mb-price"><b>${esc(pr.amount ? `${pr.amount}${pr.per}` : 'Price not listed')}</b><span class="${pr.tone}">${esc(pr.note)}</span></div><a class="btn signal" href="${esc(contact)}" target="_blank" rel="noopener noreferrer">View on ${esc(platform)}${icon('out')}</a></div>` : ''}`;
  if (!dlg.open) dlg.showModal();
  content.scrollTop = 0;
  const strip = $('#d-strip');
  if (strip) {
    let raf = 0;
    strip.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
        $('#d-strip-count').textContent = `${i + 1} / ${n}`;
        for (const b of [strip.children[i], strip.children[i + 1]]) { const im = b?.querySelector('img[data-src]'); if (im) { im.src = im.dataset.src; im.removeAttribute('data-src'); } }
      });
    }, { passive: true });
  }
  content.focus({ preventScroll: true });
}

function closeDetail() {
  const dlg = $('#detail-dialog');
  if (dlg.open) dlg.close();
}

// ---------- lightbox ----------
let lbIdx = 0;
function openLightbox(i) {
  if (!current?.photos.length) return;
  const photos = current.photos;
  const track = $('#lb-track');
  track.innerHTML = photos.map((p, k) => `<div class="lb-slide"><img ${Math.abs(k - i) <= 1 ? `src="${esc(p.url)}"` : `data-src="${esc(p.url)}"`} alt="Photo ${k + 1} of ${photos.length}${p.caption ? ` — ${esc(p.caption)}` : ''}" referrerpolicy="no-referrer"></div>`).join('');
  const lb = $('#lightbox');
  if (!lb.open) lb.showModal();
  track.scrollLeft = i * track.clientWidth;
  lbSync(i);
}
function lbSync(i) {
  const photos = current?.photos || [];
  lbIdx = Math.max(0, Math.min(photos.length - 1, i));
  const track = $('#lb-track');
  for (const k of [lbIdx - 1, lbIdx, lbIdx + 1]) { const im = track.children[k]?.querySelector('img[data-src]'); if (im) { im.src = im.dataset.src; im.removeAttribute('data-src'); } }
  $('#lb-count').textContent = `${lbIdx + 1} / ${photos.length}`;
  const ph = photos[lbIdx];
  $('#lb-cap').textContent = `${ph?.caption ? `${ph.caption} · ` : ''}Photo from the original post on ${platformOf(current)}`;
  $('.lb-nav.prev').disabled = lbIdx === 0;
  $('.lb-nav.next').disabled = lbIdx >= photos.length - 1;
}
function lbStep(d) {
  const track = $('#lb-track');
  const i = Math.max(0, Math.min((current?.photos.length || 1) - 1, lbIdx + d));
  track.scrollTo({ left: i * track.clientWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  lbSync(i);
}

// ---------- saved / hidden actions ----------
let toastTimer = 0;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" data-undo>Undo</button>' : ''}`;
  el.classList.add('show');
  el._undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

function toggleSave(id) {
  const was = state.saved.has(id);
  if (was) state.saved.delete(id); else state.saved.add(id);
  persist();
  for (const btn of $$(`.card[data-id="${CSS.escape(id)}"] .save-btn`)) {
    btn.setAttribute('aria-pressed', String(!was));
    btn.setAttribute('aria-label', was ? 'Save to shortlist' : 'Remove from shortlist');
    btn.innerHTML = icon(was ? 'heart' : 'heart-fill');
    if (!was) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
  }
  renderCounts();
  if (state.view === 'saved') renderSaved();
  toast(was ? 'Removed from your shortlist' : 'Saved to your shortlist', () => toggleSave(id));
}

function toggleHide(id) {
  const was = state.hidden.has(id);
  const apply = () => {
    if (was) state.hidden.delete(id); else state.hidden.add(id);
    persist();
    renderCounts();
    renderView();
  };
  const cardEl = !was && state.view === 'browse' ? $(`#grid .card[data-id="${CSS.escape(id)}"]`) : null;
  if (cardEl && !reduceMotion.matches) { cardEl.classList.add('leaving'); setTimeout(apply, 220); } else apply();
  toast(was ? 'Restored to Browse' : 'Hidden from Browse', () => toggleHide(id));
}

// ---------- views & routing ----------
function renderView() {
  renderMasthead();
  renderTypes();
  renderCounts();
  if (state.view === 'browse') { renderBrowse(); renderSourceNotice(); }
  if (state.view === 'saved') renderSaved();
  if (state.view === 'hidden') renderHidden();
  if (state.view === 'about') renderAbout();
  persist();
}

function setView(view) {
  const changed = state.view !== view;
  state.view = view;
  for (const sec of $$('.view')) {
    const on = sec.dataset.view === view;
    sec.hidden = !on;
    if (on && changed) { sec.classList.remove('entering'); void sec.offsetWidth; sec.classList.add('entering'); }
  }
  $$('.tabs a, .tabbar a').forEach((a) => { if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = { browse: 'Apartment Hunter — rooms & apartments in NYC', saved: 'Your shortlist — Apartment Hunter', hidden: 'Hidden listings — Apartment Hunter', about: 'About the listings — Apartment Hunter' }[view];
  renderView();
  if (changed) window.scrollTo({ top: 0, behavior: 'auto' });
}

function route() {
  const h = location.hash;
  const m = h.match(/listing=([^&]+)/);
  if (m) { openDetail(decodeURIComponent(m[1])); return; }
  closeDetail();
  const view = { '#/saved': 'saved', '#/hidden': 'hidden', '#/about': 'about' }[h] || 'browse';
  setView(view);
}
const viewHash = () => ({ saved: '#/saved', hidden: '#/hidden', about: '#/about' }[state.view] || '#/');

// ---------- events ----------
const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
function update(patch) {
  Object.assign(state.f, patch);
  renderView();
  if ($('#filters-dialog').open) renderDrawer();
  if ($('#where-dialog').open) renderWhere();
}

function bind() {
  let qTimer = 0;
  $('#q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => update({ q: e.target.value.trim() }), 140); });
  $('#sort').addEventListener('change', (e) => update({ sort: e.target.value }));
  $('#max-price').addEventListener('input', (e) => update({ maxPrice: +e.target.value >= state.maxShare ? null : +e.target.value }));
  $('#move-by').addEventListener('change', (e) => update({ moveBy: e.target.value }));
  $('#include-unknown').addEventListener('change', (e) => update({ includeUnknown: e.target.checked }));
  $('#types').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ types: b.dataset.value ? [b.dataset.value] : [] }); });
  $('#f-types').addEventListener('change', (e) => { const t = e.target.dataset.type; if (t) update({ types: toggleIn(state.f.types, t) }); });
  const boroToggle = (e) => { const b = e.target.closest('[data-boro]'); if (b) update({ boros: toggleIn(state.f.boros, b.dataset.boro) }); };
  $('#boro-index').addEventListener('click', boroToggle);
  $('#f-boros').addEventListener('click', boroToggle);
  $('#f-hoods').addEventListener('click', (e) => { const b = e.target.closest('[data-unhood]'); if (b) update({ hoods: state.f.hoods.filter((h) => h !== b.dataset.unhood) }); });
  for (const key of ['roommates', 'bedrooms']) $(`#${key}`).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ [key]: toggleIn(state.f[key], b.dataset.value) }); });
  $('#toggles').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    let t = toggleIn(state.f.toggles, b.dataset.t);
    if (b.dataset.t.startsWith('laundry:') && t.includes(b.dataset.t)) t = t.filter((x) => !x.startsWith('laundry:') || x === b.dataset.t);
    update({ toggles: t });
  });
  for (const [id, key] of [['roomtype', 'roomType'], ['postedby', 'postedBy']]) $(`#${id}`).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ [key]: b.dataset.value }); });
  $('#sources').addEventListener('change', () => {
    const live = (state.status?.sources || []).filter((s) => s.inDataset).map((s) => s.id);
    const checked = $$('#sources input:checked').map((i) => i.dataset.src);
    update({ sources: checked.length === live.length ? null : checked });
  });

  const openFilters = (section) => {
    renderDrawer();
    $('#filters-dialog').showModal();
    if (section) $(section)?.scrollIntoView({ block: 'start' });
  };
  const openWhere = () => { $('#hood-q').value = ''; renderWhere(); $('#where-dialog').showModal(); };
  $('#filters-btn').addEventListener('click', () => openFilters());
  $('#price-btn').addEventListener('click', () => openFilters('#fsec-price'));
  $('#where-btn').addEventListener('click', openWhere);
  $('#f-hoods-btn').addEventListener('click', openWhere);
  $('#hood-q').addEventListener('input', renderWhere);
  $('#where-list').addEventListener('change', (e) => { if (e.target.dataset.hood) update({ hoods: toggleIn(state.f.hoods, e.target.dataset.hood) }); });
  $('#where-clear').addEventListener('click', () => { update({ hoods: [], boros: [] }); });
  $('#reset-btn').addEventListener('click', () => { state.f = { ...structuredClone(DEFAULTS), sort: state.f.sort }; $('#q').value = ''; update({}); });

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-close]')) t.closest('dialog')?.close();
    if (t.matches('dialog.drawer') || t.matches('dialog.detail')) t.close(); // backdrop click
    if (t.closest('[data-reset]')) $('#reset-btn').click();
    if (t.closest('[data-include-unknown]')) update({ includeUnknown: true });
    if (t.closest('[data-retry]')) loadData();
    if (t.closest('[data-undo]')) { const u = $('#toast')._undo; $('#toast').classList.remove('show'); u?.(); }
    const ch = t.closest('[data-chip]');
    if (ch) { const f = activeFilters()[Number(ch.dataset.chip)]; if (f) { if ('q' in f[1]) $('#q').value = ''; update(f[1]); } }
    const rs = t.closest('[data-restore]');
    if (rs) toggleHide(rs.dataset.restore);
    if (t.closest('[data-prune]')) { for (const id of [...state.saved]) if (!state.byId.has(id)) state.saved.delete(id); persist(); renderView(); }
  });

  // Cards (browse + shortlist): delegated.
  const onCards = (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl || e.target.closest('a')) return;
    const id = cardEl.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    const ph = cardEl.querySelector('.ph');
    if (act === 'prev' || act === 'next') { stepCarousel(ph, act === 'next' ? 1 : -1); return; }
    if (act === 'save') { toggleSave(id); return; }
    if (act === 'hide') { toggleHide(id); return; }
    if (act === 'unsave') { toggleSave(id); return; }
    if (act === 'open') { openedFromApp = true; location.hash = `listing=${encodeURIComponent(id)}`; }
  };
  $('#grid').addEventListener('click', onCards);
  $('#saved-grid').addEventListener('click', onCards);
  const onTrackScroll = (e) => {
    const track = e.target;
    if (!track.classList?.contains('ph-track')) return;
    cancelAnimationFrame(track._raf);
    track._raf = requestAnimationFrame(() => syncCarousel(track.parentElement));
  };
  for (const g of ['#grid', '#saved-grid']) {
    $(g).addEventListener('scroll', onTrackScroll, { capture: true, passive: true });
    // Preload the second photo when the pointer arrives, so the first swipe is instant.
    $(g).addEventListener('pointerover', (e) => { const ph = e.target.closest('.ph[data-count]'); if (ph && !ph._warm) { ph._warm = true; loadSlide(ph.querySelector('.ph-track').children[1]); } });
  }
  document.addEventListener('click', (e) => { if (e.target.closest('a.card-link')) openedFromApp = true; }, true);

  // Photos that fail to load: honest fallback, never a stand-in image.
  document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded'); }, true);
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG') return;
    // A thumbnail that fails gets one retry with the full-size photo.
    if (img.dataset.full && img.src !== img.dataset.full) { img.src = img.dataset.full; delete img.dataset.full; return; }
    const slide = img.closest('.ph-slide');
    if (slide) {
      slide.classList.add('failed');
      img.remove();
      const ph = slide.closest('.ph');
      if (ph && !ph.querySelector('.ph-slide img') && !ph.querySelector('.ph-slide img[data-src]')) {
        const l = state.byId.get(ph.closest('[data-id]')?.dataset.id);
        if (l && Number(ph.dataset.count) === 1) { ph.querySelector('.ph-track')?.remove(); ph.querySelector('.ph-count')?.remove(); ph.insertAdjacentHTML('afterbegin', noPhoto(l)); }
      }
      return;
    }
    const btn = img.closest('.d-mosaic button, .d-strip button');
    if (btn) { btn.style.display = btn.closest('.d-mosaic') && btn === btn.parentElement.firstElementChild ? '' : 'none'; img.remove(); }
    if (img.closest('.hrow-ph')) img.remove();
  }, true);

  // Detail dialog
  const detail = $('#detail-dialog');
  detail.addEventListener('click', (e) => {
    const ph = e.target.closest('[data-photo]');
    if (ph) { openLightbox(Number(ph.dataset.photo)); return; }
    const d = e.target.closest('[data-dact]');
    if (d && current) {
      if (d.dataset.dact === 'save') {
        toggleSave(current.id);
        const s = state.saved.has(current.id);
        d.setAttribute('aria-pressed', String(s));
        d.setAttribute('aria-label', s ? 'Remove from shortlist' : 'Save to shortlist');
        d.innerHTML = `${icon(s ? 'heart-fill' : 'heart')}<span class="btn-label">${s ? 'Saved' : 'Save'}</span>`;
      } else {
        const wasHidden = state.hidden.has(current.id);
        toggleHide(current.id);
        if (!wasHidden) closeDetail(); else d.innerHTML = `${icon('eye-off')}<span class="btn-label">Hide</span>`;
      }
    }
    const more = e.target.closest('[data-more]');
    if (more) { const el = $('#d-desc'); const open = el.classList.toggle('clamped'); more.textContent = open ? 'Read the full post' : 'Show less'; more.setAttribute('aria-expanded', String(!open)); }
  });
  detail.addEventListener('close', () => {
    if (!location.hash.startsWith('#listing=')) return;
    if (openedFromApp) { openedFromApp = false; history.back(); } else history.replaceState(null, '', viewHash());
  });

  const lb = $('#lightbox');
  lb.addEventListener('click', (e) => { const n = e.target.closest('[data-lb]'); if (n) lbStep(Number(n.dataset.lb)); else if (e.target.classList.contains('lb-slide')) lb.close(); });
  $('#lb-track').addEventListener('scroll', () => {
    const track = $('#lb-track');
    cancelAnimationFrame(track._raf);
    track._raf = requestAnimationFrame(() => lbSync(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (lb.open) { if (e.key === 'ArrowRight') lbStep(1); if (e.key === 'ArrowLeft') lbStep(-1); }
    else if (e.key === '/' && state.view === 'browse' && !document.querySelector('dialog[open]') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); $('#q').focus(); }
  });

  // Sticky search bar shadow once it docks.
  const sb = $('#searchbar-wrap');
  new IntersectionObserver(([en]) => sb.classList.toggle('stuck', en.intersectionRatio < 1), { rootMargin: `-${parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10) + 1}px 0px 0px 0px`, threshold: [1] }).observe(sb);

  window.addEventListener('hashchange', route);
  addEventListener('storage', (e) => { if (e.key === STORE) { const s = loadStore(); state.saved = new Set(s.saved || []); state.hidden = new Set(s.hidden || []); renderView(); } });
}

// ---------- boot ----------
async function getJson(path) {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function loadData() {
  state.loaded = false;
  state.loadError = false;
  renderView();
  const [data, status] = await Promise.all([getJson('data/listings.json'), getJson('data/status.json')]);
  state.loadError = !data;
  state.listings = (data?.listings || []).filter((l) => l.price && l.listingType); // current schema only
  state.byId = new Map(state.listings.map((l) => [l.id, l]));
  state.dataKind = data?.dataKind || 'REAL';
  state.status = status;
  $('#sample-banner').hidden = !(state.dataKind === 'SAMPLE' || state.listings.some((l) => l.dataKind === 'SAMPLE'));
  state.maxShare = status?.criteria?.maxShare || 1700;
  if (state.f.maxPrice != null && state.f.maxPrice >= state.maxShare) state.f.maxPrice = null;
  if (state.f.sources) state.f.sources = state.f.sources.filter((id) => status?.sources?.some((s) => s.id === id && s.inDataset));
  if (state.f.sources && !state.f.sources.length) state.f.sources = null;
  state.loaded = true;
  $('#q').value = state.f.q;
  $('#sort').value = state.f.sort;
  renderMoveBy();
  route();
}

bind();
route();
await loadData();
