// Stage 2 feasibility probe: for sources that passed the rules stage, fetch
// ONE listing/search page per permitted path (robots.txt re-checked at run
// time), then report whether real listings and photos are retrievable.
// Sources whose terms prohibit automated access are listed in EXCLUDED and
// are never fetched.
//
//   ONLY=reddit node probe/listings.js

import { writeFile } from 'node:fs/promises';
import { SOURCES, USER_AGENT } from './sources.js';
import { parseRobots, isAllowed } from './robots.js';
import { antiBotSignals, termsExcerpts, PROHIBITS } from './antibot.js';

// From the stage-1 rules probe (run 36169035176). These are never fetched.
export const EXCLUDED = {
  reddit: 'robots.txt disallows all unknown bots; User Agreement: scraping without prior written consent prohibited (official API only)',
  craigslist: 'Terms: "not to copy/collect CL content via robots, spiders, scripts, scrapers, crawlers"',
  spareroom: 'Terms: may not "harvest information, with use of software or otherwise"',
  listingsproject: 'Terms: "Scraping and Republishing Prohibited"',
  facebook: 'robots.txt disallows all; Automated Data Collection Terms require Meta\'s express written permission',
  bungalow: 'Terms: may not "crawl" or "spider" any page, or "harvest or scrape any Content"',
  padmapper: 'Terms: may not "crawl", "scrape" or "spider" any page',
  zumper: 'Terms: may not "crawl", "scrape" or "spider" any page',
};

// Stage-1 couldn't find these sources' terms; discover them from the homepage
// and stop before touching listing pages if they prohibit automated access.
const NEEDS_TERMS = new Set(['roomi', 'streeteasy', 'diggz', 'roomies', 'outpostclub', 'common', 'sublet', 'leasebreak', 'renthop', 'hotpads']);

async function discoverTerms(origin) {
  const home = await get(origin + '/');
  if (home.status !== 200) return { status: home.status ?? home.error, antiBot: home.antiBot, links: [] };
  const links = [...new Set([...home.body.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((m) => /terms|legal|conditions|\btos\b/i.test(m[1] + ' ' + m[2].replace(/<[^>]+>/g, '')))
    .map((m) => new URL(decode(m[1]), origin).href))].slice(0, 3);
  const pages = [];
  for (const link of links) {
    const r = await get(link);
    const excerpts = r.status === 200 ? termsExcerpts(r.body) : [];
    pages.push({ url: link, status: r.status ?? r.error, antiBot: r.antiBot, excerpts, prohibits: excerpts.filter((e) => PROHIBITS.test(e)) });
    await sleep(1000);
  }
  return { status: 200, links, pages };
}

const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()).filter(Boolean) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept = 'text/html,application/json,application/rss+xml,*/*') {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    return { url, finalUrl: res.url, status: res.status, ms: Date.now() - started, contentType: res.headers.get('content-type'), bytes: body.length, antiBot: antiBotSignals(res, body), body };
  } catch (err) {
    return { url, status: null, error: `${err.name}: ${err.cause?.code || err.message}`, ms: Date.now() - started, body: '' };
  }
}

