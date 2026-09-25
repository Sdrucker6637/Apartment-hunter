// Reddit via the official Data API.
//
// Scraping investigation, 2026-09-25 (probe/investigate.js from GitHub Actions):
// - www.reddit.com/robots.txt and old.reddit.com/robots.txt: "User-agent: *
//   Disallow: /" with a pointer to Reddit's Public Content Policy.
// - User Agreement: no collecting data "by any means (automated or otherwise)
//   except as permitted in these Terms or in a separate agreement"; crawling
//   is permitted only per robots.txt, i.e. not at all for us.
// - Technically: subreddit pages, .json listings, search, the infinite-scroll
//   endpoint, old.reddit.com and post pages all returned HTTP 403 ("blocked by
//   network security"). Only the RSS feed answered (200, 3 entries).
// So the web pages are not a permitted collection path and there is no
// fallback to them. The permitted route for the same data is the Data API
// with a registered, approved app: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.

import { textPostListing } from './common.js';
import { USER_AGENT } from '../http.js';

export const meta = {
  id: 'reddit',
  name: 'Reddit',
  kind: 'Roommate posts from NYC subreddits',
  access: 'Official Data API with an approved app (OAuth client credentials). Scraping reddit.com is prohibited.',
  photos: 'Post images/galleries when attached (i.redd.it / preview.redd.it)',
};

export class AuthRequiredError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthRequiredError'; }
}

const decode = (s) => (s || '').replace(/&amp;/g, '&');

export function redditPhotos(d) {
  const out = [];
  if (d.media_metadata && d.gallery_data?.items) {
    for (const { media_id: id } of d.gallery_data.items) {
      const m = d.media_metadata[id];
      if (m?.status !== 'valid' || !m.s) continue;
      const full = decode(m.s.u || m.s.gif);
      const thumb = decode((m.p || []).find((p) => p.x >= 600)?.u || (m.p || []).at(-1)?.u || full);
      if (full) out.push({ url: full, thumb });
    }
  }
  if (!out.length && d.preview?.images?.length) {
    for (const img of d.preview.images) {
      const full = decode(img.source?.url);
      const thumb = decode((img.resolutions || []).find((r) => r.width >= 600)?.url || full);
      if (full) out.push({ url: full, thumb });
    }
  }
  if (!out.length && /^https:\/\/i\.redd\.it\/.+\.(jpe?g|png|webp)$/i.test(d.url || '')) out.push({ url: d.url });
  return out;
}

export function postToListing(d) {
  const author = d.author && d.author !== '[deleted]' ? d.author : null;
  const url = `https://www.reddit.com${d.permalink}`;
  const listing = textPostListing({
    title: d.title, body: d.selftext || '', flair: d.link_flair_text || '', postedAt: new Date(d.created_utc * 1000).toISOString(),
  });
  if (!listing) return null;
  return {
    ...listing,
    source: 'reddit',
    sourceId: d.id,
    sourceLabel: `r/${d.subreddit}`,
    originalUrl: url,
    contactUrl: author ? `https://www.reddit.com/message/compose/?to=${encodeURIComponent(author)}` : url,
    contactMethod: author ? `Reddit message to u/${author}` : 'Reply on Reddit',
    photos: redditPhotos(d),
  };
}

export async function fetchListings({ clientId, clientSecret, subreddits, pages = 2, log = () => {} }) {
  if (!clientId || !clientSecret) {
    throw new AuthRequiredError('REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set (approved Reddit Data API app required)');
  }
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (tokenRes.status === 401 || tokenRes.status === 403) throw new AuthRequiredError(`Reddit rejected the credentials (HTTP ${tokenRes.status})`);
  if (!tokenRes.ok) throw new Error(`Reddit OAuth HTTP ${tokenRes.status}`);
  const { access_token: token } = await tokenRes.json();

  const out = [];
  for (const sub of subreddits) {
    let after = null;
    for (let page = 0; page < pages; page++) {
      const res = await fetch(`https://oauth.reddit.com/r/${sub}/new?limit=100&raw_json=1${after ? `&after=${after}` : ''}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
      });
      if (res.status === 403) throw new AuthRequiredError(`Reddit API access denied for r/${sub} (HTTP 403) — app may not be approved`);
      if (!res.ok) throw new Error(`Reddit API HTTP ${res.status} for r/${sub}`);
      const json = await res.json();
      const posts = (json.data?.children || []).map((c) => c.data).filter((d) => !d.stickied && !d.over_18 && !d.removed_by_category);
      const listings = posts.map(postToListing).filter(Boolean);
      out.push(...listings);
      log(`reddit: r/${sub} page ${page + 1} -> ${posts.length} posts, ${listings.length} not seeking`);
      after = json.data?.after;
      if (!after) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return out;
}
