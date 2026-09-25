// Source-expansion probe for NEW candidate sites (2026-09-25 round 2).
//
// For each candidate: robots.txt (full text), the terms page(s) — found
// automatically from the homepage when not given — and the NYC listing pages.
// Unlike probe/investigate.js this probe RESPECTS robots.txt for every page:
// a disallowed page is recorded as "not fetched", never requested.
// One plain request per page, honest bot User-Agent, no cookies/login, no
// retries, >=2 s between requests per host (shared get() helper).
//
// The console log contains structure and counts only (status, formats,
// listing links, photos, price mentions, pagination hints) plus public
// robots/terms text. Raw pages go to out/pages/ and leave the runner only
// encrypted (.github/workflows/investigate.yml).
//
//   ONLY=roomgo,cohabby node probe/candidates.js
import { mkdir, writeFile } from 'node:fs/promises';
import { parseRobots, isAllowed } from './robots.js';
import { PROHIBITS, stripHtml } from './antibot.js';
import { get, describe } from './investigate.js';
import { USER_AGENT } from '../scraper/http.js';

export const CANDIDATES = {
  roomgo: { name: 'Roomgo', origin: 'https://www.roomgo.net', pages: ['/new-york/NYC-roommate', '/new-york'] },
  cohabby: { name: 'CoHabby', origin: 'https://cohabby.com', pages: ['/roommate-finder/new-york-ny/', '/rooms-for-rent/new-york-ny/'] },
  cohabitas: { name: 'Cohabitas', origin: 'https://cohabitas.com', pages: ['/rooms-for-rent/united-states/new-york/new-york-city/'] },
  nyhabitat: { name: 'New York Habitat', origin: 'https://www.nyhabitat.com', pages: ['/new-york-apartment/roommate-share'] },
  nybits: { name: 'NYBits', origin: 'https://www.nybits.com', pages: ['/', '/search/', '/roommates/', '/shares.html'] },
  leaseswap: { name: 'Leaseswap', origin: 'https://leaseswap.nyc', pages: ['/lease-takeovers', '/'] },
  stooper: { name: 'Stooper', origin: 'https://www.stooper.com', pages: ['/', '/sublets', '/rooms'] },
  flip: { name: 'Flip', origin: 'https://flip.lease', pages: ['/', '/new-york-city', '/listings'] },
  snag: { name: 'Snag sublets', origin: 'https://snagsublets.com', pages: ['/', '/new-york'] },
  geebo: { name: 'Geebo', origin: 'https://newyork-ny.geebo.com', pages: ['/rentals-roommates/list/'] },
  locanto: { name: 'Locanto', origin: 'https://www.locanto.com', pages: ['/newyork/Rooms-for-Rent/302/', '/new-york/Rooms-for-Rent/302/'] },
  oodle: { name: 'Oodle', origin: 'https://apartments.oodle.com', pages: ['/new-york-ny/rooms-for-rent/', '/new-york-ny/'] },
  hoobly: { name: 'Hoobly', origin: 'https://www.hoobly.com', pages: ['/'] },
  roommatescom: { name: 'Roommates.com', origin: 'https://www.roommates.com', pages: ['/rooms/new-york', '/'] },
  diggz: { name: 'Diggz', origin: 'https://www.diggz.co', pages: ['/', '/new-york-ny/rooms-for-rent'] },
  roomies: { name: 'Roomies.com', origin: 'https://www.roomies.com', pages: ['/rooms/new-york-new-york', '/new-york-ny'] },
  roomsurf: { name: 'RoomSurf', origin: 'https://www.roomsurf.com', pages: ['/'] },
  rentberry: { name: 'Rentberry', origin: 'https://rentberry.com', pages: ['/apartments/s/new-york-ny', '/'] },
  // Round 2 (follow-ups + new candidates)
  snag2: { name: 'Snag sublets (terms + sitemap)', origin: 'https://snagsublets.com', pages: ['/sitemap.xml', '/about'], terms: ['https://snagsublets.com/terms', 'https://snagsublets.com/tos', 'https://snagsublets.com/terms-of-service'] },
  nybits2: { name: 'NYBits (allowed search pages)', origin: 'https://www.nybits.com', pages: ['/search/studio.html', '/search/1br.html', '/manhattan/', '/brooklyn/'], terms: ['https://www.nybits.com/terms.html'] },
  roomsterterms: { name: 'Roomster (terms re-read)', origin: 'https://www.roomster.com', pages: [], terms: ['https://www.roomster.com/terms', 'https://www.roomster.com/tos', 'https://roomster.com/terms-of-use'] },
  iroomit: { name: 'iROOMit', origin: 'https://www.iroomit.com', pages: ['/nyc'] },
  platuni: { name: 'Platuni', origin: 'https://www.platuni.com', pages: ['/new-york', '/'] },
  transparentcity: { name: 'TransparentCity', origin: 'https://www.transparentcity.co', pages: ['/'] },
  snag3: { name: 'Snag sublets (NYC hub + terms)', origin: 'https://snagsublets.com', pages: ['/sublets/new-york', '/sublets/new-york/bushwick'], terms: ['https://snagsublets.com/legal/terms'] },
  classifiedads: { name: 'ClassifiedAds.com', origin: 'https://www.classifiedads.com', pages: ['/search.php?keywords=room&cid=16&lid=rx10542&lname=New%20York', '/'] },
  adpost: { name: 'Adpost', origin: 'https://www.adpost.com', pages: ['/us/real_estate/rooms_for_rent/new_york/', '/us/'] },
  americanlisted: { name: 'AmericanListed', origin: 'https://newyork.americanlisted.com', pages: ['/rooms-shared/', '/'] },
  trovit: { name: 'Trovit', origin: 'https://homes.trovit.com', pages: ['/rooms-for-rent-new-york', '/'] },
  rentola: { name: 'Rentola', origin: 'https://rentola.com', pages: ['/for-rent/new-york-city/rooms', '/'] },
  sharedeasy: { name: 'SharedEasy', origin: 'https://sharedeasy.club', pages: ['/furnished-rooms-for-rent-nyc/'] },
};

