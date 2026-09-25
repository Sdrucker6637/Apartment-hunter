// Verifies that listing photos load for an anonymous visitor (no cookies, no
// referer) — i.e. that the site can display them by linking to the original
// URL. We only link to photos; nothing is downloaded or re-hosted.

import { USER_AGENT } from './http.js';

export async function checkPhoto(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(15000) });
    await res.arrayBuffer();
    const type = res.headers.get('content-type') || '';
    const ok = (res.status === 200 || res.status === 206) && type.startsWith('image/');
    return { ok, status: res.status, type };
  } catch (err) {
    return { ok: false, status: null, error: err.cause?.code || err.name };
  }
}

// Checks each listing's first photos (up to `perListing`) with limited
// concurrency; drops photos that fail and records the outcome.
export async function validatePhotos(listings, { perListing = 2, concurrency = 6, log = () => {} } = {}) {
  const tasks = [];
  for (const l of listings) {
    for (const p of l.photos.slice(0, perListing)) tasks.push({ l, p });
  }
  let i = 0;
  const failedByListing = new Map();
  async function worker() {
    while (i < tasks.length) {
      const { l, p } = tasks[i++];
      const r = await checkPhoto(p.thumb || p.url);
      p.verified = r.ok;
      if (!r.ok) failedByListing.set(l.id, (failedByListing.get(l.id) || 0) + 1);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  let checked = 0;
  let ok = 0;
  for (const l of listings) {
    const tested = l.photos.slice(0, perListing);
    checked += tested.length;
    ok += tested.filter((p) => p.verified).length;
    // Drop photos that failed; keep untested gallery photos (the UI hides any that fail to load).
    l.photos = l.photos.filter((p) => p.verified !== false);
    l.photos.forEach((p, idx) => { p.isPrimary = idx === 0; });
    if (!l.photos.length) l.photoStatus = l.originalUrl ? 'source_only' : 'none';
  }
  log(`photos: ${ok}/${checked} checked photos load anonymously`);
  return { checked, ok };
}
