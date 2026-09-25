// Stage 3: targeted inspection of the candidate sources that returned real
// listings in stage 2. For each: locate and read the terms of use FIRST; if
// they prohibit automated access, stop. Otherwise dump what structured data
// the NYC index page exposes and inspect one listing detail page.
//
//   ONLY=roomster STAGE=inspect node probe/inspect.js

import { writeFile } from 'node:fs/promises';
import { USER_AGENT } from './sources.js';
import { parseRobots, isAllowed } from './robots.js';
import { antiBotSignals, termsExcerpts, PROHIBITS, stripHtml } from './antibot.js';

const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()).filter(Boolean) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const CANDIDATES = [
  {
    id: 'roomster', origin: 'https://www.roomster.com', index: '/roommates/new-york',
    terms: ['/terms', '/terms-of-use', '/tos', '/legal/terms'],
    detail: /href="(\/(?:room|listing|roommate)s?\/[^"]*\d{4,}[^"]*)"/i,
  },
  {
    id: 'diggz', origin: 'https://www.diggz.co', index: '/rooms-for-rent/new-york-ny',
    terms: ['/terms-of-service', '/tos', '/legal', '/terms-and-conditions', '/legal/terms', '/pages/terms'],
    detail: /href="(\/(?:rooms?|listings?|room-for-rent)[^"]*\/\d{3,}[^"]*|\/[a-z-]+\/\d{4,}[^"]*)"/i,
  },
  {
    id: 'roomies', origin: 'https://www.roomies.com', index: '/rooms/new-york-ny',
    terms: ['/terms-of-use', '/terms-of-service', '/tos', '/legal/terms', '/legal', '/pages/terms'],
    detail: /href="(\/rooms\/\d+[^"]*|\/listings?\/[^"]+)"/i,
  },
  {
    id: 'roomi', origin: 'https://roomiapp.com', index: '/rooms-for-rent/new-york',
    terms: ['/legal?tab=terms', '/legal?tab=tos', '/legal'],
    detail: /href="(\/(?:listing|room|rooms)\/[^"]+)"/i,
  },
  {
    id: 'leasebreak', origin: 'https://www.leasebreak.com', index: '/sublets',
    terms: ['/terms-of-service', '/terms-and-conditions', '/page/terms', '/terms-of-use', '/legal', '/site/terms'],
    detail: /href="((?:https:\/\/www\.leasebreak\.com)?\/(?:short-term-rental-details|sublet|lease-break|rental)[^"]*\/\d+[^"]*)"/i,
  },
  {
    id: 'junehomes', origin: 'https://junehomes.com', index: null, // discovered from homepage links
    terms: ['/terms-of-use'],
    detail: /href="(\/[^"]*(?:new-york|nyc|brooklyn|manhattan)[^"]*)"/i,
  },
];

async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    return { url, finalUrl: res.url, status: res.status, contentType: res.headers.get('content-type'), bytes: body.length, antiBot: antiBotSignals(res, body), body };
  } catch (err) {
    return { url, status: null, error: err.cause?.code || err.message, body: '' };
  }
}

async function checkImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-2047' }, signal: AbortSignal.timeout(15000) });
    await res.arrayBuffer();
    const type = res.headers.get('content-type') || '';
    return `${res.status}${(res.status === 200 || res.status === 206) && type.startsWith('image/') ? ' ok' : ' FAIL'} ${type}`;
  } catch (err) {
    return `ERR ${err.cause?.code || err.message}`;
  }
}

