// Apartment Hunter front end: one NYC roommate search across every connected
// source. Reads data/listings.json + data/status.json from the scraper.
// Filters/saved/hidden are remembered in this browser only.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const STORE = 'apartment-hunter:v3';
const BOROS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island', 'New Jersey'];
const BORO_CLASS = { Manhattan: 'manhattan', Brooklyn: 'brooklyn', Queens: 'queens', Bronx: 'bronx', 'Staten Island': 'staten', 'New Jersey': 'nj' };
const TYPES = [
  ['ROOM_IN_SHARED_APARTMENT', 'Room in shared apartment'],
  ['ENTIRE_APARTMENT', 'Entire apartment'],
  ['SUBLET', 'Sublet'],
  ['LEASE_TAKEOVER', 'Lease takeover'],
];
const TYPE_PLURAL = { ROOM_IN_SHARED_APARTMENT: ['room in a shared apartment', 'rooms in shared apartments'], ENTIRE_APARTMENT: ['entire apartment', 'entire apartments'], SUBLET: ['sublet', 'sublets'], LEASE_TAKEOVER: ['lease takeover', 'lease takeovers'], UNKNOWN: ['listing', 'listings'] };

const DEFAULTS = {
  types: [], maxPrice: null, boros: [], hoods: [], moveBy: '', roommates: [], bedrooms: [],
  toggles: [], sources: null, q: '', roomType: 'any', postedBy: 'any',
  includeUnknown: false, showHidden: false, savedOnly: false, sort: 'price-asc',
};

