// Entry point: `npm run scrape`.
//   1. run every source adapter (one failure never stops the others)
//   2. normalize, 3. validate photos, 4. merge with the previous run,
//   5. drop stale/taken-down/over-budget listings, 6. dedupe across sources,
//   7. write public/data/listings.json + public/data/status.json
// Logs contain counts and statuses only — never listing text.
//
// Flags: --offline (reprocess stored + manual only), --dry-run (don't write files)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { ADAPTERS, EXCLUDED } from './sources/index.js';
import { normalizeListing } from './schema.js';
import { validatePhotos } from './photos.js';
import { dedupe } from './dedupe.js';
import { BlockedError, RobotsDisallowedError } from './http.js';

export const LISTINGS_PATH = new URL('../public/data/listings.json', import.meta.url);
export const STATUS_PATH = new URL('../public/data/status.json', import.meta.url);

const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

export function classifyError(err) {
  if (err.name === 'AuthRequiredError') return 'AUTH_REQUIRED';
  if (err instanceof BlockedError) return 'SOURCE_BLOCKED';
  if (err instanceof RobotsDisallowedError) return 'NO_PUBLIC_ACCESS';
  const code = err.cause?.code || err.code;
  if (NETWORK_CODES.has(code) || err.name === 'TimeoutError' || /fetch failed/.test(err.message)) return 'ENVIRONMENT_BLOCKED';
  return 'LIVE_WITH_LIMITATIONS';
}

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
}

// Real-data quality report for one source: coverage of each field (share of
// retained listings where the field is known) and how much is inferred.
const FIELD_KEYS = ['bedrooms', 'roommates', 'moveIn', 'neighborhood', 'borough', 'laundry', 'furnished', 'roomType', 'bathrooms', 'leaseLength', 'pets'];
export function quality(listings) {
  const n = listings.length;
  if (!n) return null;
  const pct = (fn) => Math.round((listings.filter(fn).length / n) * 100);
  const types = {};
  for (const l of listings) types[l.listingType.value] = (types[l.listingType.value] || 0) + 1;
  let inferred = 0;
  for (const l of listings) for (const k of FIELD_KEYS) if (l[k]?.basis === 'inferred') inferred++;
  return {
    coverage: {
      yourShare: pct((l) => l.price.share != null),
      priceOrTotal: pct((l) => l.price.share != null || l.price.total != null),
      listingType: pct((l) => l.listingType.value !== 'UNKNOWN'),
      bedrooms: pct((l) => l.bedrooms.value != null),
      roommatesStated: pct((l) => l.roommates.value != null),
      neighborhood: pct((l) => l.neighborhood.value != null),
      borough: pct((l) => l.borough.value != null),
      moveIn: pct((l) => l.moveIn.value != null),
      laundry: pct((l) => l.laundry.value != null),
      furnished: pct((l) => l.furnished.value != null),
      photos: pct((l) => l.photos.length > 0),
    },
    types,
    inferredFields: inferred,
    needsConfirmation: listings.filter((l) => l.price.status === 'needs_confirmation').length,
    priceNotListed: listings.filter((l) => l.price.status === 'not_listed').length,
  };
}

