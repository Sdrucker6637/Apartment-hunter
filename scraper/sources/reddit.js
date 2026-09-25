// Reddit via the official Data API only. robots.txt disallows all unknown
// bots and the User Agreement prohibits scraping without written consent, so
// there is deliberately NO unauthenticated fallback. Requires an approved app
// (Responsible Builder Policy): REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.

import { parseListing } from '../parse.js';
import { extractText } from '../extract.js';
import { field } from '../schema.js';
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
  const text = `${d.title}\n${d.selftext || ''}`;
  const p = parseListing({ title: d.title, body: d.selftext || '', flair: d.link_flair_text || '', postedAt: new Date(d.created_utc * 1000).toISOString() });
  if (p.postType === 'seeking') return null;
  const author = d.author && d.author !== '[deleted]' ? d.author : null;
  const url = `https://www.reddit.com${d.permalink}`;
  const basis = (b) => (b ? 'explicit' : null);
  return {
    source: 'reddit',
    sourceId: d.id,
    sourceLabel: `r/${d.subreddit}`,
    originalUrl: url,
    title: d.title,
    description: d.selftext || '',
    postType: p.postType,
    price: p.price != null ? { monthly: p.price, max: p.priceMax, type: p.priceType, basis: p.priceBasis === 'likely' ? 'explicit' : p.priceBasis } : { monthly: null, type: p.priceType, basis: null },
    priceConfidence: p.priceBasis, // 'likely' kept separately so the UI can show "probably your share"
    totalRent: field(p.totalRent, 'explicit'),
    bedrooms: field(p.bedrooms, 'explicit'),
    bathrooms: field(p.bathrooms, 'explicit'),
    availableRooms: field(p.roomsAvailable, 'explicit'),
    roommates: field(p.roommatesSource === 'stated' ? p.roommates : null, 'explicit'),
    listingType: field(p.listingType, 'explicit'),
    ...(() => {
      const x = extractText({ title: d.title, text: d.selftext || '' });
      return {
        furnished: field(x.furnished, 'explicit'),
        utilitiesIncluded: field(x.utilitiesIncluded, 'explicit'),
        postedBy: field(x.postedBy, 'explicit'),
        ...(x.laundry === 'on_site' ? { laundry: field('on_site', 'explicit') } : {}),
      };
    })(),
    moveIn: field(p.moveIn, basis(p.moveIn)),
    neighborhood: field(p.neighborhood, basis(p.neighborhood)),
    borough: field(p.borough, p.borough ? (p.neighborhood ? 'inferred' : 'explicit') : null),
    laundry: field(p.laundry && p.laundry.replace('-', '_'), 'explicit'),
    contactUrl: author ? `https://www.reddit.com/message/compose/?to=${encodeURIComponent(author)}` : url,
    contactMethod: author ? `Reddit message to u/${author}` : 'Reply on Reddit',
    contactEmails: p.contacts.emails,
    contactPhones: p.contacts.phones,
    photos: redditPhotos(d),
    postedAt: new Date(d.created_utc * 1000).toISOString(),
    rawTextLength: text.length,
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
