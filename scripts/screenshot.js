// Renders the site (BASE_URL, default http://localhost:3000/) with whatever
// data it serves and saves screenshots of every major screen at desktop,
// tablet and phone sizes to SHOTS_DIR (default ./shots), plus report.json
// (card/photo counts, console errors, basic accessibility checks).
// Used by the design-snapshot and verify workflows (output is encrypted there).
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000/';
const DIR = process.env.SHOTS_DIR || 'shots';
const launchOpts = { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), ...(process.env.SHOT_PROXY ? { proxy: { server: process.env.SHOT_PROXY, bypass: 'localhost,127.0.0.1' } } : {}) };
await mkdir(DIR, { recursive: true });
const browser = await chromium.launch(launchOpts);
const report = { base: BASE, errors: [], screens: {} };
const shot = async (page, name, opts = {}) => { await page.waitForTimeout(450); await page.screenshot({ path: join(DIR, `${name}.png`), ...opts }); };

async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: extra.dpr || 1, isMobile: !!extra.mobile, hasTouch: !!extra.mobile, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(`${viewport.width}: pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && report.errors.push(`${viewport.width}: console: ${m.text()}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card:not(.skeleton), #empty:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1200);
  return page;
}
const listingWith = (page, fn) => page.evaluate(fn);
const bestPhotoId = (page) => listingWith(page, () => [...document.querySelectorAll('#grid .card')].sort((a, b) => Number(b.querySelector('.ph')?.dataset.count || 0) - Number(a.querySelector('.ph')?.dataset.count || 0))[0]?.dataset.id);
const cautionId = (page) => listingWith(page, () => document.querySelector('#grid .card .price-note.caution')?.closest('.card')?.dataset.id);
const openListing = async (page, id) => { await page.evaluate((i) => { location.hash = `listing=${encodeURIComponent(i)}`; }, id); await page.waitForSelector('#detail-dialog[open]'); await page.waitForTimeout(900); };
const closeDialogs = (page) => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));

// ---------- desktop ----------
const desk = await open({ width: 1440, height: 900 });
report.cards = await desk.locator('#grid .card').count();
report.summary = (await desk.locator('#summary').textContent())?.trim();
report.headline = (await desk.locator('.headline').first().textContent())?.trim();
report.cardImages = await desk.evaluate(() => { const imgs = [...document.querySelectorAll('#grid .card .ph-slide img[src]')]; return { withSrc: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, noPhotoPlates: document.querySelectorAll('#grid .nophoto').length }; });
report.bySource = await desk.evaluate(() => { const o = {}; for (const c of document.querySelectorAll('#grid .card .src b')) { const k = c.textContent.replace(/ \+\d+$/, ''); o[k] = (o[k] || 0) + 1; } return o; });
report.a11y = await desk.evaluate(() => ({
  unnamedButtons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent && !(b.getAttribute('aria-label') || b.textContent.trim())).length,
  imgsWithoutAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
  h1: document.querySelectorAll('.view:not([hidden]) h1').length,
}));
await shot(desk, 'desktop-browse');
await desk.evaluate(() => window.scrollTo(0, 620));
await shot(desk, 'desktop-grid');
// carousel: advance a multi-photo card
const multi = desk.locator('#grid .card .ph[data-count]:not([data-count="1"])').first();
if (await multi.count()) {
  await multi.scrollIntoViewIfNeeded();
  await multi.hover();
  await multi.locator('.ph-nav.next').click();
  await desk.waitForTimeout(700);
  await multi.locator('xpath=ancestor::article').screenshot({ path: join(DIR, 'desktop-card-carousel.png') });
}
// keyboard focus on a card
await desk.evaluate(() => window.scrollTo(0, 0));
await desk.keyboard.press('Tab'); await desk.keyboard.press('Tab');
await desk.locator('#grid .card .card-link').first().focus();
await desk.locator('#grid .card').first().screenshot({ path: join(DIR, 'desktop-card-focus.png') });
// filters
await desk.click('#filters-btn');
await shot(desk, 'desktop-filters');
await desk.click('#f-boros button:first-child');
await desk.click('#toggles button[data-t="furnished"]');
await shot(desk, 'desktop-filters-set');
await closeDialogs(desk);
await desk.evaluate(() => window.scrollTo(0, 360));
await shot(desk, 'desktop-filtered');
report.filtered = (await desk.locator('#summary').textContent())?.trim();
await desk.click('#where-btn');
await shot(desk, 'desktop-neighborhoods');
await closeDialogs(desk);
await desk.click('.clear-all');
// no results
await desk.fill('#q', 'zzqx no such place');
await desk.waitForTimeout(500);
await shot(desk, 'desktop-no-results');
await desk.fill('#q', '');
await desk.waitForTimeout(400);
// detail
const best = await bestPhotoId(desk);
if (best) {
  await openListing(desk, best);
  await shot(desk, 'desktop-detail');
  await desk.evaluate(() => document.querySelector('#detail-content').scrollTo(0, 620));
  await shot(desk, 'desktop-detail-body');
  await desk.evaluate(() => document.querySelector('#detail-content').scrollTo(0, 0));
  await desk.click('.d-mosaic button[data-photo="0"]');
  await desk.waitForTimeout(700);
  await shot(desk, 'desktop-lightbox');
  await desk.keyboard.press('ArrowRight');
  await desk.waitForTimeout(500);
  await closeDialogs(desk);
}
const caution = await cautionId(desk);
if (caution) { await openListing(desk, caution); await shot(desk, 'desktop-detail-uncertain'); await closeDialogs(desk); }
const noPhotoId = await desk.evaluate(() => document.querySelector('#grid .nophoto')?.closest('.card')?.dataset.id);
if (noPhotoId) { await openListing(desk, noPhotoId); await shot(desk, 'desktop-detail-nophoto'); await closeDialogs(desk); }
await openListing(desk, 'facebook:does-not-exist');
await shot(desk, 'desktop-unavailable');
await closeDialogs(desk);
// shortlist + hidden, empty then populated
await desk.evaluate(() => { location.hash = '#/saved'; });
await shot(desk, 'desktop-shortlist-empty');
await desk.evaluate(() => { location.hash = '#/hidden'; });
await shot(desk, 'desktop-hidden-empty');
await desk.evaluate(() => { location.hash = '#/'; });
await desk.waitForTimeout(500);
for (let i = 0; i < 4; i++) await desk.locator('#grid .card .save-btn').nth(i * 2).click();
await desk.locator('#grid .card .hide-btn').nth(1).click();
await desk.waitForTimeout(400);
await desk.locator('#grid .card .hide-btn').nth(3).click();
await desk.waitForTimeout(500);
await shot(desk, 'desktop-toast');
await desk.evaluate(() => { location.hash = '#/saved'; });
await shot(desk, 'desktop-shortlist');
await desk.evaluate(() => { location.hash = '#/hidden'; });
await shot(desk, 'desktop-hidden');
await desk.evaluate(() => { location.hash = '#/about'; });
await shot(desk, 'desktop-about', { fullPage: true });
await desk.click('.tech > summary');
await desk.waitForTimeout(400);
await desk.locator('.tech').screenshot({ path: join(DIR, 'desktop-about-technical.png') });
report.screens.desktop = true;

