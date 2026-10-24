#!/usr/bin/env node
// CloneScope from the command line (same engine as the web app).
//
//   node tools/cli.mjs <folder-or-zip> [--starter path] [--threshold 0.5] [--csv out.csv] [--all]
//
// Example:
//   node tools/cli.mjs samples/python/class
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeClass, groupFiles, explainPair, verdict, CodeEncoder, readZip, decodeText, detectLanguage } from '../engine/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const target = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--all'));
if (!target) {
  console.log('usage: node tools/cli.mjs <folder-or-zip> [--starter file] [--threshold 0.5] [--csv out.csv] [--all]');
  process.exit(1);
}

async function readInput(p) {
  if (fs.statSync(p).isDirectory()) {
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (detectLanguage(e.name)) out.push({ path: path.relative(p, full), text: fs.readFileSync(full, 'utf8').replace(/\r\n?/g, '\n') });
      }
    };
    walk(p);
    return out;
  }
  if (/\.zip$/i.test(p)) return (await readZip(fs.readFileSync(p))).map((e) => ({ path: e.path, text: decodeText(e.data).replace(/\r\n?/g, '\n') }));
  throw new Error('Give a folder or a .zip file');
}

let encoder = null;
const mj = path.join(ROOT, 'model/encoder.json'), mb = path.join(ROOT, 'model/encoder.bin');
if (fs.existsSync(mj) && fs.existsSync(mb)) {
  const raw = fs.readFileSync(mb);
  encoder = new CodeEncoder(JSON.parse(fs.readFileSync(mj, 'utf8')), new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
}
const fusionPath = path.join(ROOT, 'model/fusion.json');
const fusion = fs.existsSync(fusionPath) ? JSON.parse(fs.readFileSync(fusionPath, 'utf8')) : null;
const threshold = Number(opt('threshold', fusion?.threshold ?? 0.5));
const starter = opt('starter') ? [{ path: path.basename(opt('starter')), text: fs.readFileSync(opt('starter'), 'utf8') }] : null;

const subs = groupFiles(await readInput(target));
if (subs.length < 2) { console.error('Need at least two submissions.'); process.exit(1); }
const r = await analyzeClass(subs, { encoder, fusion, templateFiles: starter, threshold });
const show = argv.includes('--all') ? r.pairs : r.pairs.filter((p) => p.score >= threshold);
console.log(`${r.submissions.length} submissions, ${r.pairs.length} pairs, ${show.length} ${argv.includes('--all') ? 'shown' : `flagged (threshold ${Math.round(threshold * 100)})`}, ${r.groups.length} copy groups, ${r.timings.totalMs} ms${encoder ? '' : ' (no neural model)'}\n`);
for (const p of show) {
  const A = r.byId.get(p.a), B = r.byId.get(p.b);
  const e = explainPair(A, B, p);
  console.log(`${String(Math.round(p.score * 100)).padStart(3)}  ${A.name}  <->  ${B.name}   [${verdict(p.score, threshold).label}]`);
  for (const f of e.findings) console.log(`       - ${f.title}: ${f.text}`);
}
r.groups.forEach((g, i) => console.log(`\nGroup ${i + 1}: ${g.members.map((m) => r.byId.get(m).name).join(', ')}`));
const csv = opt('csv');
if (csv) {
  const rows = [['student_a', 'student_b', 'score', 'neural', 'fingerprint_containment', 'tiling_max'].join(',')];
  for (const p of r.pairs) rows.push([r.byId.get(p.a).name, r.byId.get(p.b).name, p.score.toFixed(4), p.neural.toFixed(4), p.wContainment.toFixed(4), p.gstMax.toFixed(4)].map((v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','));
  fs.writeFileSync(csv, rows.join('\n') + '\n');
  console.log(`\nwrote ${csv}`);
}
