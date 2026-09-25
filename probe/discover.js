// Stage 4: small discovery for the two terms-verified sources.
//  - Roomster: find the NYC "rooms offered" index (the /roommates page lists seekers)
//  - June Homes: pagination and the photo gallery on a room detail page

import { USER_AGENT } from './sources.js';
import { parseRobots, isAllowed } from './robots.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"');

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  return { status: res.status, finalUrl: res.url, body: await res.text() };
}
const jsonLd = (html) => [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);

// ---- Roomster
const rRobots = parseRobots((await get('https://www.roomster.com/robots.txt')).body);
const home = await get('https://www.roomster.com/roommates/new-york');
const hrefs = [...new Set([...home.body.matchAll(/href="([^"]+)"/g)].map((m) => decode(m[1])))];
console.log('roomster NYC-ish links:', hrefs.filter((h) => /new-york|nyc|rooms|sublet|apartment/i.test(h)).slice(0, 40).join('\n  '));
const candidates = ['/rooms/new-york-ny', '/rooms-for-rent/new-york', '/sublets/new-york', '/apartments/new-york', '/entire-place/new-york', '/rooms/new-york-city', '/rooms/united-states/new-york'];
for (const path of candidates) {
  if (!isAllowed(rRobots, path, USER_AGENT).allowed) { console.log(`roomster ${path}: robots disallow`); continue; }
  await sleep(1500);
  const r = await get('https://www.roomster.com' + path);
  const items = jsonLd(r.body).flatMap((b) => b.itemListElement || []).map((i) => i.item?.['@type']).filter(Boolean);
  console.log(`roomster ${path}: HTTP ${r.status} -> ${r.finalUrl} itemTypes=${JSON.stringify(items.reduce((a, t) => ({ ...a, [t]: (a[t] || 0) + 1 }), {}))}`);
}

// ---- June Homes
await sleep(1500);
const jIdx = await get('https://junehomes.com/residences/new-york-city-ny');
const pages = [...new Set([...jIdx.body.matchAll(/href="([^"]*[?&]page=\d+[^"]*)"/g)].map((m) => decode(m[1])))];
console.log('junehomes pagination links:', pages.slice(0, 10).join(' '));
console.log('junehomes apartments on page 1:', jsonLd(jIdx.body).filter((b) => b['@type'] === 'Apartment').length);
const avail = [...jIdx.body.replace(/<[^>]+>/g, ' ').matchAll(/Available from (\d\d\/\d\d\/\d{4})/g)].map((m) => m[1]);
console.log('junehomes availability dates on page 1:', avail.slice(0, 12).join(' '));
const first = jsonLd(jIdx.body).find((b) => b['@type'] === 'Apartment');
if (first) {
  await sleep(1500);
  const d = await get(first.url);
  const ld = jsonLd(d.body);
  console.log('junehomes detail', first.url, 'HTTP', d.status, 'jsonld types', JSON.stringify(ld.map((b) => b['@type'])));
  for (const b of ld) console.log('   ', JSON.stringify(b).slice(0, 1500));
  const imgs = [...new Set([...d.body.matchAll(/https:\/\/storage\.googleapis\.com\/junehomes\/media\/[^"'\s)&]+/g)].map((m) => m[0]))];
  console.log(`junehomes detail gallery images: ${imgs.length}`);
  console.log('   ', imgs.slice(0, 8).join('\n    '));
  const text = d.body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const kw of ['roommate', 'Available', 'laundry', 'Washer', 'utilities', 'furnished', 'lease', 'Bedrooms', 'bath']) {
    const m = new RegExp(`.{0,80}${kw}.{0,120}`, 'i').exec(text);
    console.log(`   [${kw}] ${m ? m[0] : '—'}`);
  }
}
