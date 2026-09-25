// Scraping investigation for specific sources (Reddit, Facebook, Roomi…).
//
// For each source it reads robots.txt and the terms, then makes ONE plain GET
// per page type (subreddit page, .json listing, RSS, group page, search page,
// a detail page discovered from those…) with the honest bot User-Agent, no
// cookies, no retries, >=2 s between requests to a host. It never logs in,
// solves a challenge, rotates IPs or spoofs a browser.
//
// What it records per page is STRUCTURE ONLY: status, redirect chain, login
// wall, anti-bot markers, embedded data formats, number of listing links,
// photos and pagination hints. The console log contains nothing else, so it
// is safe on a public repository. Raw responses are written to out/pages/ and
// are only ever published encrypted (see .github/workflows/investigate.yml).
//
//   ONLY=reddit,facebook,roomi node probe/investigate.js
import { mkdir, writeFile } from 'node:fs/promises';
import { parseRobots, isAllowed } from './robots.js';
import { antiBotSignals, PROHIBITS, stripHtml } from './antibot.js';
import { USER_AGENT } from '../scraper/http.js';

const SUBS = ['RoommatesNYC', 'NYCapartments', 'NYCSublets', 'nycrooms', 'NYCroommates', 'nychousing'];

export const TARGETS = {
  reddit: {
    name: 'Reddit',
    robots: ['https://www.reddit.com', 'https://old.reddit.com'],
    terms: [
      'https://redditinc.com/policies/user-agreement',
      'https://support.reddithelp.com/hc/en-us/articles/26410290525844-Public-Content-Policy',
      'https://redditinc.com/policies/data-api-terms',
    ],
    pages: [
      { kind: 'subreddit page (new site)', url: 'https://www.reddit.com/r/RoommatesNYC/new/' },
      { kind: 'subreddit page (old site)', url: 'https://old.reddit.com/r/RoommatesNYC/new/' },
      { kind: 'public .json listing', url: 'https://www.reddit.com/r/RoommatesNYC/new.json?limit=25' },
      { kind: 'public .json listing (old)', url: 'https://old.reddit.com/r/NYCapartments/new.json?limit=25' },
      { kind: 'RSS feed', url: 'https://www.reddit.com/r/RoommatesNYC/new/.rss' },
      { kind: 'search .json', url: 'https://www.reddit.com/r/NYCapartments/search.json?q=roommate&restrict_sr=1&sort=new' },
      { kind: 'infinite-scroll fragment', url: 'https://www.reddit.com/svc/shreddit/community-more-posts/new/?name=RoommatesNYC' },
      ...SUBS.map((s) => ({ kind: `subreddit exists? r/${s}`, url: `https://www.reddit.com/r/${s}/about.json` })),
      { kind: 'official API without token', url: 'https://oauth.reddit.com/r/RoommatesNYC/new?limit=5' },
    ],
    listingLink: /\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+\/[^"'?#\s<]*/g,
  },
  facebook: {
    name: 'Facebook',
    robots: ['https://www.facebook.com'],
    terms: ['https://www.facebook.com/apps/site_scraping_tos_terms.php', 'https://www.facebook.com/legal/terms'],
    pages: [
      ...['NYCRooms', 'spareroomnyc', 'new.york.housing.and.roommates', '1207463126375923', 'roommatesnyc', 'NewYorkRoommates', '1225966920763001']
        .map((g) => ({ kind: `public group /groups/${g}`, url: `https://www.facebook.com/groups/${g}/` })),
      { kind: 'mobile group page', url: 'https://m.facebook.com/groups/NYCRooms/' },
      { kind: 'basic-HTML group page', url: 'https://mbasic.facebook.com/groups/NYCRooms/' },
      { kind: 'Marketplace rentals NYC', url: 'https://www.facebook.com/marketplace/nyc/propertyrentals/' },
      { kind: 'Marketplace search NYC', url: 'https://www.facebook.com/marketplace/nyc/search/?query=room%20for%20rent' },
      { kind: 'Graph API group feed without token', url: 'https://graph.facebook.com/v21.0/NYCRooms/feed' },
    ],
    listingLink: /\/(?:groups\/[^/"']+\/(?:posts|permalink)\/\d+|marketplace\/item\/\d+)/g,
  },
  roomi: {
    name: 'Roomi',
    robots: ['https://roomiapp.com', 'https://roomi.com'],
    terms: ['https://roomiapp.com/terms', 'https://roomiapp.com/terms-of-use', 'https://roomiapp.com/terms-of-service'],
    pages: [
      { kind: 'rooms search NYC', url: 'https://roomiapp.com/rooms-for-rent/new-york-city' },
      { kind: 'rooms search New York', url: 'https://roomiapp.com/rooms-for-rent/new-york' },
      { kind: 'find roommates NYC', url: 'https://roomiapp.com/find-roommates/new-york' },
      { kind: 'rooms search Brooklyn', url: 'https://roomiapp.com/rooms-for-rent/brooklyn' },
      { kind: 'alternate domain', url: 'https://roomi.com/' },
    ],
    listingLink: /\/(?:rooms?|listings?|room-for-rent|rooms-for-rent\/[a-z-]+)\/[a-z0-9-]*\d{3,}[a-z0-9-]*/gi,
  },
};

const lastHit = new Map();
async function get(url, { manualRedirect = true } = {}) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + 2000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  const chain = [];
  let current = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(current, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
        redirect: manualRedirect ? 'manual' : 'follow',
        signal: AbortSignal.timeout(20000),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location'), current);
        chain.push(`${res.status} → ${next.host}${next.pathname}`);
        current = next.href;
        continue;
      }
      const body = await res.text();
      return { status: res.status, chain, finalUrl: current, contentType: res.headers.get('content-type') || '', bytes: body.length, antiBot: antiBotSignals(res, body), body };
    }
    return { status: 'too many redirects', chain, finalUrl: current, body: '' };
  } catch (err) {
    return { status: null, chain, error: `${err.name}: ${err.cause?.code || err.message}`, body: '' };
  }
}