// ---------- tablet ----------
const tab = await open({ width: 820, height: 1180 }, { dpr: 1 });
await shot(tab, 'tablet-browse');
if (best) { await openListing(tab, best); await shot(tab, 'tablet-detail'); await closeDialogs(tab); }
await tab.click('#filters-btn');
await shot(tab, 'tablet-filters');
report.screens.tablet = true;

// ---------- phone (iPhone 14/15 size) ----------
const mob = await open({ width: 390, height: 844 }, { dpr: 2, mobile: true });
await shot(mob, 'mobile-browse');
await mob.evaluate(() => window.scrollTo(0, 700));
await shot(mob, 'mobile-grid');
await mob.evaluate(() => window.scrollTo(0, 2600));
await shot(mob, 'mobile-grid-2');
report.mobileTargets = await mob.evaluate(() => [...document.querySelectorAll('button, a, input, select')].filter((el) => { const r = el.getBoundingClientRect(); return el.offsetParent && r.width && r.height && r.top >= 0 && r.bottom <= innerHeight && (r.height < 32 || r.width < 24); }).map((el) => `${el.tagName.toLowerCase()}.${el.className || ''}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`).slice(0, 20));
await mob.evaluate(() => window.scrollTo(0, 0));
await mob.click('#filters-btn');
await shot(mob, 'mobile-filters');
await mob.evaluate(() => document.querySelector('#filters-dialog .drawer-body').scrollTo(0, 700));
await shot(mob, 'mobile-filters-2');
await closeDialogs(mob);
if (best) {
  await openListing(mob, best);
  await shot(mob, 'mobile-detail');
  await mob.evaluate(() => document.querySelector('#detail-content').scrollTo(0, 560));
  await shot(mob, 'mobile-detail-body');
  await mob.evaluate(() => document.querySelector('#detail-content').scrollTo(0, 1300));
  await shot(mob, 'mobile-detail-desc');
  await mob.evaluate(() => document.querySelector('#detail-content').scrollTo(0, 0));
  await mob.click('#d-strip button[data-photo="0"]');
  await mob.waitForTimeout(600);
  await shot(mob, 'mobile-lightbox');
  await closeDialogs(mob);
}
if (caution) { await openListing(mob, caution); await shot(mob, 'mobile-detail-uncertain'); await closeDialogs(mob); }
await mob.evaluate(() => { location.hash = '#/saved'; });
await shot(mob, 'mobile-shortlist-empty');
await mob.evaluate(() => { location.hash = '#/about'; });
await shot(mob, 'mobile-about');
report.screens.mobile = true;

await writeFile(join(DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(`screenshots: cards=${report.cards} images=${JSON.stringify(report.cardImages)} sources=${JSON.stringify(report.bySource)} errors=${report.errors.length}`);
await browser.close();