// ---------- persistence ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
const stored = loadStore();
const state = {
  f: { ...structuredClone(DEFAULTS), ...(stored.f || {}) },
  saved: new Set(stored.saved || []),
  hidden: new Set(stored.hidden || []),
  listings: [], status: null, dataKind: 'REAL', maxShare: 1700,
};
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify({ f: state.f, saved: [...state.saved], hidden: [...state.hidden] })); } catch { /* storage unavailable */ }
}

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
function fmtDate(v) {
  if (!v?.date) return null;
  const d = new Date(`${v.date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return v.text;
  if (d.getTime() < Date.now()) return 'Now';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
const sourceMeta = (id) => state.status?.sources?.find((s) => s.id === id);
const sourceName = (id) => sourceMeta(id)?.name || id;
const sourceNames = (l) => [...new Set(l.sources.map((s) => s.label))];
const LAUNDRY = { in_unit: 'W/D in unit', in_building: 'Laundry in building', on_site: 'Laundry on site', none: 'No laundry on site' };

// Provenance labels shown next to facts.
function basisLabel(basis, l) {
  if (basis === 'structured') return [`Stated by ${sourceNames(l)[0]}`, 'stated'];
  if (basis === 'explicit') return ['Stated in listing', 'stated'];
  if (basis === 'calculated') return ['Calculated', 'calc'];
  if (basis === 'inferred') return ['Estimated', 'est'];
  if (basis === 'likely') return ['Likely your share', 'likely'];
  return ['Not stated', 'unknown'];
}
const chip = (basis, l) => { const [t, c] = basisLabel(basis, l); return `<span class="basis ${c}">${esc(t)}</span>`; };

// ---------- listing presentation ----------
function typeBanner(l) {
  const t = l.listingType.value;
  const beds = l.bedrooms.value;
  if (t === 'ROOM_IN_SHARED_APARTMENT') return ['room', l.availableRooms.value > 1 ? `${l.availableRooms.value} rooms available` : 'Room available'];
  if (t === 'ENTIRE_APARTMENT') return ['entire', beds === 0 ? 'Entire studio' : beds ? `Entire ${beds}BR` : 'Entire apartment'];
  if (t === 'SUBLET') return ['sublet', 'Sublet'];
  if (t === 'LEASE_TAKEOVER') return ['takeover', beds === 0 ? 'Lease takeover · studio' : beds ? `Lease takeover · ${beds}BR` : 'Lease takeover'];
  return ['unknown', 'Listing · type not stated'];
}

function priceBlock(l, { large = false } = {}) {
  const p = l.price;
  const cls = large ? 'price large' : 'price';
  if (p.status === 'known') {
    const range = p.shareMax && p.shareMax !== p.share ? `–${money(p.shareMax)}` : '';
    let sub;
    if (p.split === 'whole_unit') sub = 'Entire unit — you\'d pay the full rent';
    else if (p.split === 'even_split_stated') sub = `Even split of ${money(p.total)} — split stated in listing`;
    else if (p.split === 'room_price_stated') sub = `Your room · ${money(p.total)} total apartment`;
    else sub = range ? 'Your share · several rooms at different prices' : 'Your share';
    return `<div class="${cls}">${money(p.share)}${esc(range)}<small>/mo</small></div><div class="price-sub">${esc(sub)} ${chip(p.shareBasis, l)}</div>`;
  }
  if (p.status === 'needs_confirmation') {
    return `<div class="${cls} total">${money(p.total)}<small>/mo total</small></div><div class="price-sub warn">Your share: needs confirmation — the listing only gives total rent</div>`;
  }
  return `<div class="${cls} unknown">Price not listed</div><div class="price-sub">Ask the poster</div>`;
}

function roommatesFact(l) {
  const t = l.listingType.value;
  if (l.roommates.value != null) {
    const n = l.roommates.value;
    return { html: `${n === 0 ? 'No existing roommates' : plural(n, 'existing roommate', 'existing roommates')} <span class="basis stated">Stated</span>`, known: true };
  }
  if (t === 'ENTIRE_APARTMENT' || t === 'LEASE_TAKEOVER') return { html: 'Entire unit', known: true };
  return { html: 'Roommates not stated', known: false };
}

function apartmentFact(l) {
  const beds = l.bedrooms.value;
  const baths = l.bathrooms.value;
  if (beds == null) return { text: 'Bedrooms not stated', known: false };
  const size = beds === 0 ? 'Studio' : `${beds}BR`;
  const bath = baths ? ` · ${baths} bath${baths === 1 ? '' : 's'}${l.bathroomType.value === 'shared' ? ' (shared)' : ''}` : '';
  if (l.listingType.value === 'ROOM_IN_SHARED_APARTMENT') return { text: `Room in a ${size.toLowerCase() === 'studio' ? 'studio' : size}${bath}`, known: true };
  return { text: `${size}${bath}`, known: true };
}

function whereHtml(l, tag = 'div', cls = 'where') {
  const hood = l.neighborhood.value;
  const boro = l.borough.value;
  const bar = `<span class="boro-bar" style="background:var(--boro-${BORO_CLASS[boro] || 'unknown'})"></span>`;
  if (!hood && !boro) return `<${tag} class="${cls}">${bar}<span class="muted">Location not stated</span></${tag}>`;
  const est = l.borough.basis === 'inferred' && !hood ? ' <span class="basis est" title="Estimated from the listing\'s map location">Estimated</span>' : '';
  return `<${tag} class="${cls}">${bar}<span>${esc(hood || boro)}${hood && boro ? ` <span class="muted">· ${esc(boro)}</span>` : ''}${est}</span></${tag}>`;
}

// ---------- photos ----------
const HOUSE_SVG = `<svg viewBox="0 0 120 80" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
  <path d="M8 78V34h26v44M34 78V18h30v60M64 78V40h22v38M86 78V26h26v52"/><path d="M14 42h6M24 42h4M14 52h6M24 52h4M14 62h6M24 62h4M41 26h6M52 26h6M41 38h6M52 38h6M41 50h6M52 50h6M44 66h12v12M70 48h4M78 48h4M70 58h4M78 58h4M92 34h5M101 34h5M92 44h5M101 44h5M92 54h5M101 54h5M2 78h116"/></svg>`;

function noPhoto(l) {
  const url = safeUrl(l.originalUrl);
  return `<div class="no-photo">${HOUSE_SVG}<strong>Photos unavailable</strong>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">View original listing →</a>` : '<span>This post didn\'t include photos</span>'}</div>`;
}

function imgTag(p, l, i, thumb) {
  const src = thumb ? p.thumb || p.url : p.url;
  return `<img src="${esc(src)}" alt="Photo ${i + 1} of ${esc(l.title || 'listing')}${p.caption ? ` — ${esc(p.caption)}` : ''}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('loaded');this.parentElement.classList.add('done')" onerror="window.__photoFailed(this)">${p.caption && p.caption !== 'This room' ? `<span class="photo-caption">${esc(p.caption)}</span>` : ''}`;
}

window.__photoFailed = (img) => {
  const slide = img.closest('.media-slide');
  const mediaEl = img.closest('.media');
  slide?.classList.add('done');
  img.remove();
  if (mediaEl && !mediaEl.querySelector('img') && Number(mediaEl.dataset.count) === 1) {
    const l = state.listings.find((x) => x.id === mediaEl.closest('[data-id]')?.dataset.id);
    if (l) {
      mediaEl.querySelector('.media-track')?.remove();
      mediaEl.querySelector('.photo-count')?.remove();
      mediaEl.insertAdjacentHTML('afterbegin', noPhoto(l));
    }
  }
};

function sourceBadge(l) {
  const names = sourceNames(l);
  const url = safeUrl(l.originalUrl);
  const label = `${esc(names[0].toUpperCase())}${names.length > 1 ? ` <span class="plus">+${names.length - 1}</span>` : ''}`;
  return url
    ? `<a class="source-badge" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open the original listing on ${esc(names[0])}">${label} ↗</a>`
    : `<span class="source-badge">${label}</span>`;
}

function media(l) {
  const saved = state.saved.has(l.id);
  const sample = l.dataKind === 'SAMPLE' ? '<span class="sample-tag">SAMPLE</span>' : '';
  const saveBtn = `<button type="button" class="save-btn" data-act="save" aria-pressed="${saved}" aria-label="${saved ? 'Remove from saved' : 'Save listing'}"><svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>`;
  if (!l.photos.length) return `<div class="media">${noPhoto(l)}<div class="media-tags">${sourceBadge(l)}${sample}</div>${saveBtn}</div>`;
  const n = l.photos.length;
  const slides = l.photos.map((p, i) => `<div class="media-slide" data-i="${i}">${i === 0 ? imgTag(p, l, i, true) : ''}</div>`).join('');
  const nav = n > 1 ? '<button type="button" class="media-nav prev" data-act="prev" aria-label="Previous photo">‹</button><button type="button" class="media-nav next" data-act="next" aria-label="Next photo">›</button>' : '';
  const dots = n > 1 ? `<div class="media-dots">${l.photos.slice(0, 7).map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')}</div>` : '';
  const count = `<span class="photo-count" aria-label="${n} photos"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-6-6-8 8"/></svg><span><span class="pc-i">1</span>/${n}</span></span>`;
  return `<div class="media" data-count="${n}" data-idx="0"><div class="media-track">${slides}</div>${nav}${dots}${count}<div class="media-tags">${sourceBadge(l)}${sample}</div>${saveBtn}</div>`;
}

// ---------- card ----------
function card(l) {
  const hidden = state.hidden.has(l.id);
  const [tcls, ttext] = typeBanner(l);
  const rm = roommatesFact(l);
  const apt = apartmentFact(l);
  const move = fmtDate(l.moveIn.value);
  const tags = [
    l.furnished.value === true ? '<span class="tag">Furnished</span>' : '',
    l.roomType.value === 'private' && l.listingType.value !== 'ENTIRE_APARTMENT' ? '<span class="tag">Private room</span>' : '',
    l.roomType.value === 'shared' ? '<span class="tag">Shared room</span>' : '',
    l.utilitiesIncluded.value === true ? '<span class="tag">Utilities incl.</span>' : '',
    l.postedBy.value ? `<span class="tag broker">${l.postedBy.value === 'broker' ? 'Broker' : 'Company'} listing</span>` : '',
  ].join('');
  const names = sourceNames(l);
  return `<article class="card type-${tcls}${hidden ? ' is-hidden' : ''}" data-id="${esc(l.id)}">
    ${media(l)}
    <button type="button" class="card-open" data-act="open">Open details: ${esc(l.title || 'listing')}</button>
    <div class="card-body">
      <div class="type-banner ${tcls}">${esc(ttext)}</div>
      <div class="price-wrap">${priceBlock(l)}</div>
      ${whereHtml(l)}
      <ul class="facts">
        <li class="${rm.known ? '' : 'unknown'}"><span class="ico" aria-hidden="true">👥</span>${rm.html}</li>
        <li class="${apt.known ? '' : 'unknown'}"><span class="ico" aria-hidden="true">🛏</span>${esc(apt.text)}</li>
        <li class="${move ? '' : 'unknown'}"><span class="ico" aria-hidden="true">📅</span>${move ? `Move-in ${esc(move)}` : 'Move-in not stated'}</li>
        <li class="${l.laundry.value ? '' : 'unknown'}"><span class="ico" aria-hidden="true">🧺</span>${l.laundry.value ? LAUNDRY[l.laundry.value] : 'Laundry not stated'}</li>
      </ul>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <div class="card-foot">
        <span>${names.length > 1 ? `Found on ${esc(names.join(' · '))}` : `From ${esc(names[0])}`}${l.postedAt ? ` · ${l.postedAtApproximate ? '~' : ''}${esc(ago(l.postedAt))}` : ''}</span>
        <span class="spacer"></span>
        <button type="button" class="hide-btn" data-act="hide">${hidden ? 'Unhide' : 'Hide'}</button>
      </div>
    </div>
  </article>`;
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
const UNKNOWN_LABEL = { type: 'type', price: 'price', where: 'location', moveIn: 'move-in date', roommates: 'roommates', bedrooms: 'bedrooms', laundry: 'laundry', furnished: 'furnishing', privateRoom: 'room type', roomType: 'room type' };

function applyFilters() {
  const f = state.f;
  const results = [];
  const unknownOnly = {}; // filter -> count of listings excluded only because they don't say
  for (const l of state.listings) {
    if (!f.showHidden && state.hidden.has(l.id)) continue;
    if (f.savedOnly && !state.saved.has(l.id)) continue;
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

// ---------- summary sentence ----------
function summaryText(results) {
  const f = state.f;
  const n = results.length;
  let what;
  if (f.types.length === 1) what = plural(n, ...TYPE_PLURAL[f.types[0]]);
  else what = plural(n, 'listing', 'listings');
  const parts = [`<strong>${what}</strong>`];
  const where = [...f.hoods, ...f.boros];
  if (where.length) parts.push(`in ${esc(where.length > 3 ? `${where.slice(0, 3).join(', ')} +${where.length - 3}` : where.join(', '))}`);
  const crit = [];
  if (f.maxPrice != null && f.maxPrice < state.maxShare) crit.push(`your share ≤ ${money(f.maxPrice)}`);
  if (f.moveBy) crit.push(`move in by ${fmtDate({ date: f.moveBy })}`);
  if (f.roommates.length) crit.push(`${f.roommates.map((r) => (r === '3' ? '3+' : r)).join('–')} existing roommates`);
  if (f.bedrooms.length) crit.push(`${f.bedrooms.map((b) => (b === '0' ? 'studio' : b === '4' ? '4+BR' : `${b}BR`)).join('/')}`);
  if (f.toggles.includes('laundry:unit')) crit.push('W/D in unit');
  else if (f.toggles.includes('laundry:building')) crit.push('laundry in building');
  if (f.toggles.includes('furnished')) crit.push('furnished');
  if (crit.length) parts.push(`· ${esc(crit.join(', '))}`);
  const srcNames = [...new Set(results.flatMap((l) => l.sources.map((s) => (sourceMeta(s.source) ? sourceName(s.source) : s.label))))];
  const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const byType = {};
  for (const l of results) byType[l.listingType.value] = (byType[l.listingType.value] || 0) + 1;
  const mix = f.types.length === 1 ? '' : Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${c} ${TYPE_PLURAL[t][c === 1 ? 0 : 1]}`).join(' · ');
  return `${parts.join(' ')}${srcNames.length ? ` <span class="muted">— from ${esc(joinAnd(srcNames))}</span>` : ''}${mix ? `<br><span class="mix">${esc(mix)}</span>` : ''}`;
}

// ---------- rendering ----------
function render() {
  const { results, unknownOnly } = applyFilters();
  $('#grid').innerHTML = results.map(card).join('');
  $('#summary').innerHTML = state.listings.length ? summaryText(results) : '';
  const hiddenUnknown = Object.entries(unknownOnly);
  const note = $('#unknown-note');
  note.hidden = !hiddenUnknown.length || state.f.includeUnknown;
  if (!note.hidden) {
    const total = hiddenUnknown.reduce((a, [, c]) => a + c, 0);
    note.innerHTML = `${plural(total, 'more listing doesn\'t', 'more listings don\'t')} say their ${esc(hiddenUnknown.map(([k]) => UNKNOWN_LABEL[k] || k).join(' / '))} and ${total === 1 ? 'is' : 'are'} hidden by your filters. <button type="button" class="link" data-include-unknown>Include them</button>`;
  }
  $('#saved-count').textContent = state.saved.size ? `(${state.saved.size})` : '';
  renderActiveFilters();
  const empty = $('#empty');
  empty.hidden = results.length > 0;
  if (!state.listings.length) {
    const anyLive = state.status?.sources?.some((s) => ['LIVE', 'LIVE_WITH_LIMITATIONS'].includes(s.status));
    empty.innerHTML = `<h2>No live listings are currently available</h2><p>${anyLive ? 'Sources are connected but returned no listings within your budget right now.' : 'Connect a supported source to begin searching.'}</p><button type="button" class="btn primary" data-open-status>See source status</button>`;
  } else if (!results.length) {
    empty.innerHTML = '<h2>Nothing matches all of these yet</h2><p>Try a higher budget, more areas, or fewer must-haves.</p><button type="button" class="btn" data-reset>Reset filters</button>';
  }
  persist();
}

function renderActiveFilters() {
  const f = state.f;
  const n = [f.q, f.roomType !== 'any', f.postedBy !== 'any', f.includeUnknown, f.showHidden].filter(Boolean).length;
  $('#more-count').hidden = !n;
  $('#more-count').textContent = n;
  const any = f.types.length || (f.maxPrice != null && f.maxPrice < state.maxShare) || f.boros.length || f.hoods.length || f.moveBy || f.roommates.length || f.bedrooms.length || f.toggles.length || f.sources || n;
  $('#active-filters').innerHTML = any ? '<button type="button" class="clear-all" data-reset>Clear all filters</button>' : '';
  $('#where-btn').textContent = f.hoods.length ? `${plural(f.hoods.length, 'neighborhood', 'neighborhoods')} ✓` : 'Neighborhoods…';
}

function renderTypes() {
  const counts = {};
  for (const l of state.listings) counts[l.listingType.value] = (counts[l.listingType.value] || 0) + 1;
  $('#types').innerHTML = [['', 'Anything'], ...TYPES].map(([v, label]) => {
    const on = v ? state.f.types.includes(v) : !state.f.types.length;
    const c = v ? counts[v] || 0 : state.listings.length;
    return `<button type="button" data-value="${v}" aria-pressed="${on}"${v && !c ? ' disabled' : ''}>${esc(label)} <span class="n">${c}</span></button>`;
  }).join('');
}

function renderBoros() {
  const counts = {};
  for (const l of state.listings) if (l.borough.value) counts[l.borough.value] = (counts[l.borough.value] || 0) + 1;
  $('#boros').innerHTML = BOROS.filter((b) => counts[b]).map((b) => `<button type="button" data-value="${esc(b)}" aria-pressed="${state.f.boros.includes(b)}"><span class="boro-dot" style="background:var(--boro-${BORO_CLASS[b]})"></span>${esc(b === 'New Jersey' ? 'NJ' : b)}</button>`).join('');
}

function renderSources() {
  const st = state.status?.sources || [];
  const selected = state.f.sources;
  const rows = st.map((s) => {
    const live = (s.inDataset || 0) > 0;
    const on = live && (!selected || selected.includes(s.id));
    const note = live ? `${s.inDataset}` : ({ AUTH_REQUIRED: 'not connected', UNVERIFIED: 'off — terms unverified', SOURCE_BLOCKED: 'blocked', NO_PUBLIC_ACCESS: 'not permitted' }[s.status] || 'no listings');
    return `<label class="src-check${live ? '' : ' off'}"><input type="checkbox" data-src="${esc(s.id)}" ${on ? 'checked' : ''} ${live ? '' : 'disabled'}><span>${esc(s.name)}</span><span class="n">${esc(note)}</span></label>`;
  });
  $('#sources').innerHTML = rows.join('') + '<button type="button" class="link" data-open-status>Why these sources?</button>';
}

function renderMoveBy() {
  const sel = $('#move-by');
  const now = new Date();
  const opts = [['', 'Any time'], [now.toISOString().slice(0, 10), 'Now / ASAP']];
  for (let i = 0; i < 9; i++) {
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
    opts.push([end.toISOString().slice(0, 10), `By end of ${end.toLocaleDateString('en-US', { month: 'long', ...(end.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`]);
  }
  if (state.f.moveBy && !opts.some(([v]) => v === state.f.moveBy)) opts.push([state.f.moveBy, `By ${fmtDate({ date: state.f.moveBy })}`]);
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
}

function syncControls() {
  const f = state.f;
  const max = f.maxPrice ?? state.maxShare;
  $('#max-price').value = max;
  $('#max-price-out').textContent = max >= state.maxShare ? `Up to ${money(state.maxShare)}` : money(max);
  $('#move-by').value = f.moveBy;
  $$('#roommates button').forEach((b) => b.setAttribute('aria-pressed', f.roommates.includes(b.dataset.value)));
  $$('#bedrooms button').forEach((b) => b.setAttribute('aria-pressed', f.bedrooms.includes(b.dataset.value)));
  $$('#toggles button').forEach((b) => b.setAttribute('aria-pressed', f.toggles.includes(b.dataset.t)));
  for (const [id, key] of [['roomtype', 'roomType'], ['postedby', 'postedBy']]) $$(`#${id} button`).forEach((b) => b.setAttribute('aria-checked', b.dataset.value === f[key]));
  $('#q').value = f.q;
  $('#include-unknown').checked = f.includeUnknown;
  $('#show-hidden').checked = f.showHidden;
  $('#sort').value = f.sort;
  $('#saved-toggle').setAttribute('aria-pressed', f.savedOnly);
  renderTypes();
  renderBoros();
  renderSources();
}

function renderWhere() {
  const q = $('#hood-q').value.trim().toLowerCase();
  const groups = new Map();
  for (const l of state.listings) {
    const boro = l.borough.value || 'Location not stated';
    if (!groups.has(boro)) groups.set(boro, new Map());
    if (l.neighborhood.value) groups.get(boro).set(l.neighborhood.value, (groups.get(boro).get(l.neighborhood.value) || 0) + 1);
  }
  $('#where-list').innerHTML = [...groups.entries()]
    .sort(([a], [b]) => (BOROS.indexOf(a) + 99) % 99 - (BOROS.indexOf(b) + 99) % 99)
    .map(([boro, hoods]) => {
      const items = [...hoods.entries()].filter(([h]) => !q || h.toLowerCase().includes(q) || boro.toLowerCase().includes(q)).sort(([a], [b]) => a.localeCompare(b));
      if (!items.length) return '';
      return `<div class="boro-group"><div class="boro-head"><span class="boro-bar" style="background:var(--boro-${BORO_CLASS[boro] || 'unknown'})"></span>${esc(boro)}</div>
        <div class="hood-grid">${items.map(([h, n]) => `<label><input type="checkbox" data-hood="${esc(h)}" ${state.f.hoods.includes(h) ? 'checked' : ''}>${esc(h)}<span class="n">${n}</span></label>`).join('')}</div></div>`;
    }).join('') || '<p class="muted">No neighborhoods yet.</p>';
}

// ---------- carousel & swipe ----------
function showSlide(mediaEl, idx) {
  const n = Number(mediaEl.dataset.count);
  if (!n) return;
  const i = (idx + n) % n;
  mediaEl.dataset.idx = i;
  const l = state.listings.find((x) => x.id === mediaEl.closest('[data-id]')?.dataset.id);
  for (const j of [i, (i + 1) % n]) {
    const slide = mediaEl.querySelector(`.media-slide[data-i="${j}"]`);
    if (slide && !slide.querySelector('img') && !slide.classList.contains('done') && l) slide.innerHTML = imgTag(l.photos[j], l, j, true);
  }
  mediaEl.querySelector('.media-track').style.transform = `translateX(-${i * 100}%)`;
  $$('.media-dots span', mediaEl).forEach((d, k) => d.classList.toggle('on', k === Math.min(i, 6)));
  const pc = mediaEl.querySelector('.pc-i');
  if (pc) pc.textContent = i + 1;
}

// Horizontal swipe on touch devices; calls onSwipe(+1 | -1).
function onSwipe(root, selector, handler) {
  let start = null;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(selector);
    if (el && e.pointerType !== 'mouse') start = { x: e.clientX, y: e.clientY, el };
  });
  root.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      handler(start.el, dx < 0 ? 1 : -1);
      start.el.dataset.swiped = '1';
      const el = start.el;
      setTimeout(() => { delete el.dataset.swiped; }, 350);
    }
    start = null;
  });
}

// ---------- detail ----------
let current = null;
let photoIdx = 0;
function openDetail(id, { push = true } = {}) {
  const l = state.listings.find((x) => x.id === id);
  if (!l) return;
  current = l;
  photoIdx = 0;
  const names = sourceNames(l);
  const [tcls, ttext] = typeBanner(l);
  const photos = l.photos;
  const gallery = photos.length
    ? `<div class="d-gallery">
        <div class="d-hero-wrap" id="d-hero-wrap">
          <img class="d-hero" id="d-hero" src="${esc(photos[0].url)}" alt="Photo 1 of ${photos.length}" referrerpolicy="no-referrer">
          ${photos.length > 1 ? '<button type="button" class="media-nav prev" data-d="-1" aria-label="Previous photo">‹</button><button type="button" class="media-nav next" data-d="1" aria-label="Next photo">›</button>' : ''}
          <span class="photo-count"><span><span id="d-idx">1</span>/${photos.length}</span><span id="d-cap">${esc(photos[0].caption ? `${photos[0].caption} · ` : '')}photo from ${esc(names[0])}</span></span>
        </div>
        ${photos.length > 1 ? `<div class="d-thumbs">${photos.map((p, i) => `<button type="button" data-thumb="${i}" aria-current="${i === 0}" aria-label="Photo ${i + 1}${p.caption ? `: ${esc(p.caption)}` : ''}"><img src="${esc(p.thumb || p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()">${p.caption && p.caption !== 'This room' ? '<span class="thumb-tag">Shared</span>' : ''}</button>`).join('')}</div>` : ''}
      </div>`
    : `<div class="d-gallery nophoto"><div class="media" style="aspect-ratio:21/9">${noPhoto(l)}</div></div>`;

  const unknown = [];
  const F = (label, value, basis) => {
    if (value == null) { unknown.push(label); return ''; }
    return `<div class="d-fact"><dt><span>${esc(label)}</span>${chip(basis, l)}</dt><dd>${value}</dd></div>`;
  };
  const yesNo = (v) => (v == null ? null : v ? 'Yes' : 'No');
  const rm = l.roommates.value;
  const facts = [
    F('Existing roommates', rm != null ? (rm === 0 ? 'None' : String(rm)) : null, l.roommates.basis),
    F('Bedrooms in apartment', l.bedrooms.value != null ? (l.bedrooms.value === 0 ? 'Studio' : String(l.bedrooms.value)) : null, l.bedrooms.basis),
    F('Bathrooms', l.bathrooms.value != null ? `${l.bathrooms.value}${l.bathroomType.value ? ` (${l.bathroomType.value})` : ''}` : null, l.bathrooms.basis),
    F('Rooms available', l.availableRooms.value != null ? String(l.availableRooms.value) : null, l.availableRooms.basis),
    F('Move-in', fmtDate(l.moveIn.value), l.moveIn.basis),
    F('Lease', l.leaseLength.value ? esc(l.leaseLength.value) : null, l.leaseLength.basis),
    F('Laundry', l.laundry.value ? LAUNDRY[l.laundry.value] : null, l.laundry.basis),
    F('Furnished', yesNo(l.furnished.value), l.furnished.basis),
    F('Room', l.roomType.value ? (l.roomType.value === 'private' ? 'Private' : 'Shared') : null, l.roomType.basis),
    F('Utilities included', yesNo(l.utilitiesIncluded.value), l.utilitiesIncluded.basis),
    F('Pets', l.pets.value ? esc(l.pets.value) : null, l.pets.basis),
    F('Roommate preference', l.genderPreference.value ? esc(l.genderPreference.value) : null, l.genderPreference.basis),
  ].join('');

  const p = l.price;
  const priceRows = [
    ['Your share', p.share != null ? `${money(p.share)}${p.shareMax && p.shareMax !== p.share ? `–${money(p.shareMax)}` : ''}/mo` : 'Needs confirmation', p.share != null ? chip(p.shareBasis, l) : '<span class="basis unknown">Not stated</span>'],
    ['Total apartment', p.total != null ? `${money(p.total)}/mo` : 'Not stated', p.total != null ? chip(p.totalBasis, l) : ''],
    ['Split', { whole_unit: 'Entire unit — you pay it all', even_split_stated: 'Evenly — stated in listing', room_price_stated: 'Room price stated separately' }[p.split] || (p.share != null ? 'Your price as listed' : 'Not stated'), ''],
  ].map(([k, v, c]) => `<tr><th>${k}</th><td>${esc(v)} ${c}</td></tr>`).join('');

  const contact = safeUrl(l.contact.url);
  const emails = (l.contactEmails || []).slice(0, 1).map((e) => `<a class="btn" href="mailto:${esc(e)}">Email the poster</a>`).join('');
  $('#detail-content').innerHTML = `
    <div class="d-top">
      ${gallery}
      <button type="button" class="icon-close d-close" data-close aria-label="Close">×</button>
      ${l.dataKind === 'SAMPLE' ? '<span class="sample-tag d-sample">SAMPLE</span>' : ''}
    </div>
    <div class="d-body">
      <div>
        <div class="type-banner ${tcls}">${esc(ttext)}</div>
        <h2 class="d-title" id="detail-title">${esc(l.title || 'Listing')}</h2>
        ${whereHtml(l, 'div', 'where d-where')}
        <dl class="d-facts">${facts}</dl>
        ${unknown.length ? `<p class="d-unknown"><strong>Not stated in the listing:</strong> ${unknown.map(esc).join(' · ')}</p>` : ''}
        <section class="d-section">
          <h3>Description <span class="muted">— original text from ${esc(names.join(' and '))}</span></h3>
          ${l.description ? `<p class="d-desc">${esc(l.description)}</p>` : '<p class="d-desc muted">No description provided.</p>'}
          <p class="d-attrib">Posted${l.postedAt ? ` ${l.postedAtApproximate ? 'about ' : ''}${esc(ago(l.postedAt))}` : ' (date not shown)'} on ${esc(names[0])} · retrieved ${esc(ago(l.scrapedAt))}. Apartment Hunter doesn't own or verify this listing.</p>
        </section>
      </div>
      <aside class="d-side">
        <div class="d-card">
          ${priceBlock(l, { large: true })}
          <table class="price-table">${priceRows}</table>
          ${contact ? `<a class="btn accent" href="${esc(contact)}" target="_blank" rel="noopener noreferrer">Contact on ${esc(names[0])} ↗</a>` : ''}
          ${l.contact.method ? `<p class="muted small">${esc(l.contact.method)}</p>` : ''}
          ${emails}
          <button type="button" class="btn" data-act="save" data-id="${esc(l.id)}">${state.saved.has(l.id) ? '♥ Saved' : '♡ Save'}</button>
        </div>
        <div class="d-sources">
          <h3>Original listing${l.sources.length > 1 ? 's' : ''}</h3>
          ${l.sources.map((s) => (safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"><span><strong>View on ${esc(s.label)}</strong><small>${esc(new URL(s.url).hostname.replace(/^www\./, ''))}</small></span><span>→</span></a>` : `<div class="d-src-plain">${esc(s.label)}</div>`)).join('')}
          ${l.postedBy.value ? `<p class="muted small">This listing says it's posted by a ${l.postedBy.value === 'broker' ? 'real-estate broker' : 'company'}.</p>` : ''}
        </div>
      </aside>
    </div>`;
  const dlg = $('#detail-dialog');
  if (!dlg.open) dlg.showModal();
  $('#detail-content').scrollTop = 0;
  if (push) history.pushState({ listing: id }, '', `#listing=${encodeURIComponent(id)}`);
}

