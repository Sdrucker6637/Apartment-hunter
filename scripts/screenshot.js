// Renders the running site (http://localhost:3000) with whatever data it has
// and saves screenshots to ./shots, plus an in-browser photo-load report.
// Used by the scrape workflow's verify mode (output is encrypted there).
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://localhost:3000/';
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
await mkdir('shots', { recursive: true });
const browser = await chromium.launch(launchOpts);
const report = { errors: [] };

async function settle(page) {
  await page.waitForTimeout(2500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

// Desktop
const desk = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
desk.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
desk.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && report.errors.push(`console: ${m.text()}`));
await desk.goto(BASE, { waitUntil: 'networkidle' });
await settle(desk);
report.cards = await desk.locator('.card').count();
report.resultsText = await desk.locator('#summary').textContent();
report.freshness = await desk.locator('#freshness-text').textContent();
await desk.screenshot({ path: 'shots/desktop-grid.png' });
await desk.screenshot({ path: 'shots/desktop-full.png', fullPage: true });
report.cardImages = await desk.evaluate(() => {
  const imgs = [...document.querySelectorAll('.card img')];
  return { total: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, fallbacks: document.querySelectorAll('.card .no-photo').length };
});

// Carousel: advance the first multi-photo card
const multi = desk.locator('.card .media[data-count]:not([data-count="1"])').first();
if (await multi.count()) {
  await multi.locator('xpath=ancestor::article').hover();
  await multi.locator('.media-nav.next').click();
  await desk.waitForTimeout(1200);
  await multi.screenshot({ path: 'shots/carousel-2nd-photo.png' });
}

// Detail view of a listing with the most photos
const bestId = await desk.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')];
  cards.sort((a, b) => Number(b.querySelector('.media')?.dataset.count || 0) - Number(a.querySelector('.media')?.dataset.count || 0));
  return cards[0]?.dataset.id;
});
if (bestId) {
  await desk.locator(`.card[data-id="${bestId}"] .price`).click();
  await settle(desk);
  await desk.screenshot({ path: 'shots/detail.png' });
  const hero = desk.locator('#d-hero');
  if (await hero.count()) {
    await hero.click();
    await settle(desk);
    await desk.screenshot({ path: 'shots/lightbox.png' });
    await desk.keyboard.press('Escape');
  }
  await desk.keyboard.press('Escape');
}

// The core use case: set a search like a roommate-seeker would.
await desk.locator('#types button[data-value="ROOM_IN_SHARED_APARTMENT"]').click().catch(() => {});
await desk.locator('#boros button[data-value="Brooklyn"]').click().catch(() => {});
await desk.waitForTimeout(600);
report.roomsInBrooklyn = await desk.locator('#summary').textContent();
report.roomsInBrooklynCards = await desk.locator('.card').count();
await desk.screenshot({ path: 'shots/search-rooms-brooklyn.png' });
await desk.locator('#reset-btn').evaluate((b) => b.click());
await desk.waitForTimeout(300);

// Status panel
await desk.locator('#freshness').click();
await desk.waitForTimeout(500);
await desk.screenshot({ path: 'shots/status.png' });
await desk.keyboard.press('Escape');

// Mobile
const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mob.goto(BASE, { waitUntil: 'networkidle' });
await settle(mob);
await mob.screenshot({ path: 'shots/mobile-grid.png' });
if (bestId) {
  await mob.locator(`.card[data-id="${bestId}"] .price`).click();
  await settle(mob);
  await mob.screenshot({ path: 'shots/mobile-detail.png' });
}

await writeFile('shots/report.json', JSON.stringify(report, null, 2));
console.log(`screenshots: cards=${report.cards} cardImages=${JSON.stringify(report.cardImages)} errors=${report.errors.length}`);
await browser.close();
