// End-to-end test of the built app in a real (headless) browser.
//   node tests/e2e.mjs [--shots]      (needs: npm i -D playwright, or a global Playwright)
// Loads dist/clonescope.html, runs every example class, opens a comparison, checks that
// the planted copies are found, and fails on any console error.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright'); // local or global install (NODE_PATH)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'file://' + path.join(ROOT, 'dist', 'clonescope.html');
const SHOTS = process.argv.includes('--shots');
const shotDir = path.join(ROOT, 'docs', 'screenshots');
if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

async function open(opts = {}) {
  const page = await browser.newPage(opts);
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForSelector('#summary .stat', { timeout: 30000 });
  return page;
}

const page = await open({ viewport: { width: 1360, height: 900 } });
for (const lang of ['python', 'java', 'c']) {
  await page.click(`[data-sample="${lang}"]`);
  await page.waitForFunction((l) => document.querySelector(`[data-sample="${l}"]`)?.getAttribute('aria-pressed') === 'true' && !document.querySelector('#progress:not([hidden])'), lang);
  await page.waitForTimeout(300);
  const flagged = await page.$$eval('#view-pairs .pairs:first-child .pair', (els) => els.map((e) => ({
    names: e.querySelector('.names').textContent.replace(/\s+/g, ' ').trim(),
    truth: e.querySelector('.truth')?.textContent || '',
  })));
  const planted = flagged.filter((f) => f.truth.includes('planted copy') && !f.truth.includes('not'));
  const wrong = flagged.filter((f) => f.truth.includes('not a planted'));
  check(planted.length >= 3, `${lang}: ${planted.length} planted copy pairs flagged (${flagged.length} flagged, ${wrong.length} not planted)`);
  if (SHOTS && lang === 'python') await page.screenshot({ path: path.join(shotDir, 'pairs.png'), fullPage: false });
}
// compare view
await page.click('[data-sample="python"]');
await page.waitForTimeout(1200);
await page.click('#view-pairs .pair');
await page.waitForSelector('#compare:not([hidden]) mark[data-tile]');
const marks = await page.$$eval('#compare mark[data-tile]', (m) => m.length);
check(marks > 10, `compare view highlights ${marks} matched spans`);
const findings = await page.$$eval('#compare .findings li b', (b) => b.map((x) => x.textContent));
check(findings.length > 0, `findings: ${findings.join(' | ')}`);
if (SHOTS) await page.screenshot({ path: path.join(shotDir, 'compare.png') });
await page.click('#cmp-back');
for (const v of ['groups', 'matrix', 'all', 'about']) {
  await page.click(`[data-view="${v}"]`);
  await page.waitForTimeout(250);
  const visible = await page.$eval(`#view-${v}`, (e) => !e.hidden && e.innerHTML.length > 100);
  check(visible, `view "${v}" renders`);
  if (SHOTS && (v === 'groups' || v === 'about')) await page.screenshot({ path: path.join(shotDir, `${v}.png`) });
}
// upload a zip of a class
const zipPath = path.join(ROOT, 'tests', 'fixtures', 'class.zip');
await page.setInputFiles('#pick-files', zipPath);
await page.waitForFunction(() => document.querySelector('#dataset')?.textContent.includes('3 submissions'), null, { timeout: 15000 });
check(true, 'zip upload analysed (3 submissions)');
// mobile + dark
const mobile = await open({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `no horizontal page scroll on phone width (overflow ${overflow}px)`);
if (SHOTS) await mobile.screenshot({ path: path.join(shotDir, 'mobile-dark.png') });
await mobile.click('#view-pairs .pair');
await mobile.waitForSelector('#compare:not([hidden])');
const overflow2 = await mobile.evaluate(() => document.querySelector('#compare').scrollWidth - window.innerWidth);
check(overflow2 <= 0, `compare sheet fits phone width (overflow ${overflow2}px)`);
check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
