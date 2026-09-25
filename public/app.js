// Apartment Hunter front end. Reads data/listings.json + data/status.json
// produced by the scraper; filters, sorts and renders them in the browser.
// Saved/hidden listings and filters are remembered in this browser only.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const STORE = 'apartment-hunter:v2';
const BORO_ORDER = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island', 'New Jersey', 'Not specified'];
const BORO_CLASS = { Manhattan: 'manhattan', Brooklyn: 'brooklyn', Queens: 'queens', Bronx: 'bronx', 'Staten Island': 'staten', 'New Jersey': 'nj' };
const NONE = '__none__';

const DEFAULTS = {
  maxPrice: 1700, hoods: [], boros: [], moveBy: '', bedrooms: ['1', '2', '3'], roommates: [],
  laundry: 'any', furnished: 'any', roomType: 'any', sources: [], q: '',
  photosOnly: false, knownPriceOnly: false, showHidden: false, savedOnly: false, sort: 'price-asc',
};

// ---------- persistence (per-browser convenience only) ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
const stored = loadStore();
const state = {
  f: { ...DEFAULTS, ...(stored.f || {}) },
  saved: new Set(stored.saved || []),
  hidden: new Set(stored.hidden || []),
  listings: [],
  status: null,
  generatedAt: null,
  dataKind: 'REAL',
  isLocal: false,
};
function persist() {
  try { localStorage.setItem(STORE, JSON.stringify({ f: state.f, saved: [...state.saved], hidden: [...state.hidden] })); } catch { /* storage unavailable */ }
}

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
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
  if (!v) return null;
  if (v.text === 'ASAP' || v.text === 'Now') return 'Now';
  const d = new Date(`${v.date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return v.text;
  if (d.getTime() < Date.now()) return 'Now';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
const LAUNDRY = { in_unit: 'W/D in unit', in_building: 'Laundry in building', none: 'No laundry on site' };
const BASIS = {
  structured: ['From listing', 'stated'],
  explicit: ['Stated', 'stated'],
  calculated: ['Calculated', 'calc'],
  inferred: ['Estimated', 'est'],
};
function basisChip(basis) {
  const [label, cls] = BASIS[basis] || ['Unknown', 'unknown'];
  return `<span class="basis ${cls}">${label}</span>`;
}
function priceChip(l) {
  if (l.price.monthly == null) return '<span class="basis unknown">Needs confirmation</span>';
  if (l.priceConfidence === 'likely') return '<span class="basis likely" title="The post gives one price but doesn\'t say it\'s per person">Likely your share</span>';
  if (l.price.basis === 'calculated') return '<span class="basis calc" title="Total rent ÷ people, because the post says it\'s split evenly">Even split</span>';
  return basisChip(l.price.basis);
}
const sourceNames = (l) => [...new Set(l.sources.map((s) => s.label))];
function contactLabel(l) {
  const m = l.contact.method;
  if (!m || m === 'source_site') return `Contact on ${sourceNames(l)[0]}`;
  return `Contact · ${m}`;
}

// ---------- filtering ----------
function matches(l, f) {
  if (!f.showHidden && state.hidden.has(l.id)) return false;
  if (f.savedOnly && !state.saved.has(l.id)) return false;
  if (l.price.monthly != null && l.price.monthly > f.maxPrice) return false;
  if (f.knownPriceOnly && l.price.monthly == null) return false;
  if (f.photosOnly && !l.photos.length) return false;
  if (f.hoods.length || f.boros.length) {
    const hood = l.neighborhood.value;
    const boro = l.borough.value;
    const hit = (hood && f.hoods.includes(hood)) || (boro && f.boros.includes(boro)) || (!hood && !boro && f.boros.includes(NONE));
    if (!hit) return false;
  }
  if (f.moveBy && l.moveIn.value?.date && l.moveIn.value.date > f.moveBy) return false;
  const beds = l.bedrooms.value;
  if (f.bedrooms.length && beds != null && !f.bedrooms.includes(beds >= 4 ? '4' : String(beds))) return false;
  const mates = l.roommates.value;
  if (f.roommates.length && (mates == null || !f.roommates.includes(mates >= 3 ? '3' : String(mates)))) return false;
  if (f.laundry === 'unit' && l.laundry.value !== 'in_unit') return false;
  if (f.laundry === 'building' && !['in_unit', 'in_building'].includes(l.laundry.value)) return false;
  if (f.furnished !== 'any' && l.furnished.value !== (f.furnished === 'yes')) return false;
  if (f.roomType !== 'any' && l.roomType.value !== f.roomType) return false;
  if (f.sources.length && !l.sources.some((s) => f.sources.includes(s.source))) return false;
  if (f.q) {
    const hay = `${l.title} ${l.description} ${l.neighborhood.value || ''} ${l.borough.value || ''}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}
const nullsLast = (a, b, cmp) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : cmp(a, b));
const SORTS = {
  'price-asc': (a, b) => nullsLast(a.price.monthly, b.price.monthly, (x, y) => x - y),
  'price-desc': (a, b) => nullsLast(a.price.monthly, b.price.monthly, (x, y) => y - x),
  newest: (a, b) => nullsLast(a.postedAt || a.scrapedAt, b.postedAt || b.scrapedAt, (x, y) => Date.parse(y) - Date.parse(x)),
  movein: (a, b) => nullsLast(a.moveIn.value?.date, b.moveIn.value?.date, (x, y) => x.localeCompare(y)) || SORTS['price-asc'](a, b),
  'roommates-asc': (a, b) => nullsLast(a.roommates.value, b.roommates.value, (x, y) => x - y) || SORTS['price-asc'](a, b),
  'roommates-desc': (a, b) => nullsLast(a.roommates.value, b.roommates.value, (x, y) => y - x) || SORTS['price-asc'](a, b),
};

