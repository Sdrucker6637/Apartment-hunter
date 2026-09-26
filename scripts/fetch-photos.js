// Downloads the photos referenced by a published listings.json so the site
// can be reviewed offline with its REAL photos (design QA). Output:
//   <out>/photos/<hash>.<ext> and <out>/photos/manifest.json {url: file | null}
// Used only by the design-snapshot workflow, whose output is encrypted.
//
//   node scripts/fetch-photos.js <listings.json> <out-dir> [maxPerListing]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const [file, outDir, maxArg] = process.argv.slice(2);
const max = Number(maxArg) || 12;
const doc = JSON.parse(await readFile(file, 'utf8'));
const urls = [...new Set(doc.listings.flatMap((l) => (l.photos || []).slice(0, max).map((p) => p.url).filter(Boolean)))];
await mkdir(join(outDir, 'photos'), { recursive: true });
const manifest = {};
let ok = 0;
const queue = [...urls];
async function worker() {
  while (queue.length) {
    const url = queue.shift();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (design snapshot)' } });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) { manifest[url] = null; continue; }
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
      const name = `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.${ext}`;
      await writeFile(join(outDir, 'photos', name), Buffer.from(await res.arrayBuffer()));
      manifest[url] = name; ok++;
    } catch { manifest[url] = null; }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
await writeFile(join(outDir, 'photos', 'manifest.json'), JSON.stringify(manifest));
console.log(`photos: ${ok}/${urls.length} downloaded`);