// Checks that a photo URL returns an image to an anonymous, referer-less request.
async function checkImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-2047' }, signal: AbortSignal.timeout(15000) });
    await res.arrayBuffer();
    const type = res.headers.get('content-type') || '';
    return { url, status: res.status, contentType: type, ok: (res.status === 200 || res.status === 206) && type.startsWith('image/') };
  } catch (err) {
    return { url, status: null, ok: false, error: err.cause?.code || err.message };
  }
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Generic structure discovery for HTML pages.
function inspectHtml(html, baseUrl) {
  const jsonLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => {
    try { return JSON.parse(m[1]); } catch { return null; }
  }).filter(Boolean);
  const ldTypes = [...new Set(jsonLd.flatMap((j) => [].concat(j['@graph'] || j).map((x) => x?.['@type']).flat()).filter(Boolean))];
  const imgs = [...new Set([...html.matchAll(/<img[^>]+(?:src|data-src)="([^"]+)"/gi)].map((m) => decode(m[1])))]
    .filter((u) => /^https?:|^\//.test(u) && !/sprite|logo|icon|avatar|pixel|\.svg/i.test(u))
    .map((u) => new URL(u, baseUrl).href);
  const ogImage = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(html)?.[1];
  return {
    title: /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim().slice(0, 140),
    jsonLdBlocks: jsonLd.length,
    jsonLdTypes: ldTypes.slice(0, 12),
    hasNextData: /id="__NEXT_DATA__"/.test(html),
    hasInitialState: /__INITIAL_STATE__|__APOLLO_STATE__|__NUXT__|window\.__data/.test(html),
    priceMentions: (html.match(/\$\s?\d{1,2},?\d{3}/g) || []).length,
    imageCount: imgs.length,
    sampleImages: imgs.slice(0, 5),
    ogImage: ogImage ? decode(ogImage) : null,
  };
}

// Reddit-specific: parse JSON listing or RSS feed.
function inspectReddit(r) {
  if (/json/.test(r.contentType || '')) {
    const json = JSON.parse(r.body);
    const posts = (json?.data?.children || []).map((c) => c.data);
    return {
      format: 'json',
      posts: posts.length,
      sample: posts.slice(0, 5).map((p) => ({ title: p.title.slice(0, 100), flair: p.link_flair_text, created: new Date(p.created_utc * 1000).toISOString() })),
      withImages: posts.filter((p) => p.preview?.images?.length || p.media_metadata || /i\.redd\.it/.test(p.url || '')).length,
      sampleImages: posts.flatMap((p) => [
        ...(p.preview?.images || []).map((i) => decode(i.source.url)),
        ...Object.values(p.media_metadata || {}).map((m) => m?.s?.u && decode(m.s.u)).filter(Boolean),
      ]).slice(0, 5),
    };
  }
  const entries = r.body.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return {
    format: 'rss/atom',
    posts: entries.length,
    sample: entries.slice(0, 5).map((e) => decode(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] || '').slice(0, 100)),
    sampleImages: entries.flatMap((e) => [...decode(e).matchAll(/https:\/\/(?:preview|i)\.redd\.it\/[^"'\s<&]+(?:\?[^"'\s<]*)?/g)].map((m) => decode(m[0]))).slice(0, 5),
  };
}

const results = [];
for (const src of SOURCES.filter((s) => !only || only.includes(s.id))) {
  const out = { id: src.id, name: src.name, pages: [] };
  results.push(out);
  console.log(`\n=== ${src.name} ===`);
  if (EXCLUDED[src.id]) {
    out.skipped = EXCLUDED[src.id];
    console.log(`  SKIPPED: ${EXCLUDED[src.id]}`);
    continue;
  }
  const robots = await get(`${src.origin}/robots.txt`, 'text/plain');
  const groups = robots.status === 200 ? parseRobots(robots.body) : [];
  if (NEEDS_TERMS.has(src.id)) {
    out.terms = await discoverTerms(src.origin);
    console.log(`  terms discovery: homepage HTTP ${out.terms.status}${out.terms.antiBot?.length ? ` [anti-bot: ${out.terms.antiBot.join(',')}]` : ''}; links: ${out.terms.links.join(' ') || 'none'}`);
    for (const p of out.terms.pages || []) {
      console.log(`    ${p.url}: HTTP ${p.status}; ${p.excerpts.length} excerpts, ${p.prohibits.length} prohibiting`);
      for (const e of p.excerpts) console.log(`      » ${e}`);
    }
    const prohibiting = (out.terms.pages || []).flatMap((p) => p.prohibits);
    if (prohibiting.length) {
      out.skipped = `terms prohibit automated access: ${prohibiting[0].slice(0, 200)}`;
      console.log(`  SKIPPED listing pages: ${out.skipped}`);
      continue;
    }
  }
  for (const path of src.paths) {
    const verdict = robots.status === 200 ? isAllowed(groups, path, USER_AGENT) : { allowed: true, rule: `no robots.txt (HTTP ${robots.status ?? robots.error})` };
    if (!verdict.allowed) {
      out.pages.push({ path, skipped: `robots.txt ${verdict.rule}` });
      console.log(`  ${path}: SKIPPED by robots.txt (${verdict.rule})`);
      continue;
    }
    const r = await get(src.origin + path);
    const page = { path, status: r.status ?? r.error, finalUrl: r.finalUrl, contentType: r.contentType, bytes: r.bytes, antiBot: r.antiBot, ms: r.ms };
    if (r.status === 200) {
      try {
        page.inspect = src.id === 'reddit' ? inspectReddit(r) : inspectHtml(r.body, r.finalUrl || src.origin + path);
      } catch (err) {
        page.inspectError = err.message;
      }
      const imgs = page.inspect?.sampleImages || [];
      page.imageChecks = [];
      for (const u of imgs.slice(0, 3)) page.imageChecks.push(await checkImage(u));
    }
    out.pages.push(page);
    console.log(`  ${path}: HTTP ${page.status} ${r.contentType || ''} ${r.bytes ?? ''}B ${r.antiBot?.length ? `[anti-bot: ${r.antiBot.join(',')}]` : ''}`);
    if (page.inspect) console.log(`    ${JSON.stringify(page.inspect).slice(0, 1500)}`);
    if (page.imageChecks?.length) console.log(`    images: ${page.imageChecks.map((c) => `${c.status}${c.ok ? ' ok' : ' FAIL'} ${c.contentType || c.error || ''}`).join(' | ')}`);
    await sleep(2000);
  }
}

await writeFile('probe-listings.json', JSON.stringify({ generatedAt: new Date().toISOString(), userAgent: USER_AGENT, results }, null, 2));
console.log('\nwrote probe-listings.json');