// Clauses about copying/extracting/republishing content (not only "scraping").
const REUSE = /\b(?:copy|copied|reproduc|republish|redistribut|extract|re-?utili[sz]|systematic(?:ally)?\s+(?:retriev|download|collect)|framing|mirror(?:ing)?|in-line linking|compile|database)/i;

const TERMS_HREF = /href="([^"#]*(?:terms|tos\b|legal|conditions|user-agreement)[^"#]*)"/gi;
const PRICE = /\$\s?\d{1,2},?\d{3}\b/g;

// Same-host links that look like individual listings: a path segment with a
// 5+ digit number or a UUID.
function listingLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/href="([^"#]+)"/g)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), base); } catch { continue; }
    if (u.host !== new URL(base).host) continue;
    if (/\/(?:[^/]*\d{5,}[^/]*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.test(u.pathname)) out.add(u.origin + u.pathname);
  }
  return [...out];
}

function flightText(html) {
  let t = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) { try { t += JSON.parse(m[1]); } catch { /* skip */ } }
  return t;
}

async function probe(id, c) {
  const out = { id, name: c.name, origin: c.origin, checkedAt: new Date().toISOString(), terms: [], pages: [] };
  const r = await get(`${c.origin}/robots.txt`, { manualRedirect: false });
  const robotsOk = r.status === 200 && /text\/plain/.test(r.contentType || '');
  const groups = robotsOk ? parseRobots(r.body) : null;
  out.robots = { status: r.status ?? r.error, parsed: robotsOk, antiBot: r.antiBot, text: robotsOk ? r.body.slice(0, 1500) : null };
  const allowed = (path) => (groups ? isAllowed(groups, path, USER_AGENT) : { allowed: null, rule: `robots.txt unavailable (${r.status ?? r.error})` });

  let n = 0;
  const save = async (res) => {
    const file = `${id}-${String(++n).padStart(2, '0')}.txt`;
    await writeFile(`out/pages/${file}`, `${res.finalUrl || ''}\n${JSON.stringify(res.chain || [])}\n\n${res.body || res.error || ''}`);
    return file;
  };

  const termsUrls = new Set(c.terms || []);
  const queue = [...c.pages];
  if (!queue.includes('/') && !c.terms) queue.push('/');
  let detailTried = false;
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    const url = path.startsWith('http') ? path : c.origin + path;
    const u = new URL(url);
    const verdict = allowed(u.pathname + u.search);
    if (verdict.allowed === false) {
      out.pages.push({ kind: path.startsWith('http') ? 'listing detail (discovered)' : 'page', url, robots: verdict, fetched: false });
      continue;
    }
    const res = await get(url);
    const d = describe(res, { listingLink: /$^/g });
    const links = res.body ? listingLinks(res.body, res.finalUrl || url) : [];
    const flight = res.body ? flightText(res.body) : '';
    out.pages.push({
      kind: path.startsWith('http') ? 'listing detail (discovered)' : 'page', url, robots: verdict, fetched: true, ...d,
      listingLinks: links.length, priceMentions: (stripHtml(res.body || '').match(PRICE) || []).length + (flight.match(PRICE) || []).length,
      nextFlightBytes: flight.length, file: await save(res),
    });
    for (const m of (res.body || '').matchAll(TERMS_HREF)) {
      try { const t = new URL(m[1].replace(/&amp;/g, '&'), url); if (t.host.endsWith(new URL(c.origin).host.replace(/^www\./, ''))) termsUrls.add(t.href); } catch { /* bad href */ }
    }
    if (!detailTried && links.length) { detailTried = true; queue.push(links[0]); }
  }
  for (const t of [...termsUrls].slice(0, 3)) {
    const res = await get(t, { manualRedirect: false });
    const text = `${stripHtml(res.body || '')} ${flightText(res.body || '').replace(/\\n/g, ' ')}`;
    out.terms.push({
      url: t, status: res.status ?? res.error, antiBot: res.antiBot, bytes: (res.body || '').length,
      clauses: [...new Set(text.split(/(?<=[.;:])\s+/).filter((s) => PROHIBITS.test(s) && s.length > 30).map((s) => s.slice(0, 600)))].slice(0, 6),
      reuseClauses: [...new Set(text.split(/(?<=[.;:])\s+/).filter((s) => REUSE.test(s) && !PROHIBITS.test(s) && s.length > 30).map((s) => s.slice(0, 600)))].slice(0, 6),
      file: await save(res),
    });
  }
  return out;
}