function detailShow(i) {
  if (!current?.photos.length) return;
  const n = current.photos.length;
  photoIdx = (i + n) % n;
  const ph = current.photos[photoIdx];
  $('#d-hero').src = ph.url;
  $('#d-hero').alt = `Photo ${photoIdx + 1} of ${n}`;
  $('#d-idx').textContent = photoIdx + 1;
  $('#d-cap').textContent = `${ph.caption ? `${ph.caption} · ` : ''}photo from ${sourceNames(current)[0]}`;
  $$('.d-thumbs button').forEach((b) => b.setAttribute('aria-current', Number(b.dataset.thumb) === photoIdx));
  $(`.d-thumbs button[data-thumb="${photoIdx}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function lightbox(i) {
  if (!current?.photos.length) return;
  const n = current.photos.length;
  photoIdx = (i + n) % n;
  const ph = current.photos[photoIdx];
  $('#lb-img').src = ph.url;
  $('#lb-img').alt = `Photo ${photoIdx + 1} of ${n}`;
  $('#lb-cap').textContent = `${photoIdx + 1} / ${n}${ph.caption ? ` · ${ph.caption}` : ''} · photo from ${sourceNames(current)[0]}`;
  const lb = $('#lightbox');
  if (!lb.open) lb.showModal();
}

// ---------- status & quality ----------
const STATUS_LABEL = {
  LIVE: 'LIVE', LIVE_WITH_LIMITATIONS: 'LIVE · LIMITED', AUTH_REQUIRED: 'NEEDS CREDENTIALS', ENVIRONMENT_BLOCKED: 'UNREACHABLE',
  SOURCE_BLOCKED: 'BLOCKED', NO_PUBLIC_ACCESS: 'NOT PERMITTED', MANUAL_ONLY: 'MANUAL ONLY', UNVERIFIED: 'OFF · TERMS UNVERIFIED',
};
function renderFreshness() {
  const st = state.status;
  const dot = $('#freshness-dot');
  if (!st?.generatedAt) {
    dot.className = 'dot down';
    $('#freshness-text').textContent = 'No data yet · see sources';
    return;
  }
  const live = st.sources.filter((s) => s.inDataset);
  dot.className = `dot ${live.length ? (live.every((s) => s.status === 'LIVE') ? 'live' : 'limited') : 'down'}`;
  const kind = st.dataKind === 'SAMPLE' ? 'SAMPLE' : 'live';
  $('#freshness-text').textContent = `${st.totals.listings} ${kind} listings from ${plural(live.length, 'source', 'sources')} · ${live.map((s) => `${s.inDataset} ${s.name}`).join(' · ')} · updated ${ago(st.generatedAt)}`;
}

function renderStatus() {
  const st = state.status;
  if (!st) {
    $('#status-body').innerHTML = '<p>No scraper run has been recorded yet. Run <code>npm run scrape</code>.</p>';
    return;
  }
  const t = st.totals;
  const bar = (label, v) => `<div class="qbar"><span>${esc(label)}</span><i style="--p:${v}%"></i><b>${v}%</b></div>`;
  const cov = (q) => {
    const c = q.coverage;
    return [['Your share', c.yourShare], ['Price or total', c.priceOrTotal], ['Listing type', c.listingType], ['Bedrooms', c.bedrooms], ['Roommates stated', c.roommatesStated], ['Neighborhood', c.neighborhood], ['Borough', c.borough], ['Move-in', c.moveIn], ['Laundry', c.laundry], ['Furnished', c.furnished], ['Photos', c.photos]].map(([k, v]) => bar(k, v)).join('');
  };
  const src = (s) => {
    const q = s.quality;
    const discarded = Object.entries(s.discarded || {}).map(([r, n]) => `${n} ${r}`).join(', ');
    return `<div class="src">
      <div class="src-name">${esc(s.name)}</div>
      <span class="src-state ${esc(s.status)}">${esc(STATUS_LABEL[s.status] || s.status)}</span>
      <div class="src-meta">${s.retrieved ? `${s.retrieved} retrieved · <strong>${s.inDataset} in results</strong>${discarded ? ` · discarded: ${esc(discarded)}` : ''}` : esc(s.kind || '')}${s.lastSuccessAt ? ` · last success ${esc(ago(s.lastSuccessAt))}` : ''}</div>
      ${s.reason ? `<div class="src-reason">${esc(s.reason)}</div>` : ''}
      ${q ? `<div class="qgrid">${cov(q)}</div>
        <div class="src-meta">${Object.entries(q.types).map(([k, v]) => `${v} ${esc(TYPE_PLURAL[k]?.[v === 1 ? 0 : 1] || k)}`).join(' · ')} · ${q.needsConfirmation} need price confirmation · ${q.inferredFields} estimated values</div>` : ''}
    </div>`;
  };
  const ex = (s) => `<div class="src"><div class="src-name">${esc(s.name)}</div><span class="src-state ${esc(s.status)}">${esc(STATUS_LABEL[s.status] || s.status)}</span><div class="src-reason">${esc(s.reason)} <em>(checked ${esc(s.checkedAt)})</em></div></div>`;
  $('#status-body').innerHTML = `
    <p class="muted" style="margin:0">From the scraper run ${esc(ago(st.generatedAt))} (${esc(new Date(st.generatedAt).toLocaleString())}). Every number here comes from that run.</p>
    <div class="status-summary">
      <div class="stat"><b>${t.listings}</b><span>${st.dataKind === 'SAMPLE' ? 'SAMPLE' : 'live'} listings</span></div>
      <div class="stat"><b>${t.withPhotos}/${t.listings}</b><span>have photos</span></div>
      <div class="stat"><b>${t.photosLoaded}/${t.photosChecked}</b><span>photos verified loading</span></div>
      <div class="stat"><b>${t.duplicatesMerged}</b><span>duplicates merged</span></div>
    </div>
    <h3>Sources searched — coverage in current results</h3>
    <p class="muted small" style="margin:-6px 0 0">Coverage = share of this source's listings where the field is known. "Roommates stated" only counts numbers the listing actually states.</p>
    <div class="src-list">${st.sources.map(src).join('')}</div>
    <h3>Not searched, and why</h3>
    <div class="src-list">${(st.excluded || []).map(ex).join('')}</div>`;
}

// ---------- events ----------
const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
function update(patch) { Object.assign(state.f, patch); syncControls(); render(); }

function bind() {
  $('#max-price').addEventListener('input', (e) => update({ maxPrice: +e.target.value >= state.maxShare ? null : +e.target.value }));
  $('#move-by').addEventListener('change', (e) => update({ moveBy: e.target.value }));
  $('#sort').addEventListener('change', (e) => update({ sort: e.target.value }));
  $('#q').addEventListener('input', (e) => update({ q: e.target.value }));
  $('#include-unknown').addEventListener('change', (e) => update({ includeUnknown: e.target.checked }));
  $('#show-hidden').addEventListener('change', (e) => update({ showHidden: e.target.checked }));
  $('#saved-toggle').addEventListener('click', () => update({ savedOnly: !state.f.savedOnly }));
  $('#types').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) update({ types: b.dataset.value ? toggleIn(state.f.types, b.dataset.value) : [] });
  });
  $('#boros').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ boros: toggleIn(state.f.boros, b.dataset.value) }); });
  for (const key of ['roommates', 'bedrooms']) {
    $(`#${key}`).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ [key]: toggleIn(state.f[key], b.dataset.value) }); });
  }
  $('#toggles').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    let t = toggleIn(state.f.toggles, b.dataset.t);
    if (b.dataset.t.startsWith('laundry:') && t.includes(b.dataset.t)) t = t.filter((x) => !x.startsWith('laundry:') || x === b.dataset.t);
    update({ toggles: t });
  });
  for (const [id, key] of [['roomtype', 'roomType'], ['postedby', 'postedBy']]) {
    $(`#${id}`).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ [key]: b.dataset.value }); });
  }
  $('#sources').addEventListener('change', (e) => {
    const live = (state.status?.sources || []).filter((s) => s.inDataset).map((s) => s.id);
    const checked = $$('#sources input:checked').map((i) => i.dataset.src);
    update({ sources: checked.length === live.length ? null : checked });
  });
  $('#where-btn').addEventListener('click', () => { renderWhere(); $('#where-dialog').showModal(); });
  $('#hood-q').addEventListener('input', renderWhere);
  $('#where-list').addEventListener('change', (e) => { if (e.target.dataset.hood) update({ hoods: toggleIn(state.f.hoods, e.target.dataset.hood) }); });
  $('#where-clear').addEventListener('click', () => { update({ hoods: [], boros: [] }); renderWhere(); });
  $('#more-btn').addEventListener('click', () => $('#more-dialog').showModal());
  $('#reset-btn').addEventListener('click', () => { state.f = { ...structuredClone(DEFAULTS), sort: state.f.sort }; syncControls(); render(); });

  const openStatus = () => { renderStatus(); $('#status-dialog').showModal(); };
  $('#freshness').addEventListener('click', openStatus);
  $('#foot-status').addEventListener('click', openStatus);

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close();
    if (e.target.closest('[data-open-status]')) openStatus();
    if (e.target.closest('[data-reset]')) $('#reset-btn').click();
    if (e.target.closest('[data-include-unknown]')) update({ includeUnknown: true });
    if (e.target.matches('dialog')) e.target.close();
  });

  const grid = $('#grid');
  onSwipe(grid, '.media[data-count]', (m, d) => showSlide(m, Number(m.dataset.idx) + d));
  grid.addEventListener('click', (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    if (e.target.closest('a')) return; // source badge / links open the original listing
    const id = cardEl.dataset.id;
    const act = e.target.closest('[data-act]');
    const mediaEl = cardEl.querySelector('.media');
    if (act?.dataset.act === 'prev' || act?.dataset.act === 'next') { showSlide(mediaEl, Number(mediaEl.dataset.idx) + (act.dataset.act === 'next' ? 1 : -1)); return; }
    if (act?.dataset.act === 'save') { toggleSave(id); return; }
    if (act?.dataset.act === 'hide') { if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id); render(); return; }
    if (!mediaEl?.dataset.swiped) openDetail(id);
  });

  const detail = $('#detail-dialog');
  detail.addEventListener('click', (e) => {
    const d = e.target.closest('[data-d]');
    if (d) detailShow(photoIdx + Number(d.dataset.d));
    const th = e.target.closest('[data-thumb]');
    if (th) detailShow(Number(th.dataset.thumb));
    if (e.target.id === 'd-hero' && !$('#d-hero-wrap')?.dataset.swiped) lightbox(photoIdx);
    const sv = e.target.closest('[data-act="save"]');
    if (sv) { toggleSave(sv.dataset.id); sv.textContent = state.saved.has(sv.dataset.id) ? '♥ Saved' : '♡ Save'; }
  });
  onSwipe(detail, '#d-hero-wrap', (_, d) => detailShow(photoIdx + d));
  detail.addEventListener('close', () => { if (location.hash.startsWith('#listing=')) history.pushState({}, '', location.pathname + location.search); });
  const lb = $('#lightbox');
  lb.addEventListener('click', (e) => { const n = e.target.closest('[data-lb]'); if (n) lightbox(photoIdx + Number(n.dataset.lb)); });
  onSwipe(lb, '.lb-figure', (_, d) => lightbox(photoIdx + d));
  document.addEventListener('keydown', (e) => {
    if (lb.open) { if (e.key === 'ArrowRight') lightbox(photoIdx + 1); if (e.key === 'ArrowLeft') lightbox(photoIdx - 1); }
    else if (detail.open) { if (e.key === 'ArrowRight') detailShow(photoIdx + 1); if (e.key === 'ArrowLeft') detailShow(photoIdx - 1); }
  });
  window.addEventListener('popstate', routeFromHash);
}

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
  const btn = $(`.card[data-id="${CSS.escape(id)}"] .save-btn`);
  if (btn) btn.setAttribute('aria-pressed', state.saved.has(id));
  $('#saved-count').textContent = state.saved.size ? `(${state.saved.size})` : '';
  if (state.f.savedOnly) render(); else persist();
}