// ---------- pieces ----------
const HOUSE_SVG = `<svg viewBox="0 0 120 80" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
  <path d="M8 78V34h26v44M34 78V18h30v60M64 78V40h22v38M86 78V26h26v52"/><path d="M14 42h6M24 42h4M14 52h6M24 52h4M14 62h6M24 62h4M41 26h6M52 26h6M41 38h6M52 38h6M41 50h6M52 50h6M44 66h12v12M70 48h4M78 48h4M70 58h4M78 58h4M92 34h5M101 34h5M92 44h5M101 44h5M92 54h5M101 54h5M2 78h116"/></svg>`;

function noPhoto(l) {
  const url = safeUrl(l.originalUrl);
  if (l.photoStatus === 'source_only' && url) {
    return `<div class="no-photo">${HOUSE_SVG}<strong>Photos unavailable here</strong><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">View original listing →</a></div>`;
  }
  return `<div class="no-photo">${HOUSE_SVG}<strong>No listing photos</strong><span>This post didn't include any</span></div>`;
}

function media(l, { card = true } = {}) {
  const saved = state.saved.has(l.id);
  const names = sourceNames(l);
  const badge = `<span class="source-badge">${esc(names[0])}${names.length > 1 ? ` <span class="plus">+${names.length - 1}</span>` : ''}</span>`;
  const sample = l.dataKind === 'SAMPLE' ? '<span class="sample-tag">SAMPLE</span>' : '';
  const saveBtn = `<button type="button" class="save-btn" data-act="save" aria-pressed="${saved}" aria-label="${saved ? 'Remove from saved' : 'Save listing'}"><svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>`;
  if (!l.photos.length) return `<div class="media">${noPhoto(l)}${badge}${sample}${card ? saveBtn : ''}</div>`;
  const n = l.photos.length;
  const slides = l.photos.map((p, i) => `<div class="media-slide" data-i="${i}">${i === 0 ? imgTag(p, l, i, card) : ''}</div>`).join('');
  const nav = n > 1 ? `<button type="button" class="media-nav prev" data-act="prev" aria-label="Previous photo">‹</button><button type="button" class="media-nav next" data-act="next" aria-label="Next photo">›</button>` : '';
  const dots = n > 1 ? `<div class="media-dots">${l.photos.slice(0, 7).map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')}</div>` : '';
  const count = `<span class="photo-count" aria-label="${n} photos"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-6-6-8 8"/></svg><span><span class="pc-i">1</span>/${n}</span></span>`;
  return `<div class="media" data-count="${n}" data-idx="0"><div class="media-track">${slides}</div>${nav}${dots}${count}${badge}${sample}${card ? saveBtn : ''}</div>`;
}

function imgTag(p, l, i, card) {
  const src = card ? p.thumb || p.url : p.url;
  return `<img src="${esc(src)}" alt="Photo ${i + 1} of ${esc(l.title || 'listing')}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('loaded');this.parentElement.classList.add('done')" onerror="window.__photoFailed(this)">`;
}

// A photo that fails to load is removed; if none remain, show the fallback.
window.__photoFailed = (img) => {
  const slide = img.closest('.media-slide');
  const mediaEl = img.closest('.media');
  slide?.classList.add('done');
  img.remove();
  if (mediaEl && !mediaEl.querySelector('img')) {
    const id = mediaEl.closest('[data-id]')?.dataset.id;
    const l = state.listings.find((x) => x.id === id);
    if (l && mediaEl.dataset.idx === '0' && Number(mediaEl.dataset.count) === 1) {
      mediaEl.querySelector('.media-track')?.remove();
      mediaEl.querySelector('.photo-count')?.remove();
      mediaEl.insertAdjacentHTML('afterbegin', noPhoto({ ...l, photoStatus: 'source_only' }));
    }
  }
};

function whereLine(l) {
  const hood = l.neighborhood.value;
  const boro = l.borough.value;
  const bar = `<span class="boro-bar" style="background:var(--boro-${BORO_CLASS[boro] || 'nj'})"></span>`;
  if (!hood && !boro) return `<div class="where">${bar}<span class="boro">Location not specified</span></div>`;
  const est = !hood && l.borough.basis === 'inferred' ? ' <span class="est-mark" title="Estimated from the listing\'s map location">est.</span>' : '';
  return `<div class="where">${bar}<span>${esc(hood || boro)}${hood && boro ? ` <span class="boro">· ${esc(boro)}</span>` : ''}${est}</span></div>`;
}

function roomFact(l) {
  const beds = l.bedrooms.value;
  if (l.listingKind === 'apartment') return beds != null ? `${beds === 0 ? 'Studio' : `${beds}BR`} apartment` : 'Whole apartment';
  if (beds != null) return `${l.availableRooms.value > 1 ? `${l.availableRooms.value} rooms` : 'Room'} in ${beds}BR`;
  return l.roomType.value === 'shared' ? 'Shared room' : 'Room';
}

function roommatesFact(l) {
  const r = l.roommates.value;
  if (r == null) return { text: 'Roommates unknown', unknown: true };
  const est = l.roommates.basis === 'inferred' ? ' <span class="est-mark" title="Estimated from the number of bedrooms — not stated in the listing">est.</span>' : '';
  return { text: `${r === 0 ? 'No current roommates' : `${r} roommate${r === 1 ? '' : 's'}`}${est}` };
}