export async function run({ offline = false, dryRun = false, log = console.log, now = Date.now() } = {}) {
  const scrapedAt = new Date(now).toISOString();
  const previous = (await readJson(LISTINGS_PATH, { listings: [] })).listings || [];
  const prevStatus = await readJson(STATUS_PATH, { sources: [] });
  const statuses = [];
  const fresh = [];
  const liveSources = new Set();

  for (const adapter of ADAPTERS) {
    const st = { id: adapter.id, name: adapter.name, kind: adapter.kind, access: adapter.access, photos: adapter.photos, count: 0, withPhotos: 0 };
    const prev = prevStatus.sources?.find((s) => s.id === adapter.id);
    st.lastSuccessAt = prev?.lastSuccessAt ?? null;
    statuses.push(st);
    if (adapter.requiresEnable && !config.enabled.has(adapter.id)) {
      Object.assign(st, { status: 'UNVERIFIED', reason: `${adapter.unverifiedReason}. Disabled until ENABLE_SOURCES includes "${adapter.id}".` });
      continue;
    }
    if (offline && !adapter.manual) {
      Object.assign(st, { status: prev?.status ?? 'UNVERIFIED', reason: 'offline rebuild — not fetched this run', count: prev?.count ?? 0 });
      continue;
    }
    const started = Date.now();
    const notes = [];
    try {
      const partials = await adapter.run(config, (m) => { notes.push(m); log(m); });
      const listings = partials.map((p) => normalizeListing(p, { scrapedAt }));
      for (const l of listings) l.lastSeenAt = scrapedAt;
      fresh.push(...listings);
      st.count = listings.length;
      st.status = adapter.manual ? 'MANUAL_ONLY' : listings.length ? 'LIVE' : 'LIVE_WITH_LIMITATIONS';
      if (!adapter.manual && listings.length) {
        liveSources.add(adapter.id);
        st.lastSuccessAt = scrapedAt;
      }
      if (!listings.length && !adapter.manual) st.reason = 'Fetched successfully but found no listings';
      const limits = [];
      const detailFailures = notes.filter((n) => /detail failed/.test(n)).length;
      if (detailFailures) limits.push(`${detailFailures} detail page(s) failed; those listings have fewer details`);
      const robotsSkips = notes.find((n) => /disallowed by robots\.txt/.test(n));
      if (robotsSkips) limits.push(`${robotsSkips.replace(/^[a-z]+: /, '')} (coverage limited to pages robots.txt allows)`);
      if (limits.length && listings.length) {
        st.status = 'LIVE_WITH_LIMITATIONS';
        st.reason = limits.join('; ');
      }
    } catch (err) {
      st.status = classifyError(err);
      st.reason = err.message;
      log(`${adapter.id}: ${st.status} — ${err.message}`);
    }
    st.durationMs = Date.now() - started;
  }

  // Photo validation on this run's listings.
  const photoResult = offline ? { checked: 0, ok: 0 } : await validatePhotos(fresh, { log });

  // Merge: fresh listings replace previous ones; keep previous listings from
  // sources that failed this run (a transient outage shouldn't empty the site).
  const byId = new Map();
  for (const l of previous) {
    const src = l.source;
    if (liveSources.has(src) || src === 'manual') continue; // re-fetched (or re-read) this run
    byId.set(l.id, { ...l, carriedOver: true });
  }
  for (const l of fresh) byId.set(l.id, l);

  const dropped = {};
  const droppedBySource = {};
  const drop = (reason, source) => {
    dropped[reason] = (dropped[reason] || 0) + 1;
    droppedBySource[source] ??= {};
    droppedBySource[source][reason] = (droppedBySource[source][reason] || 0) + 1;
  };
  const kept = [];
  for (const l of byId.values()) {
    if (l.postType === 'seeking') { drop('seeking', l.source); continue; }
    if (l.price.share != null && l.price.share > config.maxShare) { drop('over budget', l.source); continue; }
    if (l.postedAt && now - Date.parse(l.postedAt) > config.maxAgeDays * 86400000) { drop('too old', l.source); continue; }
    if (l.lastSeenAt && now - Date.parse(l.lastSeenAt) > config.goneAfterDays * 86400000) { drop('no longer listed', l.source); continue; }
    kept.push(l);
  }
  const uniqueIdSources = new Set(ADAPTERS.filter((a) => a.uniqueIds).map((a) => a.id));
  const listings = dedupe(kept, { uniqueIdSources });
  const merged = kept.length - listings.length;

  for (const st of statuses) {
    const mine = listings.filter((l) => l.source === st.id || l.sources.some((s) => s.source === st.id));
    st.inDataset = mine.length;
    st.withPhotos = mine.filter((l) => l.photos.length).length;
    st.retrieved = st.count;
    st.discarded = droppedBySource[st.id] || {};
    st.quality = quality(mine);
  }

  const status = {
    generatedAt: scrapedAt,
    dataKind: 'REAL',
    criteria: { maxShare: config.maxShare, defaultBedrooms: config.defaultBedrooms, maxAgeDays: config.maxAgeDays },
    totals: {
      listings: listings.length,
      withPhotos: listings.filter((l) => l.photos.length).length,
      duplicatesMerged: merged,
      dropped,
      photosChecked: photoResult.checked,
      photosLoaded: photoResult.ok,
    },
    sources: statuses,
    excluded: EXCLUDED,
  };

  logSummary(status, log);

  if (!dryRun) {
    await mkdir(new URL('.', LISTINGS_PATH), { recursive: true });
    await writeFile(LISTINGS_PATH, JSON.stringify({ generatedAt: scrapedAt, dataKind: 'REAL', listings }) + '\n');
    await writeFile(STATUS_PATH, JSON.stringify(status, null, 1) + '\n');
  }
  return { listings, status };
}

// Counts and statuses only — this is what appears in CI logs. Never listing
// text, contacts, names, URLs of individual listings or HTML.
export function logSummary(status, log = console.log) {
  const t = status.totals;
  for (const st of status.sources) {
    const q = st.quality;
    log(`${st.name}: ${st.inDataset ?? 0} listings (${st.retrieved ?? 0} retrieved) · status ${st.status}`
      + (q ? ` · photos ${st.withPhotos}/${st.inDataset} · share known ${q.coverage.yourShare}% · needs confirmation ${q.needsConfirmation}` : ''));
  }
  log(`Total: ${t.listings} listings · photos ${t.withPhotos}/${t.listings} · photo checks ${t.photosLoaded}/${t.photosChecked} · duplicates merged ${t.duplicatesMerged}`);
  log(`Errors: ${status.sources.filter((s) => ['SOURCE_BLOCKED', 'ENVIRONMENT_BLOCKED', 'LIVE_WITH_LIMITATIONS'].includes(s.status) && !s.inDataset).length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ offline: process.argv.includes('--offline'), dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