function jsonLd(html) {
  return [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
}

function listingImages(html) {
  return [...new Set([...html.matchAll(/(?:src|data-src|href|content)="(https:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)].map((m) => decode(m[1])))]
    .filter((u) => !/logo|icon|sprite|badge|banner|avatar|App_Store|google-play|og-default/i.test(u));
}

function priceContexts(html, n = 5) {
  const text = stripHtml(html);
  return [...text.matchAll(/.{0,70}\$\s?\d{1,2},?\d{3}.{0,70}/g)].slice(0, n).map((m) => m[0].trim());
}

const report = [];
for (const c of CANDIDATES.filter((x) => !only || only.includes(x.id))) {
  const out = { id: c.id };
  report.push(out);
  console.log(`\n=== ${c.id} ===`);

  // 1. Terms first.
  out.terms = [];
  for (const path of c.terms) {
    const r = await get(c.origin + path);
    const text = r.status === 200 ? stripHtml(r.body) : '';
    const excerpts = r.status === 200 ? termsExcerpts(r.body) : [];
    const isTerms = /terms|agreement|conditions/i.test(text.slice(0, 5000)) && text.length > 3000;
    out.terms.push({ path, status: r.status ?? r.error, finalUrl: r.finalUrl, antiBot: r.antiBot, chars: text.length, isTerms, excerpts });
    console.log(`  terms ${path}: HTTP ${r.status ?? r.error} ${r.antiBot?.length ? `[${r.antiBot.join(',')}]` : ''} chars=${text.length} looksLikeTerms=${isTerms} final=${r.finalUrl || ''}`);
    for (const e of excerpts) console.log(`      » ${e}`);
    await sleep(1200);
    if (isTerms) break;
  }
  const found = out.terms.find((t) => t.isTerms);
  const prohibiting = out.terms.flatMap((t) => t.excerpts.filter((e) => PROHIBITS.test(e)));
  out.termsFound = !!found;
  out.termsProhibit = prohibiting;
  if (prohibiting.length) {
    console.log(`  STOP: terms prohibit automated access -> ${prohibiting[0].slice(0, 220)}`);
    continue;
  }
  if (!found) console.log('  NOTE: terms page not located; inspecting index page only (no detail fetch)');

  // 2. Index page structure.
  const robots = await get(`${c.origin}/robots.txt`);
  const groups = robots.status === 200 ? parseRobots(robots.body) : [];
  let indexPath = c.index;
  if (!indexPath) {
    const home = await get(c.origin + '/');
    const m = [...(home.body || '').matchAll(/href="(\/[^"]*(?:new-york|nyc)[^"]*)"/gi)].map((x) => x[1]);
    console.log(`  homepage NYC links: ${[...new Set(m)].slice(0, 8).join(' ')}`);
    indexPath = m[0];
  }
  if (!indexPath) continue;
  const idx = await get(c.origin + indexPath);
  out.index = { path: indexPath, status: idx.status ?? idx.error, antiBot: idx.antiBot, bytes: idx.bytes };
  console.log(`  index ${indexPath}: HTTP ${idx.status ?? idx.error} ${idx.antiBot?.length ? `[${idx.antiBot.join(',')}]` : ''} ${idx.bytes}B`);
  if (idx.status !== 200) continue;
  const ld = jsonLd(idx.body);
  for (const block of ld) {
    const items = block.itemListElement || block.mainEntity?.itemListElement || [];
    if (items.length) {
      console.log(`  JSON-LD ${block['@type']} with ${items.length} items; first 2:`);
      for (const it of items.slice(0, 2)) console.log(`      ${JSON.stringify(it).slice(0, 900)}`);
    }
  }
  console.log(`  price contexts: ${JSON.stringify(priceContexts(idx.body))}`);
  const imgs = listingImages(idx.body);
  console.log(`  listing-like images on index: ${imgs.length}; sample: ${imgs.slice(0, 2).join(' ')}`);
  const details = [...new Set([...idx.body.matchAll(new RegExp(c.detail.source, 'gi'))].map((m) => decode(m[1])))];
  console.log(`  detail links found: ${details.length}; sample: ${details.slice(0, 4).join(' ')}`);

  // 3. One detail page, only when terms were located and don't prohibit.
  if (!found || !details.length) continue;
  const detailUrl = new URL(details[0], c.origin).href;
  const verdict = groups.length ? isAllowed(groups, new URL(detailUrl).pathname, USER_AGENT) : { allowed: true, rule: 'no robots' };
  if (!verdict.allowed) {
    console.log(`  detail ${detailUrl}: SKIPPED by robots.txt (${verdict.rule})`);
    continue;
  }
  await sleep(2000);
  const d = await get(detailUrl);
  const dImgs = listingImages(d.body || '');
  const dLd = jsonLd(d.body || '');
  out.detail = { url: detailUrl, status: d.status ?? d.error, images: dImgs.length, ldTypes: dLd.map((x) => x['@type']) };
  console.log(`  detail ${detailUrl}: HTTP ${d.status ?? d.error} ${d.antiBot?.length ? `[${d.antiBot.join(',')}]` : ''} images=${dImgs.length} jsonld=${JSON.stringify(dLd.map((x) => x['@type']))}`);
  for (const b of dLd) console.log(`      ${JSON.stringify(b).slice(0, 1200)}`);
  console.log(`  detail price contexts: ${JSON.stringify(priceContexts(d.body || '', 4))}`);
  const checks = [];
  for (const u of dImgs.slice(0, 3)) checks.push(await checkImage(u));
  console.log(`  detail images: ${dImgs.slice(0, 3).map((u, i) => `${u.slice(0, 90)} -> ${checks[i]}`).join('\n                 ')}`);
}

await writeFile('probe-inspect.json', JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