function card(l) {
  const hidden = state.hidden.has(l.id);
  const price = l.price.monthly != null
    ? `<div class="price">${money(l.price.monthly)}${l.price.max && l.price.max !== l.price.monthly ? `–${money(l.price.max)}` : ''}<small>/mo</small></div>`
    : `<div class="price unknown">${l.totalRent.value ? `${money(l.totalRent.value)} total` : 'Price not listed'}</div>`;
  const sub = l.price.monthly == null && l.totalRent.value
    ? '<div class="price-sub">Your share isn\'t stated — ask the poster</div>'
    : l.totalRent.value && l.price.monthly != null && l.totalRent.value !== l.price.monthly ? `<div class="price-sub">of ${money(l.totalRent.value)} total rent</div>` : '';
  const rm = roommatesFact(l);
  const move = fmtDate(l.moveIn.value);
  const facts = [
    `<span class="fact"><span class="ico" aria-hidden="true">🛏</span>${esc(roomFact(l))}</span>`,
    `<span class="fact${rm.unknown ? ' unknown' : ''}"><span class="ico" aria-hidden="true">👥</span>${rm.text}</span>`,
    `<span class="fact${move ? '' : ' unknown'}"><span class="ico" aria-hidden="true">📅</span>${move ? `Move-in ${esc(move)}` : 'Move-in date unknown'}</span>`,
    l.laundry.value ? `<span class="fact"><span class="ico" aria-hidden="true">🧺</span>${LAUNDRY[l.laundry.value]}</span>` : '',
    l.furnished.value === true ? '<span class="fact"><span class="ico" aria-hidden="true">🛋</span>Furnished</span>' : '',
  ].join('');
  const names = sourceNames(l);
  const url = safeUrl(l.originalUrl);
  return `<article class="card${hidden ? ' is-hidden' : ''}" data-id="${esc(l.id)}">
    ${media(l)}
    <button type="button" class="card-open" data-act="open" aria-label="Open details: ${esc(l.title || 'listing')}"></button>
    <div class="card-body">
      <div class="price-row">${price}${priceChip(l)}</div>
      ${sub}
      ${whereLine(l)}
      <div class="facts">${facts}</div>
      <div class="card-foot">
        <span>${names.length > 1 ? `Found on ${esc(names.join(' · '))}` : esc(names[0])}${l.postedAt ? ` · ${esc(ago(l.postedAt))}` : ''}</span>
        <span class="spacer"></span>
        <button type="button" class="hide-btn" data-act="hide">${hidden ? 'Unhide' : 'Hide'}</button>
        ${url ? `<a class="orig-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Original ↗</a>` : ''}
      </div>
    </div>
  </article>`;
}

// ---------- carousel ----------
function showSlide(mediaEl, idx, { full = false } = {}) {
  const n = Number(mediaEl.dataset.count);
  if (!n) return;
  const i = (idx + n) % n;
  mediaEl.dataset.idx = i;
  const id = mediaEl.closest('[data-id]')?.dataset.id;
  const l = state.listings.find((x) => x.id === id);
  // Load the target slide (and the next one) only when needed.
  for (const j of [i, (i + 1) % n]) {
    const slide = mediaEl.querySelector(`.media-slide[data-i="${j}"]`);
    if (slide && !slide.querySelector('img') && !slide.classList.contains('done') && l) slide.innerHTML = imgTag(l.photos[j], l, j, !full);
  }
  mediaEl.querySelector('.media-track').style.transform = `translateX(-${i * 100}%)`;
  $$('.media-dots span', mediaEl).forEach((d, k) => d.classList.toggle('on', k === Math.min(i, 6)));
  const pc = mediaEl.querySelector('.pc-i');
  if (pc) pc.textContent = i + 1;
}

function bindSwipe(root) {
  let start = null;
  root.addEventListener('pointerdown', (e) => {
    const m = e.target.closest('.media[data-count]');
    if (m && e.pointerType !== 'mouse') start = { x: e.clientX, y: e.clientY, m };
  });
  root.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      showSlide(start.m, Number(start.m.dataset.idx) + (dx < 0 ? 1 : -1));
      start.m.dataset.swiped = '1';
      setTimeout(() => { delete start?.m?.dataset.swiped; }, 300);
    }
    start = null;
  });
}

// ---------- rendering ----------
function render() {
  const f = state.f;
  const results = state.listings.filter((l) => matches(l, f)).sort(SORTS[f.sort] || SORTS['price-asc']);
  $('#grid').innerHTML = results.map(card).join('');
  const total = state.listings.length;
  const kind = state.dataKind === 'SAMPLE' ? 'SAMPLE' : 'live';
  $('#results-sub').textContent = total ? `${results.length} of ${total} ${kind} listing${total === 1 ? '' : 's'} match` : '';
  $('#saved-count').textContent = state.saved.size ? `(${state.saved.size})` : '';
  renderActiveFilters();
  const empty = $('#empty');
  empty.hidden = results.length > 0;
  if (!total) {
    const anyLive = state.status?.sources?.some((s) => ['LIVE', 'LIVE_WITH_LIMITATIONS'].includes(s.status));
    empty.innerHTML = `<h2>No live listings are currently available</h2>
      <p>${anyLive ? 'Sources are connected but returned no listings matching your budget right now.' : 'Connect a supported source to begin searching.'}</p>
      <button type="button" class="btn primary" data-open-status>See source status</button>`;
  } else if (!results.length) {
    empty.innerHTML = '<h2>Nothing matches these filters</h2><p>Try a higher budget, more neighborhoods, or clearing some filters.</p><button type="button" class="btn" data-reset>Reset filters</button>';
  }
  persist();
}

function renderActiveFilters() {
  const f = state.f;
  const chips = [];
  if (f.maxPrice < DEFAULTS.maxPrice) chips.push(['maxPrice', `Under ${money(f.maxPrice)}`]);
  f.boros.forEach((b) => chips.push([`boro:${b}`, b === NONE ? 'Location not specified' : `All of ${b}`]));
  f.hoods.forEach((h) => chips.push([`hood:${h}`, h]));
  if (f.moveBy) chips.push(['moveBy', `Move in by ${fmtDate({ date: f.moveBy })}`]);
  if (f.bedrooms.join() !== DEFAULTS.bedrooms.join()) chips.push(['bedrooms', f.bedrooms.length ? `${f.bedrooms.map((b) => (b === '4' ? '4+' : b)).join(', ')} BR` : 'Any bedrooms']);
  if (f.roommates.length) chips.push(['roommates', `${f.roommates.map((r) => (r === '3' ? '3+' : r)).join(', ')} roommates`]);
  if (f.laundry !== 'any') chips.push(['laundry', f.laundry === 'unit' ? 'W/D in unit' : 'Laundry in building']);
  if (f.furnished !== 'any') chips.push(['furnished', f.furnished === 'yes' ? 'Furnished' : 'Unfurnished']);
  if (f.roomType !== 'any') chips.push(['roomType', f.roomType === 'private' ? 'Private room' : 'Shared room']);
  f.sources.forEach((s) => chips.push([`source:${s}`, state.status?.sources?.find((x) => x.id === s)?.name || s]));
  if (f.q) chips.push(['q', `“${f.q}”`]);
  if (f.photosOnly) chips.push(['photosOnly', 'With photos']);
  if (f.knownPriceOnly) chips.push(['knownPriceOnly', 'Known price only']);
  if (f.savedOnly) chips.push(['savedOnly', 'Saved']);
  $('#active-filters').innerHTML = chips.map(([k, label]) => `<button type="button" data-clear="${esc(k)}">${esc(label)}</button>`).join('');
  const more = [f.laundry !== 'any', f.furnished !== 'any', f.roomType !== 'any', f.sources.length, f.q, f.photosOnly, f.knownPriceOnly].filter(Boolean).length;
  $('#more-count').hidden = !more;
  $('#more-count').textContent = more;
  const where = [...f.boros.map((b) => (b === NONE ? 'Unspecified' : b)), ...f.hoods];
  $('#where-btn').textContent = where.length ? (where.length > 2 ? `${where.slice(0, 2).join(', ')} +${where.length - 2}` : where.join(', ')) : 'All of NYC';
}

function clearFilter(key) {
  const f = state.f;
  if (key.startsWith('boro:')) f.boros = f.boros.filter((b) => b !== key.slice(5));
  else if (key.startsWith('hood:')) f.hoods = f.hoods.filter((h) => h !== key.slice(5));
  else if (key.startsWith('source:')) f.sources = f.sources.filter((s) => s !== key.slice(7));
  else f[key] = Array.isArray(DEFAULTS[key]) ? [...DEFAULTS[key]] : DEFAULTS[key];
  syncControls();
  render();
}

function syncControls() {
  const f = state.f;
  $('#max-price').value = f.maxPrice;
  $('#max-price-out').textContent = money(f.maxPrice);
  $('#move-by').value = f.moveBy;
  $$('#bedrooms button').forEach((b) => b.setAttribute('aria-pressed', f.bedrooms.includes(b.dataset.value)));
  $$('#roommates button').forEach((b) => b.setAttribute('aria-pressed', f.roommates.includes(b.dataset.value)));
  for (const [id, key] of [['laundry', 'laundry'], ['furnished', 'furnished'], ['roomtype', 'roomType']]) {
    $$(`#${id} button`).forEach((b) => b.setAttribute('aria-checked', b.dataset.value === f[key]));
  }
  $('#q').value = f.q;
  $('#photos-only').checked = f.photosOnly;
  $('#incomplete').checked = f.knownPriceOnly;
  $('#show-hidden').checked = f.showHidden;
  $('#sort').value = f.sort;
  $('#saved-toggle').setAttribute('aria-pressed', f.savedOnly);
  $$('#sources button').forEach((b) => b.setAttribute('aria-pressed', f.sources.includes(b.dataset.value)));
}

