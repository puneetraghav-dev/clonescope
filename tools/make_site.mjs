// Assembles the static website (for GitHub Pages or any static host) into site/.
//   npm run site        (= build + this script)
// site/index.html   the app (same file as dist/clonescope.html)
// site/og.png       link-preview image (rendered by tools/screens.mjs)
// site/.nojekyll    tells GitHub Pages to serve the files as they are
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'dist', 'clonescope.html'), path.join(SITE, 'index.html'));
for (const f of ['og.png', 'icon.png']) {
  if (fs.existsSync(path.join(ROOT, 'dist', f))) fs.copyFileSync(path.join(ROOT, 'dist', f), path.join(SITE, f));
}
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
fs.writeFileSync(path.join(SITE, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log('site/ ready:', fs.readdirSync(SITE).join(', '));