function routeFromHash() {
  const m = location.hash.match(/listing=([^&]+)/);
  if (m) openDetail(decodeURIComponent(m[1]), { push: false });
  else if ($('#detail-dialog').open) $('#detail-dialog').close();
}

// ---------- boot ----------
async function getJson(path) {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function loadData() {
  const [data, status] = await Promise.all([getJson('data/listings.json'), getJson('data/status.json')]);
  state.listings = (data?.listings || []).filter((l) => l.price && l.listingType); // current schema only
  state.dataKind = data?.dataKind || 'REAL';
  state.status = status;
  $('#sample-banner').hidden = !(state.dataKind === 'SAMPLE' || state.listings.some((l) => l.dataKind === 'SAMPLE'));
  state.maxShare = status?.criteria?.maxShare || 1700;
  $('#max-price').max = state.maxShare;
  if (state.f.maxPrice != null && state.f.maxPrice >= state.maxShare) state.f.maxPrice = null;
  if (state.f.sources) state.f.sources = state.f.sources.filter((id) => status?.sources?.some((s) => s.id === id && s.inDataset));
  if (state.f.sources && !state.f.sources.length) state.f.sources = null;
  renderMoveBy();
  renderFreshness();
  syncControls();
  render();
  routeFromHash();
}

bind();
await loadData();