function renderSources() {
  const ids = [...new Set(state.listings.flatMap((l) => l.sources.map((s) => s.source)))];
  const name = (id) => state.status?.sources?.find((s) => s.id === id)?.name || id;
  $('#sources').innerHTML = ids.map((id) => `<button type="button" data-value="${esc(id)}" aria-pressed="${state.f.sources.includes(id)}">${esc(name(id))}</button>`).join('') || '<span class="hint">No sources yet</span>';
}

function renderWhere() {
  const q = $('#hood-q').value.trim().toLowerCase();
  const groups = new Map();
  for (const l of state.listings) {
    const boro = l.borough.value || 'Not specified';
    const hood = l.neighborhood.value;
    if (!groups.has(boro)) groups.set(boro, { n: 0, hoods: new Map() });
    const g = groups.get(boro);
    g.n++;
    if (hood) g.hoods.set(hood, (g.hoods.get(hood) || 0) + 1);
  }
  const f = state.f;
  $('#where-list').innerHTML = [...groups.entries()]
    .sort(([a], [b]) => BORO_ORDER.indexOf(a) - BORO_ORDER.indexOf(b))
    .map(([boro, g]) => {
      const key = boro === 'Not specified' ? NONE : boro;
      const hoods = [...g.hoods.entries()].filter(([h]) => !q || h.toLowerCase().includes(q) || boro.toLowerCase().includes(q)).sort(([a], [b]) => a.localeCompare(b));
      if (q && !hoods.length && !boro.toLowerCase().includes(q)) return '';
      return `<div class="boro-group">
        <label class="boro-head"><input type="checkbox" data-boro="${esc(key)}" ${f.boros.includes(key) ? 'checked' : ''}><span class="boro-bar" style="background:var(--boro-${BORO_CLASS[boro] || 'nj'})"></span>${esc(boro === 'Not specified' ? 'Location not specified' : `All of ${boro}`)}<span class="n">${g.n}</span></label>
        ${hoods.length ? `<div class="hood-grid">${hoods.map(([h, n]) => `<label><input type="checkbox" data-hood="${esc(h)}" ${f.hoods.includes(h) ? 'checked' : ''}>${esc(h)}<span class="n">${n}</span></label>`).join('')}</div>` : ''}
      </div>`;
    }).join('') || '<p class="hint">No neighborhoods yet.</p>';
}

