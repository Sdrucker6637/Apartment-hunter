// Apartment Hunter front end: loads data/listings.json, filters/sorts it in
// the browser, and remembers your filters, saved and hidden listings locally.

const $ = (sel) => document.querySelector(sel);
const STORE_KEY = 'apartment-hunter:v1';
const BOROUGH_ORDER = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island', 'New Jersey', 'Unknown'];
const UNKNOWN_HOOD = '__unknown__';

const DEFAULTS = {
  q: '',
  maxPrice: 1700,
  laundry: 'any',
  bedrooms: [],
  roommates: [],
  moveBy: '',
  hoods: [],
  sources: [],
  incomplete: false,
  savedOnly: false,
  showHidden: false,
  sort: 'price-asc',
};

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
};
const stored = load();
const state = {
  filters: { ...DEFAULTS, ...(stored.filters || {}) },
  saved: new Set(stored.saved || []),
  hidden: new Set(stored.hidden || []),
};
const persist = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      filters: state.filters, saved: [...state.saved], hidden: [...state.hidden],
    }));
  } catch { /* storage unavailable: settings just won't persist */ }
};

let data = { listings: [], generatedAt: null, criteria: {} };
let isLocal = false;
let hoodQuery = '';

// ---------- formatting helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const safeUrl = (u) => (u && /^https?:\/\//i.test(u) ? u : null);

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function fmtMoveIn(m) {
  if (!m) return null;
  if (m.text === 'ASAP') return 'ASAP';
  const d = new Date(`${m.date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return m.text;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

const LAUNDRY_LABEL = { 'in-unit': 'W/D in unit', 'in-building': 'Laundry in building', none: 'No laundry' };

function contactLabel(l) {
  if (l.source === 'reddit' && l.author) return `Message u/${l.author}`;
  if (l.source === 'craigslist') return 'Reply on Craigslist';
  if (l.source === 'facebook') return 'Open on Facebook';
  return 'Contact';
}

// ---------- filtering ----------

function matches(l, f) {
  const hidden = state.hidden.has(l.id);
  if (hidden && !f.showHidden) return false;
  if (f.savedOnly && !state.saved.has(l.id)) return false;
  if (!f.incomplete && (l.price == null || l.bedrooms == null)) return false;
  if (l.price != null && l.price > f.maxPrice) return false;
  if (f.laundry === 'unit' && l.laundry !== 'in-unit') return false;
  if (f.laundry === 'building' && l.laundry !== 'in-unit' && l.laundry !== 'in-building') return false;
  if (f.bedrooms.length && !f.bedrooms.includes(String(l.bedrooms))) return false;
  if (f.roommates.length) {
    if (l.roommates == null) return false;
    const key = l.roommates >= 3 ? '3' : String(l.roommates);
    if (!f.roommates.includes(key)) return false;
  }
  if (f.moveBy && l.moveIn?.date && l.moveIn.date > f.moveBy) return false;
  if (f.hoods.length && !f.hoods.includes(l.neighborhood || UNKNOWN_HOOD)) return false;
  if (f.sources.length && !f.sources.includes(l.source)) return false;
  if (f.q) {
    const hay = `${l.title} ${l.snippet} ${l.neighborhood || ''} ${l.borough || ''}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const nullsLast = (a, b, cmp) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : cmp(a, b));
const SORTS = {
  'price-asc': (a, b) => nullsLast(a.price, b.price, (x, y) => x - y),
  'price-desc': (a, b) => nullsLast(a.price, b.price, (x, y) => y - x),
  'roommates-asc': (a, b) => nullsLast(a.roommates, b.roommates, (x, y) => x - y) || SORTS['price-asc'](a, b),
  'roommates-desc': (a, b) => nullsLast(a.roommates, b.roommates, (x, y) => y - x) || SORTS['price-asc'](a, b),
  newest: (a, b) => new Date(b.postedAt) - new Date(a.postedAt),
  movein: (a, b) => nullsLast(a.moveIn?.date, b.moveIn?.date, (x, y) => x.localeCompare(y)) || SORTS['price-asc'](a, b),
};

// ---------- rendering ----------

function fact(text, cls = '') {
  return `<span class="fact ${cls}">${text}</span>`;
}

function renderCard(l) {
  const saved = state.saved.has(l.id);
  const hidden = state.hidden.has(l.id);
  let priceHtml = '<div class="price">Price not listed</div>';
  if (l.price != null) {
    const range = l.priceMax && l.priceMax !== l.price ? `–${money(l.priceMax)}` : '';
    priceHtml = `<div class="price">${money(l.price)}${esc(range)} <small>/mo</small></div>`;
    if (l.priceSource === 'split' && l.totalRent) {
      priceHtml += `<div class="price-note">Your share of ${money(l.totalRent)} total, split ${l.bedrooms} ways</div>`;
    } else if (range) {
      priceHtml += '<div class="price-note">Several rooms at different prices</div>';
    }
  }

  const facts = [];
  const where = l.neighborhood ? `${l.neighborhood}${l.borough ? `, ${l.borough}` : ''}` : l.borough;
  facts.push(where ? fact(`📍 ${esc(where)}`) : fact('📍 Location unclear', 'unknown'));
  if (l.bedrooms != null) {
    facts.push(fact(`${l.bedrooms === 0 ? 'Studio' : `${l.bedrooms}BR`}${l.bathrooms ? ` / ${l.bathrooms}BA` : ''}`));
  } else facts.push(fact('Bedrooms ?', 'unknown'));
  if (l.kind === 'apartment') {
    facts.push(fact(l.bedrooms > 1 ? `Whole apartment · find ${l.bedrooms - 1} more` : 'Whole apartment'));
  } else if (l.roommates != null) {
    const est = l.roommatesSource === 'estimated' ? ' <span class="est" title="Estimated from bedroom count">(est.)</span>' : '';
    facts.push(fact(`👥 ${l.roommates === 0 ? 'No current roommates' : `Join ${l.roommates} roommate${l.roommates === 1 ? '' : 's'}`}${est}`));
  } else facts.push(fact('👥 Roommates ?', 'unknown'));
  const moveIn = fmtMoveIn(l.moveIn);
  facts.push(moveIn ? fact(`📅 Move in ${esc(moveIn)}`) : fact('📅 Move-in ?', 'unknown'));
  if (l.laundry) facts.push(fact(LAUNDRY_LABEL[l.laundry], l.laundry === 'none' ? '' : 'good'));

  const contact = safeUrl(l.contactUrl);
  const view = safeUrl(l.url);
  const external = safeUrl(l.externalUrl);
  const emails = (l.contacts?.emails || []).map((e) => `<a class="btn btn-ghost" href="mailto:${esc(e)}">Email</a>`).slice(0, 1).join('');
  const also = l.alsoPostedIn?.length ? ` · also in ${esc(l.alsoPostedIn.join(', '))}` : '';

  return `
    <article class="card${hidden ? ' is-hidden' : ''}" data-id="${esc(l.id)}">
      <div class="card-top">
        <div>${priceHtml}</div>
        <div class="card-icons">
          <button class="icon-btn" data-act="save" aria-pressed="${saved}" title="${saved ? 'Unsave' : 'Save'}">${saved ? '★' : '☆'}</button>
          <button class="icon-btn" data-act="hide" title="${hidden ? 'Unhide' : 'Hide this listing'}">${hidden ? '↺' : '✕'}</button>
        </div>
      </div>
      <h3>${esc(l.title)}</h3>
      <div class="facts">${facts.join('')}</div>
      ${l.snippet ? `<p class="snippet">${esc(l.snippet)}</p>${l.snippet.length > 220 ? '<button class="link-btn more" data-act="more">Show more</button>' : ''}` : ''}
      <div class="card-foot">
        <span class="meta">${esc(l.sourceLabel)} · ${esc(timeAgo(l.postedAt))}${also}</span>
        ${external ? `<a class="btn btn-ghost" href="${esc(external)}" target="_blank" rel="noopener">Listing</a>` : ''}
        ${view && view !== contact ? `<a class="btn btn-ghost" href="${esc(view)}" target="_blank" rel="noopener">View post</a>` : ''}
        ${emails}
        ${contact ? `<a class="btn btn-primary" href="${esc(contact)}" target="_blank" rel="noopener">${esc(contactLabel(l))}</a>` : ''}
      </div>
    </article>`;
}

function renderHoods() {
  const counts = new Map();
  for (const l of data.listings) {
    const key = l.neighborhood || UNKNOWN_HOOD;
    const entry = counts.get(key) || { n: 0, borough: l.neighborhood ? (l.borough || 'Unknown') : 'Unknown' };
    entry.n++;
    counts.set(key, entry);
  }
  const f = state.filters;
  const groups = new Map();
  for (const [name, { n, borough }] of counts) {
    const label = name === UNKNOWN_HOOD ? 'Not specified' : name;
    if (hoodQuery && !label.toLowerCase().includes(hoodQuery) && !borough.toLowerCase().includes(hoodQuery)) continue;
    if (!groups.has(borough)) groups.set(borough, []);
    groups.get(borough).push({ name, label, n });
  }
  const html = [...groups.entries()]
    .sort(([a], [b]) => BOROUGH_ORDER.indexOf(a) - BOROUGH_ORDER.indexOf(b))
    .map(([borough, items]) => `
      <div class="hood-boro">${esc(borough)}</div>
      ${items.sort((a, b) => (a.name === UNKNOWN_HOOD) - (b.name === UNKNOWN_HOOD) || a.label.localeCompare(b.label)).map((h) => `
        <label><input type="checkbox" value="${esc(h.name)}" ${f.hoods.includes(h.name) ? 'checked' : ''}>
        <span>${esc(h.label)}</span><span class="n">${h.n}</span></label>`).join('')}`)
    .join('');
  $('#hoods').innerHTML = html || '<p class="hint">No neighborhoods yet.</p>';
  $('#clear-hoods').hidden = !f.hoods.length;
}

function renderSources() {
  const sources = [...new Set(data.listings.map((l) => l.source))].sort();
  const labels = { reddit: 'Reddit', craigslist: 'Craigslist', facebook: 'Facebook' };
  $('#sources').innerHTML = sources.map((s) => `<button type="button" data-value="${esc(s)}" aria-pressed="${state.filters.sources.includes(s)}">${esc(labels[s] || s[0].toUpperCase() + s.slice(1))}</button>`).join('')
    || '<span class="hint">None yet</span>';
}

function syncControls() {
  const f = state.filters;
  $('#q').value = f.q;
  $('#max-price').value = f.maxPrice;
  $('#max-price-out').textContent = money(f.maxPrice);
  document.querySelectorAll('#laundry button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === f.laundry)));
  document.querySelectorAll('#bedrooms button').forEach((b) => b.setAttribute('aria-pressed', String(f.bedrooms.includes(b.dataset.value))));
  document.querySelectorAll('#roommates button').forEach((b) => b.setAttribute('aria-pressed', String(f.roommates.includes(b.dataset.value))));
  $('#move-by').value = f.moveBy;
  $('#incomplete').checked = f.incomplete;
  $('#saved-only').checked = f.savedOnly;
  $('#show-hidden').checked = f.showHidden;
  $('#sort').value = f.sort;
}

function activeFilterCount() {
  const f = state.filters;
  let n = 0;
  for (const k of ['q', 'moveBy']) if (f[k]) n++;
  for (const k of ['bedrooms', 'roommates', 'hoods', 'sources']) if (f[k].length) n++;
  if (f.laundry !== 'any') n++;
  if (f.maxPrice < DEFAULTS.maxPrice) n++;
  if (f.savedOnly || f.incomplete || f.showHidden) n++;
  return n;
}

function render() {
  const f = state.filters;
  const results = data.listings.filter((l) => matches(l, f)).sort(SORTS[f.sort] || SORTS['price-asc']);
  $('#grid').innerHTML = results.map(renderCard).join('');
  const total = data.listings.length;
  $('#count').textContent = total ? `${results.length} of ${total} listings` : '';
  const n = activeFilterCount();
  $('#filter-count').textContent = n ? `(${n})` : '';

  const empty = $('#empty');
  empty.hidden = results.length > 0;
  if (!total) {
    empty.innerHTML = `<h2>No listings yet</h2><p>Run <code>npm run scrape</code> to fetch listings${isLocal ? ', click <b>Refresh now</b>, or add one by hand with <b>+ Add a listing</b>' : ''}.</p>`;
  } else if (!results.length) {
    empty.innerHTML = '<h2>Nothing matches these filters</h2><p>Try widening your price, neighborhoods, or turning on “Include listings missing price or bedrooms”.</p>';
  }
  persist();
}

function renderAll() {
  renderHoods();
  renderSources();
  syncControls();
  render();
}

// ---------- events ----------

function update(patch) {
  Object.assign(state.filters, patch);
  syncControls();
  render();
}

function toggleIn(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function bindEvents() {
  $('#q').addEventListener('input', (e) => update({ q: e.target.value }));
  $('#max-price').addEventListener('input', (e) => update({ maxPrice: +e.target.value }));
  $('#move-by').addEventListener('change', (e) => update({ moveBy: e.target.value }));
  $('#sort').addEventListener('change', (e) => update({ sort: e.target.value }));
  $('#incomplete').addEventListener('change', (e) => update({ incomplete: e.target.checked }));
  $('#saved-only').addEventListener('change', (e) => update({ savedOnly: e.target.checked }));
  $('#show-hidden').addEventListener('change', (e) => update({ showHidden: e.target.checked }));
  $('#laundry').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) update({ laundry: b.dataset.value });
  });
  for (const key of ['bedrooms', 'roommates']) {
    $(`#${key}`).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) update({ [key]: toggleIn(state.filters[key], b.dataset.value) });
    });
  }
  $('#sources').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    update({ sources: toggleIn(state.filters.sources, b.dataset.value) });
    renderSources();
  });
  $('#hoods').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    update({ hoods: toggleIn(state.filters.hoods, e.target.value) });
    $('#clear-hoods').hidden = !state.filters.hoods.length;
  });
  $('#hood-q').addEventListener('input', (e) => { hoodQuery = e.target.value.trim().toLowerCase(); renderHoods(); });
  $('#clear-hoods').addEventListener('click', () => { update({ hoods: [] }); renderHoods(); });
  $('#reset-btn').addEventListener('click', () => {
    state.filters = { ...DEFAULTS, maxPrice: data.criteria?.maxShare || DEFAULTS.maxPrice, sort: state.filters.sort };
    renderAll();
  });
  $('#open-filters').addEventListener('click', () => $('#filters').classList.add('open'));
  $('#close-filters').addEventListener('click', () => $('#filters').classList.remove('open'));

  $('#grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.card');
    const id = card.dataset.id;
    if (btn.dataset.act === 'more') {
      const open = card.querySelector('.snippet').classList.toggle('open');
      btn.textContent = open ? 'Show less' : 'Show more';
      return;
    }
    const set = btn.dataset.act === 'save' ? state.saved : state.hidden;
    if (set.has(id)) set.delete(id); else set.add(id);
    render();
  });

  // Local-server-only actions
  $('#refresh-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    try {
      const res = await fetch('/api/scrape', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      console.info(json.logs.join('\n'));
      await loadData();
    } catch (err) {
      alert(`Refresh failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Refresh now';
    }
  });

  const dialog = $('#add-dialog');
  $('#add-btn').addEventListener('click', () => {
    $('#add-form').reset();
    $('#add-error').hidden = true;
    dialog.showModal();
  });
  $('#add-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const overrides = {};
    for (const k of ['price', 'bedrooms', 'roommates']) if (fd.get(k) !== '') overrides[k] = +fd.get(k);
    for (const k of ['neighborhood', 'laundry', 'moveIn']) if (fd.get(k)) overrides[k] = fd.get(k);
    const submit = $('#add-submit');
    submit.disabled = true;
    try {
      const res = await fetch('/api/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fd.get('url'), text: fd.get('text'), overrides }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      dialog.close();
      await loadData();
    } catch (err) {
      $('#add-error').textContent = err.message;
      $('#add-error').hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

// ---------- boot ----------

async function loadData() {
  try {
    const res = await fetch(`data/listings.json?t=${Date.now()}`);
    if (res.ok) data = await res.json();
  } catch { /* keep whatever we had */ }
  data.listings ||= [];
  const maxShare = data.criteria?.maxShare || DEFAULTS.maxPrice;
  $('#max-price').max = maxShare;
  if (state.filters.maxPrice > maxShare) state.filters.maxPrice = maxShare;
  const c = data.criteria || {};
  if (c.maxShare) $('#tagline').textContent = `NYC room shares · ${c.minBedrooms}–${c.maxBedrooms} bedrooms · your share ≤ ${money(c.maxShare)}`;
  $('#updated').textContent = data.generatedAt ? `Updated ${timeAgo(data.generatedAt)}` : '';
  $('#updated').title = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '';
  renderAll();
}

async function detectLocal() {
  try {
    const res = await fetch('/api/health');
    isLocal = res.ok && (await res.json()).local === true;
  } catch { isLocal = false; }
  document.querySelectorAll('.local-only').forEach((el) => { el.hidden = !isLocal; });
}

bindEvents();
await detectLocal();
await loadData();
