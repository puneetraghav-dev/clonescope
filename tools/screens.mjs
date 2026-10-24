// Renders the README screenshots and the link-preview image (og.png) with Playwright.
//   node tools/screens.mjs
// Needs Playwright. If the IBM Plex fonts from @fontsource are installed (npm install), they
// are served locally so the images match the live site even without internet.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

// --- local fonts: answer Google Fonts requests from node_modules/@fontsource
const FS = path.join(ROOT, 'node_modules', '@fontsource');
const faces = [
  ['IBM Plex Sans', 'ibm-plex-sans', [400, 500, 600]],
  ['IBM Plex Sans Condensed', 'ibm-plex-sans-condensed', [600, 700]],
  ['IBM Plex Mono', 'ibm-plex-mono', [400, 500, 600]],
];
const haveFonts = fs.existsSync(FS);
const css = faces.flatMap(([family, pkg, weights]) => weights.map((w) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(https://fonts.gstatic.com/local/${pkg}/${pkg}-latin-${w}-normal.woff2) format('woff2');}`)).join('\n');

async function newPage(browser, opts) {
  const page = await browser.newPage(opts);
  if (haveFonts) {
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: css }));
    await page.route('https://fonts.gstatic.com/local/**', (r) => {
      const [, pkg, file] = new URL(r.request().url()).pathname.match(/\/local\/([^/]+)\/(.+)$/);
      r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(path.join(FS, pkg, 'files', file)) });
    });
  }
  return page;
}

const browser = await chromium.launch();
const APP = 'file://' + path.join(ROOT, 'dist', 'clonescope.html');

// link preview image
const og = await newPage(browser, { viewport: { width: 1200, height: 630 } });
await og.goto('file://' + path.join(ROOT, 'tools', 'og.html'));
await og.waitForTimeout(500);
await og.screenshot({ path: path.join(ROOT, 'dist', 'og.png') });

// app icon (for Streamlit and bookmarks)
const icon = await browser.newPage({ viewport: { width: 128, height: 128 } });
await icon.setContent(`<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="128" height="128"><rect width="32" height="32" rx="7" fill="#0b6874"/><rect x="5" y="8" width="12" height="16" rx="2" fill="none" stroke="#fff" stroke-width="2"/><rect x="15" y="8" width="12" height="16" rx="2" fill="none" stroke="#ffd84d" stroke-width="2"/></svg></body>`);
await icon.screenshot({ path: path.join(ROOT, 'dist', 'icon.png'), omitBackground: true });

const page = await newPage(browser, { viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
await page.goto(APP);
await page.waitForSelector('#summary .stat');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, 'home.png') });
await page.evaluate(() => document.querySelector('#results').scrollIntoView());
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SHOTS, 'pairs.png') });
// the hardest copy in the Python example (level 6)
const rows = await page.$$('#view-pairs .pair');
for (const r of rows) {
  if ((await r.textContent()).includes('Ishita')) { await r.click(); break; }
}
await page.waitForSelector('#compare:not([hidden]) mark');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, 'compare.png') });
await page.click('#cmp-back');
await page.click('[data-view="groups"]');
await page.waitForTimeout(300);
await (await page.$('#view-groups')).screenshot({ path: path.join(SHOTS, 'groups.png') });
await page.click('.nav-links [data-goto="results"]');
await page.waitForTimeout(600);
await (await page.$('#accuracy')).screenshot({ path: path.join(SHOTS, 'results.png') });
const mobile = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await mobile.goto(APP);
await mobile.waitForSelector('#summary .stat');
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: path.join(SHOTS, 'mobile-dark.png') });
for (const old of ['about.png']) fs.rmSync(path.join(SHOTS, old), { force: true });
await browser.close();
console.log('screenshots in docs/screenshots, preview image dist/og.png', haveFonts ? '(IBM Plex fonts)' : '(fallback fonts)');