// ---------- detail ----------
let detailIdx = 0;
function openDetail(id, { push = true } = {}) {
  const l = state.listings.find((x) => x.id === id);
  if (!l) return;
  detailIdx = 0;
  const url = safeUrl(l.originalUrl);
  const names = sourceNames(l);
  const photos = l.photos;
  const gallery = photos.length
    ? `<div class="d-gallery">
        <div class="d-hero-wrap">
          <img class="d-hero" id="d-hero" src="${esc(photos[0].url)}" alt="Photo 1 of ${photos.length}" referrerpolicy="no-referrer" onerror="this.src='${esc(photos[0].thumb || '')}'">
          ${photos.length > 1 ? '<button type="button" class="media-nav prev" data-d="-1" aria-label="Previous photo">‹</button><button type="button" class="media-nav next" data-d="1" aria-label="Next photo">›</button>' : ''}
          <span class="photo-count"><span><span id="d-idx">1</span>/${photos.length}</span><span id="d-cap">${esc(photos[0].caption ? `${photos[0].caption} · ` : '')}from ${esc(names[0])}</span></span>
        </div>
        ${photos.length > 1 ? `<div class="d-thumbs">${photos.map((p, i) => `<button type="button" data-thumb="${i}" aria-current="${i === 0}" aria-label="Photo ${i + 1}"><img src="${esc(p.thumb || p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></button>`).join('')}</div>` : ''}
      </div>`
    : `<div class="d-gallery" style="background:var(--surface-2)"><div class="media" style="aspect-ratio:21/9">${noPhoto(l)}</div></div>`;

  const unknown = [];
  const F = (label, value, basis) => {
    if (value == null) { unknown.push(label); return ''; }
    return `<div class="d-fact"><dt><span>${esc(label)}</span>${basisChip(basis)}</dt><dd>${value}</dd></div>`;
  };
  const yesNo = (v) => (v == null ? null : v ? 'Yes' : 'No');
  const rm = l.roommates.value;
  const facts = [
    F('Your monthly share', l.price.monthly != null ? `${money(l.price.monthly)}${l.price.max && l.price.max !== l.price.monthly ? `–${money(l.price.max)}` : ''}` : null, l.price.basis),
    F('Total rent', l.totalRent.value != null ? money(l.totalRent.value) : null, l.totalRent.basis),
    F('Bedrooms', l.bedrooms.value != null ? String(l.bedrooms.value) : null, l.bedrooms.basis),
    F('Bathrooms', l.bathrooms.value != null ? String(l.bathrooms.value) : null, l.bathrooms.basis),
    F('Current roommates', rm != null ? (rm === 0 ? 'None' : String(rm)) : null, l.roommates.basis),
    F('Rooms available', l.availableRooms.value != null ? String(l.availableRooms.value) : null, l.availableRooms.basis),
    F('Move-in', fmtDate(l.moveIn.value), l.moveIn.basis),
    F('Lease', l.leaseLength.value ? esc(l.leaseLength.value) : null, l.leaseLength.basis),
    F('Laundry', l.laundry.value ? LAUNDRY[l.laundry.value] : null, l.laundry.basis),
    F('Furnished', yesNo(l.furnished.value), l.furnished.basis),
    F('Room', l.roomType.value ? (l.roomType.value === 'private' ? 'Private' : 'Shared') : null, l.roomType.basis),
    F('Bathroom', l.bathroomType.value ? (l.bathroomType.value === 'private' ? 'Private' : 'Shared') : null, l.bathroomType.basis),
    F('Utilities included', yesNo(l.utilitiesIncluded.value), l.utilitiesIncluded.basis),
    F('Pets', l.pets.value ? esc(l.pets.value) : null, l.pets.basis),
    F('Roommate preference', l.genderPreference.value ? esc(l.genderPreference.value) : null, l.genderPreference.basis),
    F('Age preference', l.agePreference.value ? esc(l.agePreference.value) : null, l.agePreference.basis),
  ].join('');

  const verifyRows = [
    ['Price', l.price.monthly != null ? (l.priceConfidence === 'likely' ? 'likely' : l.price.basis) : null],
    ['Bedrooms', l.bedrooms.basis], ['Roommates', l.roommates.basis], ['Move-in', l.moveIn.basis],
    ['Neighborhood', l.neighborhood.basis || l.borough.basis], ['Laundry', l.laundry.basis], ['Furnished', l.furnished.basis],
  ].map(([k, b]) => `<tr><td>${k}</td><td>${b === 'likely' ? '<span class="basis likely">Likely your share</span>' : basisChip(b)}</td></tr>`).join('');

  const contact = safeUrl(l.contact.url);
  const emails = (l.contactEmails || []).slice(0, 1).map((e) => `<a class="btn" href="mailto:${esc(e)}">Email ${esc(e)}</a>`).join('');
  const price = l.price.monthly != null ? `<div class="price">${money(l.price.monthly)}<small>/mo</small></div>` : `<div class="price unknown">${l.totalRent.value ? `${money(l.totalRent.value)} total rent` : 'Price not listed'}</div>`;

  $('#detail-content').innerHTML = `
    <div style="position:relative">
      ${gallery}
      <div class="d-top-actions">${l.dataKind === 'SAMPLE' ? '<span class="sample-tag" style="position:static">SAMPLE</span>' : ''}</div>
      <button type="button" class="icon-close d-close" data-close aria-label="Close">×</button>
    </div>
    <div class="d-body">
      <div>
        <h2 class="d-title" id="detail-title">${esc(l.title || 'Listing')}</h2>
        ${whereLine(l).replace('class="where"', 'class="d-where"')}
        <dl class="d-facts">${facts}</dl>
        ${unknown.length ? `<p class="d-unknown"><strong>Not stated in the listing:</strong> ${unknown.map(esc).join(' · ')}</p>` : ''}
        <div class="d-section">
          <h3>Description</h3>
          ${l.description ? `<p class="d-desc">${esc(l.description)}</p>` : '<p class="d-desc">No description provided.</p>'}
          <p class="d-attrib">Original text from ${esc(names.join(' and '))}${l.postedAt ? `, posted ${esc(ago(l.postedAt))}` : ''}. Retrieved ${esc(ago(l.scrapedAt))}.</p>
        </div>
        <div class="d-section">
          <h3>What's verified</h3>
          <table class="verify-table">${verifyRows}</table>
          <div class="legend" style="margin-top:10px">
            <span>${basisChip('structured')} or ${basisChip('explicit')} — taken directly from the listing</span>
            <span>${basisChip('calculated')} — computed from stated facts (e.g. an even rent split)</span>
            <span>${basisChip('inferred')} — our guess, not stated by the poster</span>
            <span><span class="basis likely">Likely your share</span> — one price given, but not said to be per person</span>
          </div>
        </div>
      </div>
      <aside class="d-side">
        <div class="d-card">
          <div class="price-row">${price}${priceChip(l)}</div>
          ${l.price.monthly == null && l.totalRent.value ? '<div class="price-sub">The listing gives total rent only — confirm your share with the poster.</div>' : ''}
          ${contact ? `<a class="btn accent" href="${esc(contact)}" target="_blank" rel="noopener noreferrer">${esc(contactLabel(l))}</a>` : ''}
          ${emails}
          <button type="button" class="btn" data-act="save" data-id="${esc(l.id)}">${state.saved.has(l.id) ? '♥ Saved' : '♡ Save'}</button>
        </div>
        <div class="d-sources">
          <h3 style="margin:6px 0 0;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">${l.sources.length > 1 ? `Found on ${l.sources.length} sites` : 'Source'}</h3>
          ${l.sources.map((s) => (safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Original listing on ${esc(s.label)} <span>↗</span></a>` : `<div class="d-card">${esc(s.label)}</div>`)).join('')}
        </div>
      </aside>
    </div>`;
  const dlg = $('#detail-dialog');
  if (!dlg.open) dlg.showModal();
  $('#detail-content').scrollTop = 0;
  if (push) history.pushState({ listing: id }, '', `#listing=${encodeURIComponent(id)}`);
}