function log(s) {
  console.log(`\n=== ${s.name} (${s.origin}) ===`);
  console.log(`robots.txt: ${s.robots.status}${s.robots.antiBot?.length ? ` [${s.robots.antiBot}]` : ''}`);
  if (s.robots.text) console.log(s.robots.text.split('\n').filter((l) => l.trim()).slice(0, 25).map((l) => `  | ${l}`).join('\n'));
  for (const p of s.pages) {
    if (!p.fetched) { console.log(`- ${p.kind} ${p.url}: NOT FETCHED — robots.txt ${p.robots.rule}`); continue; }
    console.log(`- ${p.kind} ${p.url}: HTTP ${p.status ?? p.error}${p.redirects?.length ? ` via ${p.redirects.join(', ')}` : ''} ${p.contentType || ''} ${p.bytes ?? 0}B`
      + ` robots=${p.robots.allowed === null ? '?' : p.robots.allowed ? 'allowed' : 'DISALLOWED'} login=${p.loginWall} antibot=[${(p.antiBot || []).join(',')}]`
      + ` jsonld=[${p.jsonLdTypes.join(',')}] embedded=[${p.embedded.join(',')}] nextFlight=${p.nextFlightBytes}B listingLinks=${p.listingLinks} images=${p.images} prices=${p.priceMentions} pagination=[${p.pagination.join(',')}]`);
  }
  for (const t of s.terms) {
    console.log(`terms ${t.url}: HTTP ${t.status} ${(t.antiBot || []).join(',')} ${t.bytes}B prohibiting-clauses=${t.clauses.length}`);
    for (const c of t.clauses) console.log(`    » ${c}`);
    for (const c of t.reuseClauses || []) console.log(`    ≈ ${c}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(CANDIDATES);
  await mkdir('out/pages', { recursive: true });
  const results = [];
  for (const id of only) {
    if (!CANDIDATES[id]) { console.log(`unknown candidate ${id}`); continue; }
    try {
      const s = await probe(id, CANDIDATES[id]);
      log(s);
      results.push(s);
    } catch (err) {
      console.log(`\n=== ${id}: probe error ${err.name}`);
    }
  }
  await writeFile('out/candidates.json', JSON.stringify(results, null, 2));
}
