// Entry point: `npm run scrape`.
//   1. run every source adapter (one failure never stops the others)
//   2. normalize, 3. validate photos, 4. merge with the previous run,
//   5. drop stale/taken-down/over-budget listings, 6. dedupe across sources,
//   7. write public/data/listings.json + public/data/status.json
// Logs contain counts and statuses only — never listing text.
//
// Flags: --offline (reprocess stored listings only), --dry-run (don't write files)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { SOURCES, ADAPTERS, EXCLUDED } from './sources/index.js';
import { normalizeListing } from './schema.js';
import { validatePhotos } from './photos.js';
import { dedupe } from './dedupe.js';
import { BlockedError, RobotsDisallowedError } from './http.js';

export const LISTINGS_PATH = new URL('../public/data/listings.json', import.meta.url);
export const STATUS_PATH = new URL('../public/data/status.json', import.meta.url);

const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);

// Status for a source whose run threw. Network errors from our side are not
// the site blocking us, so they don't claim BLOCKED.
export function classifyError(err) {
  if (err.name === 'AuthRequiredError') return 'AUTH_REQUIRED';
  if (err instanceof BlockedError) return 'BLOCKED';
  if (err instanceof RobotsDisallowedError) return 'PERMISSION_REQUIRED';
  const code = err.cause?.code || err.code;
  if (NETWORK_CODES.has(code) || err.name === 'TimeoutError' || /fetch failed/.test(err.message)) return 'UNVERIFIED';
  return 'LIVE_WITH_LIMITATIONS';
}

export const STATUSES = ['LIVE', 'LIVE_WITH_LIMITATIONS', 'BLOCKED', 'AUTH_REQUIRED', 'PERMISSION_REQUIRED', 'NO_PUBLIC_ACCESS', 'DISABLED', 'UNVERIFIED'];

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

  for (const src of SOURCES) {
    const prev = prevStatus.sources?.find((s) => s.id === src.id);
    const st = {
      id: src.id, name: src.name, domain: src.domain, kind: src.kind, access: src.access, photos: src.photos,
      review: src.review || null,
      hasAdapter: !!src.run,
      enabled: false,
      count: 0, withPhotos: 0,
      lastSuccessAt: prev?.lastSuccessAt ?? null,
      lastFailureAt: prev?.lastFailureAt ?? null,
      failureReason: prev?.failureReason ?? null,
      nextStep: src.nextStep || null,
    };
    statuses.push(st);
    if (!src.run) {
      Object.assign(st, { status: src.defaultStatus || 'NO_PUBLIC_ACCESS', reason: src.reason || null });
      continue;
    }
    if (!src.enabledByDefault && !config.enabled.has(src.id)) {
      Object.assign(st, { status: src.defaultStatus || 'DISABLED', reason: `${src.reason || 'Not enabled.'} Disabled until ENABLE_SOURCES includes "${src.id}".` });
      continue;
    }
    if (src.needsCredentials?.(config)) {
      Object.assign(st, { status: 'AUTH_REQUIRED', reason: src.authReason || 'Credentials not configured.' });
      continue;
    }
    st.enabled = true;
    if (offline) {
      Object.assign(st, { status: prev?.status ?? 'UNVERIFIED', reason: 'offline rebuild — not fetched this run', count: prev?.count ?? 0 });
      continue;
    }
    const started = Date.now();
    const notes = [];
    try {
      const partials = await src.run(config, (m) => { notes.push(m); log(m); });
      const listings = partials.map((p) => normalizeListing(p, { scrapedAt }));
      for (const l of listings) l.lastSeenAt = scrapedAt;
      fresh.push(...listings);
      st.count = listings.length;
      // LIVE means real listings were retrieved AND parsed this run.
      st.status = listings.length ? 'LIVE' : 'LIVE_WITH_LIMITATIONS';
      if (listings.length) {
        liveSources.add(src.id);
        st.lastSuccessAt = scrapedAt;
      } else {
        st.reason = 'Pages fetched but no listings parsed';
        st.lastFailureAt = scrapedAt;
        st.failureReason = st.reason;
      }
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
      st.lastFailureAt = scrapedAt;
      st.failureReason = `${st.status}: ${err.message}`;
      if (st.status === 'LIVE_WITH_LIMITATIONS' || st.status === 'UNVERIFIED') {
        // A transient failure: previous listings are carried over below.
        st.status = st.lastSuccessAt ? 'LIVE_WITH_LIMITATIONS' : 'UNVERIFIED';
        st.reason = `This run failed (${err.message}); showing listings from the last successful run.`;
      }
      log(`${src.id}: ${st.status} (run failed)`);
    }
    st.durationMs = Date.now() - started;
  }

  // Verify runs only (encrypted output): everything retrieved, before any
  // filtering, so unseen listings can be frozen for held-out evaluation.
  if (process.env.DUMP_RETRIEVED && !dryRun) {
    await writeFile(process.env.DUMP_RETRIEVED, JSON.stringify({ scrapedAt, listings: fresh }) + '\n');
  }

  // Photo validation on this run's listings.
  const photoResult = offline ? { checked: 0, ok: 0 } : await validatePhotos(fresh, { log });

  // Merge: fresh listings replace previous ones; keep previous listings from
  // sources that failed this run (a transient outage shouldn't empty the site).
  const byId = new Map();
  for (const l of previous) {
    const src = l.source;
    if (liveSources.has(src)) continue; // re-fetched this run
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
    // Age: the later of posted and last-edited-on-source (an active listing the lister updated recently is current).
    const dates = [l.postedAt, l.sourceUpdatedAt].filter(Boolean).map(Date.parse).filter(Number.isFinite);
    if (dates.length && now - Math.max(...dates) > config.maxAgeDays * 86400000) { drop('too old', l.source); continue; }
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
    if (!st.enabled) { log(`${st.name}: not run · status ${st.status}`); continue; }
    log(`${st.name}: ${st.inDataset ?? 0} listings (${st.retrieved ?? 0} retrieved, ${Object.values(st.discarded || {}).reduce((a, b) => a + b, 0)} discarded) · status ${st.status}`
      + (q ? ` · photos ${st.withPhotos}/${st.inDataset} · share known ${q.coverage.yourShare}% · needs confirmation ${q.needsConfirmation}` : ''));
  }
  log(`Total: ${t.listings} listings · photos ${t.withPhotos}/${t.listings} · photo checks ${t.photosLoaded}/${t.photosChecked} · duplicates merged ${t.duplicatesMerged}`);
  log(`Errors: ${status.sources.filter((s) => s.lastFailureAt === status.generatedAt).length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ offline: process.argv.includes('--offline'), dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
