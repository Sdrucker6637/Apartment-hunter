// Stage 1 feasibility probe: for every candidate source, fetch ONLY its
// robots.txt and terms-of-use pages. No listing pages are requested.
// Reports: reachability, anti-bot signals, robots.txt verdict per listing
// path, and terms excerpts mentioning scraping/automated access.
//
//   ONLY=reddit,craigslist node probe/rules.js

import { writeFile } from 'node:fs/promises';
import { SOURCES, USER_AGENT } from './sources.js';
import { parseRobots, isAllowed } from './robots.js';

const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()).filter(Boolean) : null;
const KEYWORDS = /scrap|crawl|spider|robot|automat|data[- ]?mining|harvest|\bbots?\b|extract/i;

// Signals that a response is an anti-bot challenge rather than content.
export function antiBotSignals(res, body) {
  const signals = [];
  const h = (k) => res.headers.get(k) || '';
  if (h('cf-ray')) signals.push('cloudflare');
  if (/just a moment|cf-chl|challenge-platform|cf_chl_opt/i.test(body)) signals.push('cloudflare-challenge');
  if (/px-captcha|perimeterx|_pxhd|human verification/i.test(body)) signals.push('perimeterx');
  if (/datadome|dd_cookie|geo\.captcha-delivery\.com/i.test(body) || h('x-datadome')) signals.push('datadome');
  if (/akamai|_abck|bm_sz/i.test(h('set-cookie')) || /akamai/i.test(h('server'))) signals.push('akamai');
  if (/incapsula|_incap_/i.test(body + h('set-cookie'))) signals.push('imperva');
  if (/captcha|are you a robot|verify you are human|unusual traffic/i.test(body)) signals.push('captcha-text');
  if (/blocked|access denied|forbidden/i.test(body.slice(0, 3000)) && res.status >= 400) signals.push('block-page');
  return [...new Set(signals)];
}

async function get(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.text();
    return {
      url, finalUrl: res.url, status: res.status, ms: Date.now() - started,
      server: res.headers.get('server'), contentType: res.headers.get('content-type'),
      bytes: body.length, antiBot: antiBotSignals(res, body), body,
    };
  } catch (err) {
    return { url, status: null, error: `${err.name}: ${err.cause?.code || err.message}`, ms: Date.now() - started, body: '' };
  }
}

const stripHtml = (html) => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/\s+/g, ' ');

function termsExcerpts(html) {
  const text = stripHtml(html);
  const sentences = text.split(/(?<=[.;:])\s+/);
  const hits = [];
  for (const s of sentences) {
    if (KEYWORDS.test(s) && s.length > 30) hits.push(s.slice(0, 450));
    if (hits.length >= 8) break;
  }
  return hits;
}

const strip = ({ body, ...rest }) => rest;

async function probeSource(src) {
  const robotsRes = await get(`${src.origin}/robots.txt`);
  const robotsOk = robotsRes.status === 200 && /text\/plain/i.test(robotsRes.contentType || '') && !robotsRes.antiBot.includes('cloudflare-challenge');
  const groups = robotsOk ? parseRobots(robotsRes.body) : [];
  const pathVerdicts = src.paths.map((p) => ({ path: p, ...(robotsOk ? isAllowed(groups, p, USER_AGENT) : { allowed: null, rule: `robots.txt unavailable (HTTP ${robotsRes.status ?? robotsRes.error})` }) }));
  const wildcardDisallowAll = robotsOk && isAllowed(groups, '/', 'SomeUnknownBot').allowed === false;

  const terms = [];
  for (const url of src.terms) {
    const r = await get(url);
    const excerpts = r.status === 200 ? termsExcerpts(r.body) : [];
    terms.push({ ...strip(r), excerpts });
    if (r.status === 200 && excerpts.length) break; // first terms page with relevant text is enough
    await new Promise((res) => setTimeout(res, 500));
  }

  return {
    id: src.id,
    name: src.name,
    robots: { ...strip(robotsRes), parsed: robotsOk, groups: groups.length, disallowsAllForUnknownBots: wildcardDisallowAll, head: robotsOk ? robotsRes.body.slice(0, 1500) : undefined },
    paths: pathVerdicts,
    terms,
  };
}

const results = [];
for (const src of SOURCES.filter((s) => !only || only.includes(s.id))) {
  const r = await probeSource(src);
  results.push(r);
  const pathSummary = r.paths.map((p) => `${p.path} → ${p.allowed === null ? '?' : p.allowed ? 'ALLOWED' : 'DISALLOWED'} (${p.rule})`).join('\n      ');
  console.log(`\n=== ${r.name} ===`);
  console.log(`  robots.txt: HTTP ${r.robots.status ?? r.robots.error} ${r.robots.antiBot?.length ? `[anti-bot: ${r.robots.antiBot.join(',')}]` : ''} disallow-all-for-unknown-bots=${r.robots.disallowsAllForUnknownBots}`);
  console.log(`  paths:\n      ${pathSummary}`);
  for (const t of r.terms) {
    console.log(`  terms ${t.url}: HTTP ${t.status ?? t.error} ${t.antiBot?.length ? `[anti-bot: ${t.antiBot.join(',')}]` : ''} ${t.excerpts.length} relevant excerpts`);
    for (const e of t.excerpts) console.log(`      » ${e}`);
  }
}

await writeFile('probe-rules.json', JSON.stringify({ generatedAt: new Date().toISOString(), userAgent: USER_AGENT, results }, null, 2));
console.log('\nwrote probe-rules.json');