function detailShow(i) {
  const id = decodeURIComponent((location.hash.match(/listing=([^&]+)/) || [])[1] || '');
  const l = state.listings.find((x) => x.id === id);
  if (!l || !l.photos.length) return;
  detailIdx = (i + l.photos.length) % l.photos.length;
  const hero = $('#d-hero');
  hero.src = l.photos[detailIdx].url;
  hero.alt = `Photo ${detailIdx + 1} of ${l.photos.length}`;
  $('#d-idx').textContent = detailIdx + 1;
  $('#d-cap').textContent = `${l.photos[detailIdx].caption ? `${l.photos[detailIdx].caption} · ` : ''}from ${sourceNames(l)[0]}`;
  $$('.d-thumbs button').forEach((b) => b.setAttribute('aria-current', Number(b.dataset.thumb) === detailIdx));
  $(`.d-thumbs button[data-thumb="${detailIdx}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
}

function lightbox(i) {
  const id = decodeURIComponent((location.hash.match(/listing=([^&]+)/) || [])[1] || '');
  const l = state.listings.find((x) => x.id === id);
  if (!l?.photos.length) return;
  detailIdx = (i + l.photos.length) % l.photos.length;
  $('#lb-img').src = l.photos[detailIdx].url;
  $('#lb-img').alt = `Photo ${detailIdx + 1} of ${l.photos.length}`;
  $('#lb-cap').textContent = `${detailIdx + 1} / ${l.photos.length}${l.photos[detailIdx].caption ? ` · ${l.photos[detailIdx].caption}` : ''} · photo from ${sourceNames(l)[0]}`;
  const lb = $('#lightbox');
  if (!lb.open) lb.showModal();
}

// ---------- status ----------
const STATUS_LABEL = {
  LIVE: 'LIVE', LIVE_WITH_LIMITATIONS: 'LIVE · LIMITED', AUTH_REQUIRED: 'NEEDS CREDENTIALS', ENVIRONMENT_BLOCKED: 'UNREACHABLE',
  SOURCE_BLOCKED: 'BLOCKED', NO_PUBLIC_ACCESS: 'NOT PERMITTED', MANUAL_ONLY: 'MANUAL ONLY', UNVERIFIED: 'UNVERIFIED',
};
function renderFreshness() {
  const st = state.status;
  const dot = $('#freshness-dot');
  if (!st?.generatedAt) {
    dot.className = 'dot down';
    $('#freshness-text').textContent = 'No data yet · see sources';
    return;
  }
  const live = st.sources.filter((s) => ['LIVE', 'LIVE_WITH_LIMITATIONS'].includes(s.status) && s.inDataset);
  dot.className = `dot ${live.length ? (live.every((s) => s.status === 'LIVE') ? 'live' : 'limited') : 'down'}`;
  const bySource = live.map((s) => `${s.name} ${s.inDataset}`).join(' · ');
  const kind = st.dataKind === 'SAMPLE' ? 'SAMPLE' : 'live';
  $('#freshness-text').textContent = `Updated ${ago(st.generatedAt)} · ${st.totals.listings} ${kind} listing${st.totals.listings === 1 ? '' : 's'}${bySource ? ` · ${bySource}` : ''}`;
}

function renderStatus() {
  const st = state.status;
  if (!st) {
    $('#status-body').innerHTML = '<p>No scraper run has been recorded yet. Run <code>npm run scrape</code>.</p>';
    return;
  }
  const t = st.totals;
  const cov = (c) => (c ? Object.entries(c).map(([k, v]) => `<span>${k}<i style="--p:${v}%"></i> ${v}%</span>`).join('') : '');
  const src = (s) => `<div class="src">
      <div class="src-name">${esc(s.name)}</div>
      <span class="src-state ${esc(s.status)}">${esc(STATUS_LABEL[s.status] || s.status)}</span>
      <div class="src-meta">${s.inDataset != null ? `${s.inDataset} listing${s.inDataset === 1 ? '' : 's'} in results${s.count && s.count !== s.inDataset ? ` (${s.count} fetched)` : ''} · ${s.withPhotos} with photos` : ''}${s.lastSuccessAt ? ` · last success ${esc(ago(s.lastSuccessAt))}` : ''}</div>
      ${s.reason ? `<div class="src-reason">${esc(s.reason)}</div>` : ''}
      ${s.coverage ? `<div class="cov">${cov(s.coverage)}</div>` : ''}
    </div>`;
  const ex = (s) => `<div class="src">
      <div class="src-name">${esc(s.name)}</div>
      <span class="src-state ${esc(s.status)}">${esc(STATUS_LABEL[s.status] || s.status)}</span>
      <div class="src-reason">${esc(s.reason)} <em>(checked ${esc(s.checkedAt)})</em></div>
    </div>`;
  $('#status-body').innerHTML = `
    <p style="margin:0;color:var(--muted)">Last scraper run ${esc(ago(st.generatedAt))} (${esc(new Date(st.generatedAt).toLocaleString())}). All numbers below come from that run.</p>
    <div class="status-summary">
      <div class="stat"><b>${t.listings}</b><span>live listings</span></div>
      <div class="stat"><b>${t.withPhotos} of ${t.listings}</b><span>have photos</span></div>
      <div class="stat"><b>${t.photosLoaded}/${t.photosChecked}</b><span>photos verified loading</span></div>
      <div class="stat"><b>${t.duplicatesMerged}</b><span>duplicates merged</span></div>
    </div>
    <h3 style="margin:6px 0 0">Sources searched</h3>
    <div class="src-list">${st.sources.map(src).join('')}</div>
    <h3 style="margin:6px 0 0">Not included, and why</h3>
    <div class="src-list">${(st.excluded || []).map(ex).join('')}</div>`;
}

// ---------- local-only: add a pasted post ----------
function addPostDialog() {
  let dlg = $('#add-dialog');
  if (!dlg) {
    document.body.insertAdjacentHTML('beforeend', `<dialog class="sheet" id="add-dialog" aria-labelledby="add-title">
      <form method="dialog" id="add-form" style="display:contents">
        <div class="sheet-head"><h2 id="add-title">Add a post</h2><button type="button" class="icon-close" data-close aria-label="Close">×</button></div>
        <div class="sheet-body">
          <p class="hint" style="margin:0;color:var(--muted)">For Facebook groups and other sites we can't search automatically. Paste the link and the post text.</p>
          <label class="field"><span class="field-label">Link to the post</span><input type="url" name="url" style="padding:10px 14px;border:1px solid var(--line);border-radius:12px" placeholder="https://www.facebook.com/groups/…"></label>
          <label class="field"><span class="field-label">Post text</span><textarea name="text" rows="7" required style="padding:10px 14px;border:1px solid var(--line);border-radius:12px"></textarea></label>
          <p id="add-error" style="color:#c0392b;margin:0" hidden></p>
        </div>
        <div class="sheet-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" value="save">Add post</button></div>
      </form></dialog>`);
    dlg = $('#add-dialog');
    $('#add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await fetch('/api/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: fd.get('url'), text: fd.get('text') }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.statusText);
        dlg.close();
        await loadData();
      } catch (err) {
        $('#add-error').textContent = err.message;
        $('#add-error').hidden = false;
      }
    });
  }
  $('#add-form').reset();
  dlg.showModal();
}

// ---------- events ----------
function toggleIn(list, v) { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]; }
function update(patch) { Object.assign(state.f, patch); syncControls(); render(); }

function bind() {
  $('#max-price').addEventListener('input', (e) => update({ maxPrice: +e.target.value }));
  $('#move-by').addEventListener('change', (e) => update({ moveBy: e.target.value }));
  $('#sort').addEventListener('change', (e) => update({ sort: e.target.value }));
  $('#q').addEventListener('input', (e) => update({ q: e.target.value }));
  $('#photos-only').addEventListener('change', (e) => update({ photosOnly: e.target.checked }));
  $('#incomplete').addEventListener('change', (e) => update({ knownPriceOnly: e.target.checked }));
  $('#show-hidden').addEventListener('change', (e) => update({ showHidden: e.target.checked }));
  $('#saved-toggle').addEventListener('click', () => update({ savedOnly: !state.f.savedOnly }));
  for (const key of ['bedrooms', 'roommates']) {
    $(`#${key}`).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ [key]: toggleIn(state.f[key], b.dataset.value) }); });
  }
  for (const [id, key] of [['laundry', 'laundry'], ['furnished', 'furnished'], ['roomtype', 'roomType']]) {
    $(`#${id}`).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ [key]: b.dataset.value }); });
  }
  $('#sources').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) update({ sources: toggleIn(state.f.sources, b.dataset.value) }); });
  $('#active-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-clear]'); if (b) clearFilter(b.dataset.clear); });
  $('#reset-btn').addEventListener('click', () => { state.f = { ...DEFAULTS, bedrooms: [...DEFAULTS.bedrooms], maxPrice: Number($('#max-price').max), sort: state.f.sort }; syncControls(); render(); renderWhere(); });

  $('#where-btn').addEventListener('click', () => { renderWhere(); $('#where-dialog').showModal(); });
  $('#more-btn').addEventListener('click', () => $('#more-dialog').showModal());
  $('#hood-q').addEventListener('input', renderWhere);
  $('#where-list').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.boro) update({ boros: toggleIn(state.f.boros, t.dataset.boro) });
    if (t.dataset.hood) update({ hoods: toggleIn(state.f.hoods, t.dataset.hood) });
  });
  $('#where-clear').addEventListener('click', () => { update({ hoods: [], boros: [] }); renderWhere(); });

  const openStatus = () => { renderStatus(); $('#status-dialog').showModal(); };
  $('#freshness').addEventListener('click', openStatus);
  $('#foot-status').addEventListener('click', openStatus);

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close();
    if (e.target.closest('[data-open-status]')) openStatus();
    if (e.target.closest('[data-reset]')) $('#reset-btn').click();
    if (e.target.matches('dialog')) e.target.close(); // backdrop click
  });

  // Card interactions
  const grid = $('#grid');
  bindSwipe(grid);
  grid.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    const mediaEl = cardEl.querySelector('.media');
    if (act?.dataset.act === 'prev' || act?.dataset.act === 'next') {
      e.stopPropagation();
      showSlide(mediaEl, Number(mediaEl.dataset.idx) + (act.dataset.act === 'next' ? 1 : -1));
      return;
    }
    if (act?.dataset.act === 'save') { toggleSave(id); return; }
    if (act?.dataset.act === 'hide') {
      if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
      render();
      return;
    }
    if (e.target.closest('a')) return; // links (Original ↗) open normally
    if ((act?.dataset.act === 'open' || !act) && !mediaEl?.dataset.swiped) openDetail(id);
  });

  // Detail / lightbox
  $('#detail-dialog').addEventListener('click', (e) => {
    const d = e.target.closest('[data-d]');
    if (d) detailShow(detailIdx + Number(d.dataset.d));
    const th = e.target.closest('[data-thumb]');
    if (th) detailShow(Number(th.dataset.thumb));
    if (e.target.id === 'd-hero') lightbox(detailIdx);
    const sv = e.target.closest('[data-act="save"]');
    if (sv) { toggleSave(sv.dataset.id); sv.textContent = state.saved.has(sv.dataset.id) ? '♥ Saved' : '♡ Save'; }
  });
  $('#detail-dialog').addEventListener('close', () => { if (location.hash.startsWith('#listing=')) history.pushState({}, '', location.pathname + location.search); });
  $('#lightbox').addEventListener('click', (e) => {
    const n = e.target.closest('[data-lb]');
    if (n) lightbox(detailIdx + Number(n.dataset.lb));
  });
  bindSwipe($('#lightbox'));
  document.addEventListener('keydown', (e) => {
    if ($('#lightbox').open) {
      if (e.key === 'ArrowRight') lightbox(detailIdx + 1);
      if (e.key === 'ArrowLeft') lightbox(detailIdx - 1);
    } else if ($('#detail-dialog').open) {
      if (e.key === 'ArrowRight') detailShow(detailIdx + 1);
      if (e.key === 'ArrowLeft') detailShow(detailIdx - 1);
    }
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
  state.listings = data?.listings || [];
  state.generatedAt = data?.generatedAt || null;
  state.dataKind = data?.dataKind || 'REAL';
  state.status = status;
  const isSample = state.dataKind === 'SAMPLE' || state.listings.some((l) => l.dataKind === 'SAMPLE');
  $('#sample-banner').hidden = !isSample;
  const max = status?.criteria?.maxShare || DEFAULTS.maxPrice;
  $('#max-price').max = max;
  if (state.f.maxPrice > max) state.f.maxPrice = max;
  renderFreshness();
  renderSources();
  syncControls();
  render();
  routeFromHash();
}

async function detectLocal() {
  try {
    const res = await fetch('/api/health');
    state.isLocal = res.ok && (await res.json()).local === true;
  } catch { state.isLocal = false; }
  if (state.isLocal) {
    $('.results-tools').insertAdjacentHTML('afterbegin', '<button type="button" class="pill-toggle" id="add-post">+ Add a post</button>');
    $('#add-post').addEventListener('click', addPostDialog);
  }
}

bind();
await detectLocal();
await loadData();
