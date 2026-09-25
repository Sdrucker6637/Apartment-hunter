// Entry point: `npm run scrape`. Fetches every source, rebuilds
// public/data/listings.json. `--offline` skips the network and only
// re-processes stored + manual listings (used after adding one by hand).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { mergeRun } from './build.js';
import { fetchReddit } from './sources/reddit.js';
import { fetchCraigslist } from './sources/craigslist.js';
import { fetchManual } from './sources/manual.js';

export const OUTPUT_PATH = new URL('../public/data/listings.json', import.meta.url);

async function readPrevious() {
  try {
    const json = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    return json.listings || [];
  } catch {
    return [];
  }
}

export async function run({ offline = false, log = console.log } = {}) {
  const previous = await readPrevious();
  const manual = await fetchManual();
  const raws = [...manual];
  const sourceCounts = { manual: manual.length };
  if (!offline) {
    const [reddit, craigslist] = await Promise.all([
      fetchReddit(config.reddit, log),
      fetchCraigslist(config.craigslist, log),
    ]);
    raws.push(...reddit, ...craigslist);
    Object.assign(sourceCounts, { reddit: reddit.length, craigslist: craigslist.length });
  }
  // Manual entries that were deleted from data/manual.json should disappear too.
  const manualIds = new Set(manual.map((m) => m.id));
  const dropIds = new Set(previous.filter((l) => l.manual && !manualIds.has(l.id)).map((l) => l.id));

  const { listings, rejected } = mergeRun({ previous, raws, cfg: config, dropIds });
  listings.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  const out = {
    generatedAt: new Date().toISOString(),
    criteria: {
      maxShare: config.maxShare,
      minBedrooms: config.minBedrooms,
      maxBedrooms: config.maxBedrooms,
      maxAgeDays: config.maxAgeDays,
      subreddits: config.reddit.subreddits,
    },
    listings,
  };
  await mkdir(new URL('.', OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 1) + '\n');
  log(`fetched: ${JSON.stringify(sourceCounts)}; filtered out: ${JSON.stringify(rejected)}; kept ${listings.length} listings`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ offline: process.argv.includes('--offline') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
