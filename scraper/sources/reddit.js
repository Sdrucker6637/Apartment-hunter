// Reads new posts from roommate/apartment subreddits via Reddit's JSON API.
// With REDDIT_CLIENT_ID/SECRET set it uses app-only OAuth (more reliable,
// especially from cloud IPs); otherwise it falls back to the public .json endpoints.

async function getToken({ clientId, clientSecret, userAgent }) {
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit OAuth failed: HTTP ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

export function redditPostToRaw(d, subreddit) {
  const author = d.author && d.author !== '[deleted]' ? d.author : null;
  const permalink = `https://www.reddit.com${d.permalink}`;
  return {
    id: `reddit:${d.id}`,
    source: 'reddit',
    sourceLabel: `r/${d.subreddit || subreddit}`,
    url: permalink,
    title: d.title || '',
    body: d.selftext || '',
    flair: d.link_flair_text || '',
    author,
    contactUrl: author ? `https://www.reddit.com/message/compose/?to=${encodeURIComponent(author)}&subject=${encodeURIComponent(`Re: ${d.title || 'your room listing'}`.slice(0, 100))}` : permalink,
    postedAt: new Date(d.created_utc * 1000).toISOString(),
    // Link posts sometimes point at the actual listing (StreetEasy, etc.).
    externalUrl: !d.is_self && d.url && !d.url.includes('reddit.com') && !d.url.includes('redd.it') ? d.url : null,
    thumbnail: d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') ?? null,
  };
}

export async function fetchReddit(cfg, log = console.log) {
  let token = null;
  if (cfg.clientId && cfg.clientSecret) {
    token = await getToken(cfg);
    log('reddit: using OAuth');
  }
  const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const headers = { 'User-Agent': cfg.userAgent, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const posts = [];
  for (const sub of cfg.subreddits) {
    let after = null;
    let count = 0;
    try {
      for (let page = 0; page < cfg.pages; page++) {
        const url = `${base}/r/${sub}/new${token ? '' : '.json'}?limit=100&raw_json=1${after ? `&after=${after}` : ''}`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const children = json?.data?.children ?? [];
        for (const { data } of children) {
          if (data.removed_by_category || data.stickied || data.over_18) continue;
          if (data.selftext === '[removed]' || data.selftext === '[deleted]') continue;
          posts.push(redditPostToRaw(data, sub));
          count++;
        }
        after = json?.data?.after;
        if (!after) break;
        await new Promise((r) => setTimeout(r, 1100)); // stay well under rate limits
      }
      log(`reddit: r/${sub} -> ${count} posts`);
    } catch (err) {
      log(`reddit: r/${sub} failed (${err.message})`);
    }
  }
  return posts;
}
