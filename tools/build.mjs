// Builds the web app into single self-contained HTML files (no server needed).
//
//   npm run build
//
// dist/clonescope.html  complete page: double-click to open it offline in any browser
// dist/artifact.html    the same page without the <html>/<head>/<body> skeleton (for hosting
//                       platforms that wrap the page themselves)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

const bundle = await esbuild.build({
  entryPoints: [path.join(ROOT, 'web/app.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: ['es2020'],
  legalComments: 'none', external: ['node:*'],
});
const script = bundle.outputFiles[0].text;

const data = { samples: JSON.parse(rd('samples/samples.json')), defaultSample: 'python' };
if (has('model/encoder.json') && has('model/encoder.bin')) {
  const meta = JSON.parse(rd('model/encoder.json'));
  data.model = {
    meta: { config: meta.config, tensors: meta.tensors, total_floats: meta.total_floats, vocab_hash: meta.vocab_hash, epoch: meta.epoch },
    weights: fs.readFileSync(path.join(ROOT, 'model/encoder.bin')).toString('base64'),
  };
}
if (has('model/fusion.json')) data.fusion = JSON.parse(rd('model/fusion.json'));
if (has('results/metrics.json')) data.metrics = JSON.parse(rd('results/metrics.json'));
if (has('model/training_summary.json')) data.training = JSON.parse(rd('model/training_summary.json'));
// project details shown on the page (edit web/site.json: names, guide, college, links)
const site = has('web/site.json') ? JSON.parse(rd('web/site.json')) : {};
data.site = site;

const json = JSON.stringify(data).replace(/</g, '\\u003c');
const page = rd('web/page.html');
const [, headAndRest] = page.split('<!--HEAD-->');
const [head, body] = headAndRest.split('<!--/HEAD-->');
const attr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fill = (s) => s.split('{{STYLE}}').join(rd('web/styles.css'))
  .split('{{AUTHOR}}').join(attr(site.author || 'CloneScope'))
  .split('{{SITE}}').join(attr(site.site || ''))
  .split('{{REPO}}').join(attr(site.repo || 'https://github.com'))
  .split('{{DATA}}').join(json)
  .split('{{SCRIPT}}').join(script.replace(/<\/script/gi, '<\\/script'));

const headF = fill(head).trim(), bodyF = fill(body).trim();
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${headF}\n</head>\n<body>\n${bodyF}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(ROOT, 'dist/clonescope.html'), full);
fs.writeFileSync(path.join(ROOT, 'dist/artifact.html'), `${headF}\n${bodyF}\n`);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/clonescope.html ${kb(full)} (script ${kb(script)}, data ${kb(json)}, model ${data.model ? 'included' : 'missing'})`);
