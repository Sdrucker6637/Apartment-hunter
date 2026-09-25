// Polite HTTP for source adapters: honest User-Agent, robots.txt enforced on
// every request, per-host rate limiting, and anti-bot detection so a block
// is reported as SOURCE_BLOCKED instead of being worked around.

import { parseRobots, isAllowed } from '../probe/robots.js';
import { antiBotSignals } from '../probe/antibot.js';

export const USER_AGENT = 'ApartmentHunterBot/0.2 (+https://github.com/sdrucker6637/apartment-hunter; personal NYC roommate search; low volume)';

const robotsCache = new Map();
const lastRequest = new Map();
const MIN_INTERVAL_MS = Number(process.env.MIN_REQUEST_INTERVAL_MS || 1500);

export class BlockedError extends Error {
  constructor(url, status, signals) {
    super(`blocked by ${signals.join('+') || 'server'} (HTTP ${status}) at ${url}`);
    this.name = 'BlockedError';
    this.status = status;
    this.signals = signals;
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url, rule) {
    super(`robots.txt disallows ${url} (${rule})`);
    this.name = 'RobotsDisallowedError';
  }
}

async function throttle(host) {
  const wait = (lastRequest.get(host) || 0) + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest.set(host, Date.now());
}

async function robotsFor(origin) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
        // RFC 9309: 4xx means no restrictions; 5xx / network failure means assume disallow.
        if (res.status >= 500) return { disallowAll: true };
        if (!res.ok) return { groups: [] };
        return { groups: parseRobots(await res.text()) };
      } catch {
        return { disallowAll: true };
      }
    })());
  }
  return robotsCache.get(origin);
}

// GET a page as text. Throws RobotsDisallowedError / BlockedError / Error.
export async function fetchText(url, { accept = 'text/html,application/json;q=0.9,*/*;q=0.8', headers = {} } = {}) {
  const u = new URL(url);
  const robots = await robotsFor(u.origin);
  if (robots.disallowAll) throw new RobotsDisallowedError(url, 'robots.txt unreachable (5xx) — treated as disallow');
  const verdict = isAllowed(robots.groups, u.pathname + u.search, USER_AGENT);
  if (!verdict.allowed) throw new RobotsDisallowedError(url, verdict.rule);

  await throttle(u.host);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const body = await res.text();
  const signals = antiBotSignals(res, body).filter((s) => s !== 'cloudflare'); // a CDN header alone isn't a block
  if (res.status === 403 || res.status === 429 || (res.status === 503 && signals.length)) throw new BlockedError(url, res.status, signals);
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
  return { body, finalUrl: res.url, status: res.status };
}

export function jsonLdBlocks(html) {
  return [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => {
      try { return JSON.parse(m[1]); } catch { return null; }
    })
    .filter(Boolean)
    .flatMap((b) => (Array.isArray(b) ? b : b['@graph'] ? b['@graph'] : [b]));
}

export const decodeEntities = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

export const pageText = (html) => decodeEntities(html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ');
