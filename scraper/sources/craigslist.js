// Best-effort Craigslist reader using the search RSS feed. Craigslist changes
// and rate-limits this often; failures are logged and skipped, never fatal.

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');

const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decode(m[1]).trim() : '';
};

const stripHtml = (s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

export function parseCraigslistRss(xml, searchLabel = 'rooms') {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const url = tag(item, 'link') || (/rdf:about="([^"]+)"/.exec(item)?.[1] ?? '');
    const title = stripHtml(tag(item, 'title'));
    const idMatch = /\/(\d{8,})\.html/.exec(url);
    // Titles look like "$1,450 / 3br - Sunny room in Bushwick (Bushwick)"
    const hood = /\(([^()]+)\)\s*$/.exec(title)?.[1] ?? null;
    const price = /^\s*\$\s?([\d,]+)/.exec(title);
    const br = /\/\s*(\d)br\b/i.exec(title);
    const date = tag(item, 'dc:date') || tag(item, 'pubDate');
    return {
      id: `craigslist:${idMatch ? idMatch[1] : url}`,
      source: 'craigslist',
      sourceLabel: `Craigslist ${searchLabel}`,
      url,
      title: title.replace(/\s*\([^()]+\)\s*$/, ''),
      body: stripHtml(tag(item, 'description')),
      flair: '',
      author: null,
      contactUrl: url, // the reply button lives on the listing page
      postedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
      hints: {
        neighborhood: hood,
        price: price ? parseInt(price[1].replace(/,/g, ''), 10) : null,
        bedrooms: br ? +br[1] : undefined,
      },
    };
  }).filter((p) => p.url);
}

export async function fetchCraigslist(cfg, log = console.log) {
  if (!cfg.enabled) return [];
  const labels = { roo: 'rooms & shares', sub: 'sublets', apa: 'apartments' };
  const posts = [];
  for (const search of cfg.searches) {
    const url = `https://${cfg.site}.craigslist.org/search/${search}?format=rss`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (apartment-hunter personal search)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const parsed = parseCraigslistRss(xml, labels[search] || search);
      if (!parsed.length && !/<rss|<rdf/i.test(xml)) throw new Error('feed unavailable (no RSS returned)');
      posts.push(...parsed);
      log(`craigslist: ${search} -> ${parsed.length} posts`);
    } catch (err) {
      log(`craigslist: ${search} failed (${err.message})`);
    }
  }
  return posts;
}
