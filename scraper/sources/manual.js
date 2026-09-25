// Listings you paste in by hand (Facebook groups, group chats, Listings Project
// emails...). Stored in data/manual.json; `overrides` lets you correct any
// field the parser got wrong.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const MANUAL_PATH = new URL('../../data/manual.json', import.meta.url);

export function manualId(entry) {
  return `manual:${createHash('sha1').update(entry.url || entry.text || '').digest('hex').slice(0, 12)}`;
}

export function detectSource(url = '') {
  if (/facebook\.com|fb\.com|fb\.me/i.test(url)) return 'facebook';
  if (/reddit\.com|redd\.it/i.test(url)) return 'reddit';
  if (/craigslist\.org/i.test(url)) return 'craigslist';
  if (/listingsproject\.com/i.test(url)) return 'listings project';
  if (/spareroom\.com/i.test(url)) return 'spareroom';
  if (/streeteasy\.com/i.test(url)) return 'streeteasy';
  return 'other';
}

export async function readManual() {
  try {
    return JSON.parse(await readFile(MANUAL_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export function manualToRaw(entry) {
  const text = entry.text || '';
  const [firstLine, ...rest] = text.split('\n');
  const title = entry.title || firstLine.slice(0, 140);
  const source = entry.source || detectSource(entry.url);
  return {
    id: manualId(entry),
    source,
    sourceLabel: source === 'facebook' ? 'Facebook (added manually)' : `${source} (added manually)`,
    url: entry.url || null,
    title,
    body: entry.title ? text : rest.join('\n'),
    flair: '',
    author: entry.author || null,
    contactUrl: entry.contactUrl || entry.url || null,
    postedAt: entry.postedAt || entry.addedAt || new Date().toISOString(),
    overrides: entry.overrides || {},
    manual: true,
  };
}

export async function fetchManual() {
  return (await readManual()).map(manualToRaw);
}
