// Local dev server: serves public/ and exposes two endpoints the site uses
// when running locally (they're absent on static hosting like GitHub Pages):
//   POST /api/manual  { url, text, overrides? }  add a pasted listing (e.g. Facebook)
//   POST /api/scrape                              re-fetch all sources now

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './scraper/index.js';
import { readManual, MANUAL_PATH, manualId } from './scraper/sources/manual.js';

const PORT = process.env.PORT || 3000;
const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
// DATA_DIR=sample serves SAMPLE data (from scripts/make-sample.js) instead of
// the real public/data — for UI development only. The page shows a SAMPLE banner.
const DATA_DIR = process.env.DATA_DIR ? fileURLToPath(new URL(`./${process.env.DATA_DIR.replace(/[^a-z0-9_-]/gi, '')}/`, import.meta.url)) : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 200_000) throw new Error('body too large');
  }
  return JSON.parse(data || '{}');
}

let scraping = null;

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && pathname === '/api/manual') {
      const { url = '', text = '', overrides = {} } = await readBody(req);
      if (!text.trim()) return send(res, 400, { error: 'Paste the post text.' });
      if (url && !/^https?:\/\//i.test(url)) return send(res, 400, { error: 'Link must start with http(s)://' });
      const entries = await readManual();
      const entry = { url: url.trim(), text: text.trim(), overrides, addedAt: new Date().toISOString() };
      const id = manualId(entry);
      const next = entries.filter((e) => manualId(e) !== id).concat(entry);
      entry.addedAt = entry.addedAt || new Date().toISOString();
      await mkdir(new URL('.', MANUAL_PATH), { recursive: true });
      await writeFile(MANUAL_PATH, JSON.stringify(next, null, 2) + '\n');
      await run({ offline: true, log: () => {} });
      return send(res, 200, { ok: true, id });
    }
    if (req.method === 'POST' && pathname === '/api/scrape') {
      const logs = [];
      scraping ??= run({ log: (m) => logs.push(m) }).finally(() => { scraping = null; });
      await scraping;
      return send(res, 200, { ok: true, logs });
    }
    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, local: true });
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });

    let base = ROOT;
    let rel = pathname === '/' ? '/index.html' : pathname;
    if (DATA_DIR && rel.startsWith('/data/')) base = DATA_DIR;
    if (DATA_DIR && rel.startsWith('/sample-photos/')) { base = DATA_DIR; rel = rel.replace('/sample-photos/', '/photos/'); }
    const file = join(base, normalize(decodeURIComponent(rel)));
    if (!file.startsWith(base)) return send(res, 403, 'forbidden', 'text/plain');
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] || 'application/octet-stream');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return send(res, 404, 'not found', 'text/plain');
    send(res, 500, { error: err.message });
  }
}).listen(PORT, () => console.log(`Apartment Hunter running at http://localhost:${PORT}`));