// Structure-only description of a response. No listing text leaves here.
function describe(r, src) {
  const b = r.body || '';
  const d = {
    status: r.status, error: r.error, redirects: r.chain, contentType: r.contentType?.split(';')[0], bytes: r.bytes,
    antiBot: r.antiBot,
    loginWall: /\/login|login\.php|checkpoint|accounts\/login/i.test(r.chain.join(' ') + r.finalUrl)
      || /you must log in|log in to (?:continue|see)|log into facebook|sign in to (?:continue|view)|join (?:the )?group to see/i.test(b.slice(0, 200000)),
    jsonLdTypes: [...b.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
      .flatMap((m) => { try { const j = JSON.parse(m[1]); return [j].flat().flatMap((x) => [x['@type'], ...(x['@graph'] || []).map((g) => g['@type'])]); } catch { return ['(unparseable)']; } })
      .filter(Boolean).map(String).slice(0, 8),
    embedded: [
      /__NEXT_DATA__/.test(b) && 'next.js data',
      /__NUXT__/.test(b) && 'nuxt data',
      /window\.__(?:INITIAL|PRELOADED)_STATE__/.test(b) && 'initial-state json',
      /"require":\s*\[|ScheduledServerJS|RelayPrefetchedStreamCache/.test(b) && 'facebook relay payload',
      /<shreddit-post\b/.test(b) && 'shreddit-post elements',
      /<rss|<feed\b/.test(b.slice(0, 500)) && 'rss/atom',
    ].filter(Boolean),
    listingLinks: new Set(b.match(src.listingLink) || []).size,
    images: new Set(b.match(/https?:\/\/[^"'\s)]+\.(?:jpe?g|png|webp)(?:\?[^"'\s)]*)?/gi) || []).size,
    pagination: [
      /rel=["']next["']/.test(b) && 'rel=next',
      /[?&]after=|"after":\s*"t3_/.test(b) && 'after cursor',
      /[?&]page=\d/.test(b) && '?page=',
      /more-posts|load more|cursor/i.test(b) && 'load-more/cursor',
    ].filter(Boolean),
  };
  if (/json/.test(d.contentType || '')) {
    try {
      const j = JSON.parse(b);
      d.json = { keys: Object.keys(j).slice(0, 8), children: j?.data?.children?.length ?? null, error: j.error?.message || j.message || j.error || null };
      if (j?.data?.children) d.json.withImages = j.data.children.filter((c) => c.data?.preview?.images?.length || c.data?.is_gallery).length;
    } catch { d.json = { parse: 'failed' }; }
  }
  return d;
}

async function investigate(id, src) {
  const out = { id, name: src.name, checkedAt: new Date().toISOString(), robots: [], terms: [], pages: [] };
  const groupsByOrigin = {};
  for (const origin of src.robots) {
    const r = await get(`${origin}/robots.txt`, { manualRedirect: false });
    const ok = r.status === 200 && /text\/plain/.test(r.contentType || '');
    groupsByOrigin[new URL(origin).host] = ok ? parseRobots(r.body) : null;
    out.robots.push({ origin, status: r.status, error: r.error, parsed: ok, rootAllowed: ok ? isAllowed(groupsByOrigin[new URL(origin).host], '/', USER_AGENT) : null, excerpt: ok ? r.body.split('\n').filter((l) => /^\s*(user-agent|disallow|allow)\s*:\s*\*?\s*$|^\s*user-agent:\s*\*|^\s*disallow:\s*\/\s*$|^#.*(policy|permission|terms|crawl)/i.test(l)).slice(0, 8) : [] });
  }
  for (const url of src.terms) {
    const r = await get(url, { manualRedirect: false });
    const text = stripHtml(r.body || '');
    out.terms.push({ url, status: r.status, antiBot: r.antiBot, clauses: text.split(/(?<=[.;:])\s+/).filter((s) => PROHIBITS.test(s) && s.length > 30).slice(0, 6).map((s) => s.slice(0, 400)) });
  }
  const pages = [...src.pages];
  let n = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const u = new URL(p.url);
    const groups = groupsByOrigin[u.host];
    const robots = groups ? isAllowed(groups, u.pathname + u.search, USER_AGENT) : { allowed: null, rule: 'no robots.txt parsed for this host' };
    const r = await get(p.url);
    const d = describe(r, src);
    const file = `${id}-${String(++n).padStart(2, '0')}.txt`;
    await writeFile(`out/pages/${file}`, `${p.url}\n${JSON.stringify(r.chain)}\n\n${r.body || r.error || ''}`);
    out.pages.push({ kind: p.kind, url: p.url, robots, ...d, file });
    // Follow one discovered listing link to test a detail page.
    if (!p.detail && d.listingLinks && !pages.some((x) => x.detail)) {
      const link = (r.body.match(src.listingLink) || [])[0];
      if (link) pages.push({ kind: 'listing detail page (discovered)', url: new URL(link, r.finalUrl).href, detail: true });
    }
    // Reddit .json: the permalink of the first post.
    if (!pages.some((x) => x.detail) && /json/.test(d.contentType || '')) {
      try {
        const perm = JSON.parse(r.body)?.data?.children?.[0]?.data?.permalink;
        if (perm) pages.push({ kind: 'post .json (discovered)', url: `https://www.reddit.com${perm}.json`, detail: true });
      } catch { /* not json */ }
    }
  }
  return out;
}

function logSource(s) {
  console.log(`\n=== ${s.name} ===`);
  for (const r of s.robots) console.log(`robots ${r.origin}: HTTP ${r.status ?? r.error} root-allowed=${r.rootAllowed?.allowed ?? '?'} ${r.excerpt.join(' | ')}`);
  for (const t of s.terms) console.log(`terms ${t.url}: HTTP ${t.status} ${t.antiBot?.join(',') || ''} prohibiting-clauses=${t.clauses.length}${t.clauses[0] ? ` e.g. "${t.clauses[0].slice(0, 200)}"` : ''}`);
  for (const p of s.pages) {
    console.log(`- ${p.kind}: HTTP ${p.status ?? p.error}${p.redirects?.length ? ` via ${p.redirects.join(', ')}` : ''} ${p.contentType || ''} ${p.bytes ?? 0}B`
      + ` robots=${p.robots.allowed === null ? '?' : p.robots.allowed ? 'allowed' : 'DISALLOWED'}`
      + ` login=${p.loginWall} antibot=[${(p.antiBot || []).join(',')}] jsonld=[${p.jsonLdTypes.join(',')}] embedded=[${p.embedded.join(',')}]`
      + ` listingLinks=${p.listingLinks} images=${p.images} pagination=[${p.pagination.join(',')}]`
      + (p.json ? ` json=${JSON.stringify(p.json)}` : ''));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : Object.keys(TARGETS);
  await mkdir('out/pages', { recursive: true });
  const results = [];
  for (const id of only) {
    if (!TARGETS[id]) { console.log(`unknown source ${id}`); continue; }
    const s = await investigate(id, TARGETS[id]);
    logSource(s);
    results.push(s);
  }
  await writeFile('out/investigation.json', JSON.stringify(results, null, 2));
}
