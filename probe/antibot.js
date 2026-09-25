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

const KEYWORDS = /scrap|crawl|spider|robot|automat|data[- ]?mining|harvest|\bbots?\b|extract/i;
// Clauses that forbid automated collection outright.
export const PROHIBITS = /scrap|crawl|spider|harvest|data[- ]?min|robots?,|automated (?:means|software|process|device|data collection)/i;

export const stripHtml = (html) => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/\s+/g, ' ');

export function termsExcerpts(html) {
  const text = stripHtml(html);
  const sentences = text.split(/(?<=[.;:])\s+/);
  const hits = [];
  for (const s of sentences) {
    if (KEYWORDS.test(s) && s.length > 30) hits.push(s.slice(0, 450));
    if (hits.length >= 8) break;
  }
  return hits;
}

