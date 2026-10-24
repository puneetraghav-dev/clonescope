// CloneScope web app - all analysis runs locally in the browser.
import {
  analyzeClass, groupFiles, explainPair, verdict, findGroups, CodeEncoder, readZip, decodeText,
  tokenize, VOCAB, KIND, LANGUAGE_NAMES, detectLanguage,
} from '../engine/index.js';

const DATA = JSON.parse(document.getElementById('cs-data').textContent);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => Math.round((x || 0) * 100);
const fmt2 = (x) => (x || 0).toFixed(2);
const pairKey = (p) => `${p.a}|${p.b}`;

const REASON_LABEL = {
  rename: 'Renamed variables', reorder: 'Code moved around', loop: 'Loops rewritten', increment: 'Counters rewritten',
  condition: 'Conditions flipped', padding: 'Extra code added', literal: 'Messages changed', comments: 'Comments changed',
  format: 'Reformatted', weak: 'Small fragments only', 'shared-literal': 'Same unusual text',
};
const KEY_REASONS = new Set(['rename', 'reorder', 'loop', 'increment', 'condition', 'padding', 'literal', 'shared-literal']);

const state = {
  encoder: null,
  fusion: DATA.fusion,
  threshold: DATA.fusion?.threshold ?? 0.5,
  dataset: null,
  starter: null,
  result: null,
  view: 'pairs',
  sort: { key: 'score', dir: -1 },
  filter: '',
  downloads: undefined,
  inFrame: false,
  explain: new Map(),
  showKey: false,
};

// ------------------------------------------------------------------------------------ utils
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}

function sub(id) { return state.result.byId.get(id); }

function explanation(p) {
  const k = pairKey(p);
  if (!state.explain.has(k)) state.explain.set(k, explainPair(sub(p.a), sub(p.b), p));
  return state.explain.get(k);
}

function isTruth(p) {
  const truth = state.dataset?.truth;
  if (!truth) return null;
  const a = sub(p.a).name, b = sub(p.b).name;
  return truth.some((g) => g.includes(a) && g.includes(b));
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function mixColor(c1, c2, t) {
  const p = (c) => {
    const ctx = mixColor.ctx || (mixColor.ctx = document.createElement('canvas').getContext('2d'));
    ctx.fillStyle = '#000'; ctx.fillStyle = c;
    const v = ctx.fillStyle;
    if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    const m = v.match(/[\d.]+/g) || [0, 0, 0];
    return m.slice(0, 3).map(Number);
  };
  const a = p(c1), b = p(c2);
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})`;
}

// ---------------------------------------------------------------------------------- startup
function init() {
  try {
    if (DATA.model) state.encoder = CodeEncoder.fromBase64(DATA.model.meta, DATA.model.weights);
  } catch (e) {
    console.warn('Neural model unavailable, using classical signals only', e);
  }
  const s = $('#sens');
  s.value = Math.round(state.threshold * 100);
  $('#sens-out').textContent = s.value;
  s.addEventListener('input', () => {
    $('#sens-out').textContent = s.value;
    setThreshold(Number(s.value) / 100);
  });
  renderSampleChips();
  bindIntake();
  bindTabs();
  bindNav();
  renderProjectInfo();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#compare').hidden) closeCompare(); });
  detectDownloads();
  loadSample(DATA.defaultSample || Object.keys(DATA.samples)[0]);
}

async function detectDownloads() {
  if (window.claude && typeof window.claude.use === 'function') {
    state.inFrame = true;
    try { state.downloads = await window.claude.use('downloads'); } catch { state.downloads = null; }
  } else {
    state.downloads = null;
  }
  if (state.result) renderSummary();
}

function setThreshold(t) {
  state.threshold = t;
  if (!state.result) return;
  state.result.threshold = t;
  state.result.groups = findGroups(state.result.pairs, t);
  render();
}

// ------------------------------------------------------------------------- navigation, project
function goTo(where, smooth = true) {
  const behavior = smooth ? 'smooth' : 'auto';
  if (where === 'how' || where === 'results') {
    state.view = 'about';
    renderView();
    const target = where === 'results' ? $('#accuracy') : $('#tabs');
    if (target) target.scrollIntoView({ behavior, block: 'start' });
  } else {
    const target = $(`#${where}`);
    if (target) target.scrollIntoView({ behavior, block: 'start' });
  }
  try { history.replaceState(null, '', `#${where}`); } catch { /* not allowed in some frames */ }
}

function bindNav() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    goTo(a.dataset.goto);
  });
}

function renderProjectInfo() {
  const site = DATA.site || {};
  const T = DATA.training || {};
  const fused = DATA.metrics?.methods?.find((m) => m.key === 'fused');
  const fmtN = (x) => (x ?? 0).toLocaleString('en-US');
  if (fused?.stress_recall) {
    const li = $('#fact-stress');
    li.hidden = false;
    li.querySelector('b').textContent = `${Math.round(fused.stress_recall.S3 * 100)}%`;
  }
  $('#abstract').textContent = 'Students often hide copied programming assignments by renaming variables, reordering code, '
    + 'rewriting loops and padding files with code that does nothing. CloneScope detects such disguised copies by combining '
    + 'token normalization, winnowing fingerprints (the method behind MOSS), greedy string tiling (as in JPlag), a Siamese '
    + `convolutional neural network trained with self-supervised contrastive learning on ${fmtN(T.variants || 78584)} automatically `
    + 'disguised programs, and evidence from shared unusual text. It explains every flagged pair, groups students who share '
    + 'code, and runs entirely in the browser, so student code never leaves the teacher\'s computer.';
  const rows = [];
  const add = (k, v) => { if (v && String(v).trim()) rows.push([k, v]); };
  add('Developed by', [site.author, ...(site.team || [])].filter(Boolean).join(', '));
  add('Guide', site.guide);
  add('Department', site.department);
  add('Institution', site.institution);
  add('Programme', site.degree);
  add('Year', site.year);
  add('Model', T.parameters ? `Siamese dilated CNN, ${fmtN(T.parameters)} parameters, trained on ${fmtN(T.originals)} programs` : '');
  add('Evaluation', 'Held-out Rosetta Code tasks, stacked disguises, IR-Plag (Karnalim et al., 2019)');
  add('Built with', 'PyTorch · tree-sitter · scikit-learn · JavaScript (no server)');
  const dl = $('#project-facts');
  dl.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
    + (site.repo ? `<dt>Source</dt><dd><a href="${esc(site.repo)}" target="_blank" rel="noopener">${esc(site.repo.replace(/^https?:\/\//, ''))}</a></dd>` : '');
  $('#copyright').textContent = `© ${site.year || new Date().getFullYear()} ${site.author || 'CloneScope'} · CloneScope · MIT License`;
}

// ----------------------------------------------------------------------------------- intake
function renderSampleChips() {
  const box = $('#samples');
  box.innerHTML = Object.entries(DATA.samples).map(([key, s]) =>
    `<button class="chip" data-sample="${esc(key)}" aria-pressed="false">${esc(LANGUAGE_NAMES[s.language] || key)} · ${esc(s.title.split('·')[0].trim())}</button>`).join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sample]');
    if (b) loadSample(b.dataset.sample);
  });
}

function loadSample(key) {
  const s = DATA.samples[key];
  if (!s) return;
  state.dataset = {
    kind: 'sample', key, title: s.title, subtitle: s.course, submissions: s.submissions, truth: s.truth,
    starter: s.starter || null,
  };
  state.starter = null;
  state.showKey = false;
  updateStarterName();
  $$('#samples .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.sample === key)));
  runAnalysis();
}

function bindIntake() {
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async (e) => {
    try { useFiles(await filesFromDrop(e.dataTransfer), 'Dropped files'); } catch (err) { toast(err.message); }
  });
  $('#pick-files').addEventListener('change', async (e) => {
    try { useFiles(await filesFromList(e.target.files), 'Selected files'); } catch (err) { toast(err.message); }
    e.target.value = '';
  });
  $('#pick-folder').addEventListener('change', async (e) => {
    try { useFiles(await filesFromList(e.target.files), 'Selected folder'); } catch (err) { toast(err.message); }
    e.target.value = '';
  });
  $('#pick-starter').addEventListener('change', async (e) => {
    const files = (await filesFromList(e.target.files)).filter((f) => detectLanguage(f.path, f.text));
    e.target.value = '';
    if (!files.length) { toast('Starter code must be a .py, .java, .c or .cpp file.'); return; }
    state.starter = files;
    updateStarterName();
    runAnalysis();
  });
  $('#starter-clear').addEventListener('click', () => {
    state.starter = null;
    if (state.dataset) state.dataset.starter = null;
    updateStarterName();
    runAnalysis();
  });
}

function updateStarterName() {
  const files = state.starter || state.dataset?.starter;
  $('#starter-name').textContent = files ? files.map((f) => f.path.split('/').pop()).join(', ') + (state.starter ? '' : ' (from example)') : 'none';
  $('#starter-clear').hidden = !files;
}

async function readFileObj(f, path) {
  if (f.size > 4 * 1024 * 1024 && !/\.zip$/i.test(path)) return [];
  const buf = new Uint8Array(await f.arrayBuffer());
  if (/\.zip$/i.test(path)) {
    const entries = await readZip(buf);
    const base = path.replace(/\.zip$/i, '');
    return entries.map((e) => ({ path: entries.length ? `${base}/${e.path}` : e.path, text: decodeText(e.data).replace(/\r\n?/g, '\n') }));
  }
  if (!detectLanguage(path)) return [];
  return [{ path, text: decodeText(buf).replace(/\r\n?/g, '\n') }];
}

async function filesFromList(list) {
  const out = [];
  for (const f of list) out.push(...await readFileObj(f, f.webkitRelativePath || f.name));
  return out;
}

async function filesFromDrop(dt) {
  const items = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!items.length) return filesFromList(dt.files);
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push(...await readFileObj(file, prefix + entry.name));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const it of items) await walk(it, '');
  return out;
}

function useFiles(files, label) {
  const subs = groupFiles(files);
  if (subs.length < 2) {
    toast(subs.length ? 'Only one submission found. Add at least two students\' code.' : 'No Python, Java, C or C++ files found.');
    return;
  }
  const langs = [...new Set(subs.flatMap((s) => s.files.map((f) => LANGUAGE_NAMES[detectLanguage(f.path, f.text)])))];
  const roots = [...new Set(files.map((f) => f.path.split('/')[0]))];
  state.dataset = {
    kind: 'upload', title: roots.length === 1 && files.length > 1 ? roots[0].replace(/\.zip$/i, '') : 'Your class',
    subtitle: `${label} · ${langs.join(', ')}`, submissions: subs, truth: null, starter: null,
  };
  $$('#samples .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  updateStarterName();
  runAnalysis();
}

// --------------------------------------------------------------------------------- analysis
function showProgress(stage, done, total) {
  const p = $('#progress');
  p.hidden = false;
  $('#progress-text').textContent = `${stage}… ${total > 1 ? `${done} / ${total}` : ''}`;
  $('#progress-bar').style.width = `${total ? Math.round((100 * done) / total) : 0}%`;
}

async function runAnalysis() {
  const ds = state.dataset;
  if (!ds) return;
  showProgress('Reading and embedding code', 0, ds.submissions.length);
  const t0 = performance.now();
  try {
    const r = await analyzeClass(ds.submissions, {
      encoder: state.encoder, fusion: state.fusion, templateFiles: state.starter || ds.starter,
      threshold: state.threshold, onProgress: showProgress,
    });
    r.elapsed = performance.now() - t0;
    state.result = r;
    state.explain = new Map();
    if (!state.hashHandled) {
      state.hashHandled = true;
      const h = location.hash.slice(1);
      if (['how', 'results', 'project'].includes(h)) setTimeout(() => goTo(h, false), 50);
    }
  } catch (e) {
    console.error(e);
    toast(`Analysis failed: ${e.message}`);
  }
  $('#progress').hidden = true;
  render();
}

// ----------------------------------------------------------------------------------- render
function render() {
  if (!state.result) return;
  renderDataset();
  renderSummary();
  const flagged = state.result.pairs.filter((p) => p.score >= state.threshold);
  $('#count-pairs').textContent = flagged.length;
  $('#count-groups').textContent = state.result.groups.length;
  renderView();
}

function renderDataset() {
  const ds = state.dataset, r = state.result;
  const langs = [...new Set(r.submissions.map((s) => s.langName))].join(', ');
  const truth = ds.truth ? ds.truth.map((g) => g.join(' ⇄ ')).join(' · ') : '';
  $('#dataset').innerHTML = `
    <div class="what">
      <b>${ds.kind === 'sample' ? '<span class="example-badge">Example</span>' : ''}${esc(ds.title)}</b>
      <span class="tagline">${esc(ds.subtitle)} · ${r.submissions.length} submissions · ${esc(langs)}${r.hasTemplate ? ' · starter code ignored' : ''}${r.usedNeural ? '' : ' · neural model off'}</span>
      ${ds.truth && state.showKey ? `<span class="tagline"><b>Answer key:</b> copies were planted for ${esc(truth)}</span>` : ''}
    </div>
    ${ds.truth ? `<button class="btn ghost" id="toggle-key">${state.showKey ? 'Hide answer key' : 'Show answer key'}</button>` : ''}
    <button class="btn" id="rerun">Run again</button>`;
  $('#rerun').addEventListener('click', runAnalysis);
  const k = $('#toggle-key');
  if (k) k.addEventListener('click', () => { state.showKey = !state.showKey; render(); });
}

function renderSummary() {
  const r = state.result;
  if (!r) return;
  const flagged = r.pairs.filter((p) => p.score >= state.threshold).length;
  const canSave = state.downloads || !state.inFrame;
  $('#summary').innerHTML = `
    <div class="stat"><b>${r.submissions.length}</b><span>submissions</span></div>
    <div class="stat"><b>${r.pairs.length}</b><span>pairs compared</span></div>
    <div class="stat flagged"><b>${flagged}</b><span>pairs flagged</span></div>
    <div class="stat"><b>${r.groups.length}</b><span>copy groups</span></div>
    <div class="stat"><b>${(r.elapsed / 1000).toFixed(1)}s</b><span>in your browser</span></div>
    <div class="actions">
      ${canSave ? '<button class="btn" id="dl-csv">Download CSV</button><button class="btn" id="dl-report">Download report</button>'
    : '<button class="btn" id="copy-csv">Copy results as CSV</button>'}
    </div>`;
  if (canSave) {
    $('#dl-csv').addEventListener('click', () => saveFile(`clonescope-${slug()}.csv`, buildCSV(), 'text/csv'));
    $('#dl-report').addEventListener('click', () => saveFile(`clonescope-${slug()}-report.html`, buildReport(), 'text/html'));
  } else {
    $('#copy-csv').addEventListener('click', () => copyText(buildCSV(), 'CSV copied to the clipboard.'));
  }
}

function slug() { return (state.dataset?.title || 'class').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class'; }

function bindTabs() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    state.view = t.dataset.view;
    renderView();
  }));
}

function renderView() {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === state.view)));
  for (const v of ['pairs', 'groups', 'matrix', 'all', 'about']) $(`#view-${v}`).hidden = v !== state.view;
  const fn = { pairs: renderPairs, groups: renderGroups, matrix: renderMatrix, all: renderAll, about: renderAbout }[state.view];
  fn($(`#view-${state.view}`));
}

// ----------------------------------------------------------------------------- flagged pairs
function pairRow(p, muted = false) {
  const v = verdict(p.score, state.threshold);
  const e = explanation(p);
  const reasons = e.findings.filter((f) => f.type !== 'weak' || muted).map((f) => REASON_LABEL[f.type]).filter(Boolean);
  const truth = isTruth(p);
  const A = sub(p.a), B = sub(p.b);
  return `<button class="pair" data-pair="${esc(pairKey(p))}">
    <div class="score"><b class="${v.level}">${pct(p.score)}</b>
      <div class="meter" style="color:var(--${v.level === 'high' ? 'flag' : v.level === 'medium' ? 'warn' : 'calm'})"><i style="width:${pct(p.score)}%"></i><em style="left:${pct(state.threshold)}%"></em></div></div>
    <div class="who">
      <div class="names">${esc(A.name)} <span class="vs">⇄</span> ${esc(B.name)}</div>
      ${reasons.length ? `<div class="reasons">${reasons.map((r) => `<span class="reason">${esc(r)}</span>`).join('')}</div>` : ''}
      <div class="signals">
        ${p.hasNeural ? `<span>AI similarity <b>${fmt2(p.neural)}</b></span>` : ''}
        <span>Fingerprints <b>${pct(p.wContainment)}%</b></span>
        <span>Matched code <b>${pct(e.coverageA)}%</b> / <b>${pct(e.coverageB)}%</b></span>
      </div>
    </div>
    <div class="side"><span class="stamp ${v.level}">${esc(v.label)}</span>
      ${truth === null ? '' : truth ? '<span class="truth">✓ planted copy</span>' : '<span class="truth miss">not a planted copy</span>'}
    </div>
  </button>`;
}

function renderPairs(el) {
  const r = state.result;
  const flagged = r.pairs.filter((p) => p.score >= state.threshold);
  const next = r.pairs.filter((p) => p.score < state.threshold).slice(0, 4);
  const lines = r.submissions.map((x) => x.lines).sort((a, b) => a - b);
  const medianLines = lines[Math.floor(lines.length / 2)] || 0;
  const short = medianLines > 0 && medianLines < 30;
  el.innerHTML = `
    ${short ? `<div class="callout" style="margin-bottom:12px"><span>These programs are short (median ${medianLines} lines). Honest solutions of a short exercise often look almost the same, so structure alone is weak evidence here. Give more weight to <b>same unusual text</b> and to how a pair ranks against the rest of the class.</span></div>` : ''}
    ${flagged.length ? `<div class="pairs">${flagged.map((p) => pairRow(p)).join('')}</div>`
    : `<div class="empty">No pair reaches a suspicion score of ${pct(state.threshold)}. Lower the threshold to review weaker similarities.</div>`}
    ${next.length ? `<p class="eyebrow" style="margin:22px 0 10px">Most similar pairs below the threshold</p>
      <div class="pairs">${next.map((p) => pairRow(p, true)).join('')}</div>` : ''}`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-pair]');
    if (b) openCompare(b.dataset.pair);
  };
}

// ------------------------------------------------------------------------------ copy groups
function groupColors() {
  return ['--flag', '--accent', '--warn', '--kw', '--ok', '--num'].map(cssVar);
}

/** Groups are drawn as small rings, one per cluster; students with no flagged link sit in a row below. */
function clusterLayout(groups, others, W) {
  const pos = new Map();
  const cellW = 180, cellH = 168;
  const perRow = Math.max(1, Math.floor(W / cellW));
  const used = Math.min(groups.length, perRow);
  const offset = (W - used * cellW) / 2;
  groups.forEach((g, gi) => {
    const cx = offset + (gi % perRow) * cellW + cellW / 2;
    const cy = Math.floor(gi / perRow) * cellH + cellH / 2 + 4;
    const m = g.members.length;
    const R = m === 2 ? 46 : Math.min(72, 30 + m * 9);
    g.members.forEach((id, k) => {
      const a = (m === 2 ? 0 : -Math.PI / 2) + (2 * Math.PI * k) / m;
      pos.set(id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) * (m === 2 ? 1 : 0.86) });
    });
  });
  const top = groups.length ? Math.ceil(groups.length / perRow) * cellH + 26 : 34;
  const ow = 92, perRowO = Math.max(1, Math.floor((W - 24) / ow));
  others.forEach((n, k) => pos.set(n.id, { x: 12 + ow / 2 + (k % perRowO) * ow, y: top + 18 + Math.floor(k / perRowO) * 62 }));
  const H = top + (others.length ? 18 + Math.ceil(others.length / perRowO) * 62 : 0) + 4;
  return { pos, H, othersTop: top };
}

function renderGroups(el) {
  const r = state.result;
  const t = state.threshold;
  const nodes = r.submissions.filter((s) => s.kids.length);
  const strong = r.pairs.filter((p) => p.score >= t);
  const weak = r.pairs.filter((p) => p.score < t && p.score >= t * 0.6).slice(0, 40);
  const W = 720;
  const inGroup = new Set(r.groups.flatMap((g) => g.members));
  const others = nodes.filter((n) => !inGroup.has(n.id));
  const { pos: at, H, othersTop } = clusterLayout(r.groups, others, W);
  const colors = groupColors();
  const groupOf = new Map();
  r.groups.forEach((g, gi) => g.members.forEach((m) => groupOf.set(m, gi)));
  const line = (p, cls, stroke, w, dash = '') => {
    const A = at.get(p.a), B = at.get(p.b);
    return `<line class="edge ${cls}" data-pair="${esc(pairKey(p))}" x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" stroke="${stroke}" stroke-width="${w}" ${dash} stroke-linecap="round"><title>${esc(sub(p.a).name)} ⇄ ${esc(sub(p.b).name)}: ${pct(p.score)}</title></line>`;
  };
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Graph of students connected by suspicious similarity">
    ${others.length ? `<text x="12" y="${othersTop}" style="font-size:11px;fill:var(--ink-3)">${r.groups.length ? 'No flagged link' : 'No pair reaches the threshold'} (${others.length})</text>` : ''}
    ${weak.slice(0, 40).map((p) => line(p, 'weak', cssVar('--rule'), 1.5, 'stroke-dasharray="4 4"')).join('')}
    ${strong.map((p) => line(p, 'strong', p.score >= Math.max(0.85, t + 0.25) ? cssVar('--flag') : cssVar('--warn'), (2 + 5 * (p.score - t) / Math.max(0.05, 1 - t)).toFixed(1))).join('')}
    ${nodes.map((n) => {
    const P = at.get(n.id);
    const gi = groupOf.get(n.id);
    const fill = gi === undefined ? cssVar('--sheet-2') : colors[gi % colors.length];
    const stroke = gi === undefined ? cssVar('--ink-3') : cssVar('--sheet');
    const first = n.name.split(' ')[0];
    return `<g class="node"><circle cx="${P.x.toFixed(1)}" cy="${P.y.toFixed(1)}" r="${gi === undefined ? 7 : 10}" fill="${fill}" stroke="${stroke}" stroke-width="2"><title>${esc(n.name)}</title></circle>
      <text class="lbl" x="${P.x.toFixed(1)}" y="${(P.y + (gi === undefined ? 20 : 23)).toFixed(1)}" text-anchor="middle">${esc(first.length > 14 ? first.slice(0, 13) + '…' : first)}</text></g>`;
  }).join('')}
  </svg>`;
  const cards = r.groups.map((g, gi) => {
    const links = [...g.edges].sort((x, y) => y.score - x.score);
    return `<div class="group">
      <h3><span class="swatch" style="background:${colors[gi % colors.length]}"></span>Group ${gi + 1} · ${g.members.length} students</h3>
      <div class="members">${g.members.map((m) => `<span class="member">${esc(sub(m).name)}</span>`).join('')}</div>
      <div class="links">${links.map((p) => `<button data-pair="${esc(pairKey(p))}"><span>${esc(sub(p.a).name)} ⇄ ${esc(sub(p.b).name)}</span><span class="mono num">${pct(p.score)}</span></button>`).join('')}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="groups">
    <div class="graph">${svg}<div class="legend"><span><i style="background:var(--flag)"></i>very likely copied</span><span><i style="background:var(--warn)"></i>likely copied</span><span><i style="background:var(--rule)"></i>some similarity (below threshold)</span></div></div>
    <div class="group-list">${cards || '<div class="empty">No copy groups at this threshold.</div>'}
      <p class="note">A group is every student connected by flagged pairs. CloneScope cannot tell who copied from whom; it shows who shares code.</p></div>
  </div>`;
  el.onclick = (e) => {
    const b = e.target.closest('[data-pair]');
    if (b) openCompare(b.dataset.pair);
  };
}

// ------------------------------------------------------------------------------ heatmap
function renderMatrix(el) {
  const r = state.result;
  const subs = r.submissions.filter((s) => s.kids.length);
  const groupOf = new Map();
  r.groups.forEach((g, gi) => g.members.forEach((m) => groupOf.set(m, gi)));
  subs.sort((x, y) => (groupOf.get(x.id) ?? 999) - (groupOf.get(y.id) ?? 999) || x.family.localeCompare(y.family) || x.name.localeCompare(y.name));
  const n = subs.length;
  const pmap = new Map();
  for (const p of r.pairs) { pmap.set(`${p.a}|${p.b}`, p); pmap.set(`${p.b}|${p.a}`, p); }
  const avail = Math.max(280, Math.min(el.clientWidth || 900, 980) - 30);
  const labels = n <= 45;
  const left = labels ? 130 : 30, top = labels ? 110 : 30;
  const cell = Math.max(6, Math.min(36, Math.floor((avail - left) / n)));
  const W = left + cell * n + (labels ? 96 : 4), H = top + cell * n + 4;
  el.innerHTML = `<div class="matrix"><canvas id="heat" width="${W * 2}" height="${H * 2}" style="width:${W}px;height:${H}px" aria-label="Similarity matrix"></canvas><div class="tip" id="heat-tip" hidden></div>
    <div class="scale"><span>0</span><span class="ramp"></span><span>100 suspicion score</span><span style="margin-left:12px">Click a square to compare the two students.</span></div></div>`;
  const cv = $('#heat');
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  const c0 = cssVar('--heat-0'), c1 = cssVar('--heat-1'), ink = cssVar('--ink'), ink2 = cssVar('--ink-2'), rule = cssVar('--rule-2');
  ctx.font = '11px ' + cssVar('--font-body');
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = left + j * cell, y = top + i * cell;
      if (i === j) { ctx.fillStyle = rule; ctx.fillRect(x, y, cell - 1, cell - 1); continue; }
      const p = pmap.get(`${subs[i].id}|${subs[j].id}`);
      ctx.fillStyle = p ? mixColor(c0, c1, Math.pow(p.score, 1.3)) : rule;
      ctx.fillRect(x, y, cell - 1, cell - 1);
      if (p && p.score >= state.threshold && cell >= 10) {
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.strokeRect(x + 0.6, y + 0.6, cell - 2.2, cell - 2.2);
      }
    }
  }
  if (labels) {
    ctx.fillStyle = ink2;
    ctx.textBaseline = 'middle';
    subs.forEach((s, i) => {
      const nm = s.name.length > 18 ? s.name.slice(0, 17) + '…' : s.name;
      ctx.textAlign = 'right';
      ctx.fillText(nm, left - 8, top + i * cell + cell / 2);
      ctx.save();
      ctx.translate(left + i * cell + cell / 2, top - 8);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'left';
      ctx.fillText(nm, 0, 0);
      ctx.restore();
    });
  }
  const tip = $('#heat-tip');
  const cellAt = (e) => {
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const j = Math.floor((x - left) / cell), i = Math.floor((y - top) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n || i === j) return null;
    return { i, j, x, y, p: pmap.get(`${subs[i].id}|${subs[j].id}`) };
  };
  cv.onmousemove = (e) => {
    const c = cellAt(e);
    if (!c || !c.p) { tip.hidden = true; cv.style.cursor = 'default'; return; }
    cv.style.cursor = 'pointer';
    tip.hidden = false;
    tip.textContent = `${subs[c.i].name} ⇄ ${subs[c.j].name}: ${pct(c.p.score)}`;
    tip.style.left = `${Math.min(c.x + 26, W - 180)}px`;
    tip.style.top = `${c.y + 18}px`;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
  cv.onclick = (e) => { const c = cellAt(e); if (c && c.p) openCompare(pairKey(c.p)); };
}

// ---------------------------------------------------------------------------- all pairs
function renderAll(el) {
  const r = state.result;
  const cols = [
    ['a', 'Student A', (p) => sub(p.a).name], ['b', 'Student B', (p) => sub(p.b).name],
    ['lang', 'Language', (p) => sub(p.a).langName], ['score', 'Score', (p) => p.score, true],
    ['neural', 'AI similarity', (p) => p.neural, true], ['wContainment', 'Fingerprints', (p) => p.wContainment, true],
    ['gstMax', 'Matched code', (p) => p.gstMax, true],
  ];
  const q = state.filter.trim().toLowerCase();
  let rows = r.pairs.filter((p) => !q || sub(p.a).name.toLowerCase().includes(q) || sub(p.b).name.toLowerCase().includes(q));
  const col = cols.find((c) => c[0] === state.sort.key) || cols[3];
  rows = rows.slice().sort((x, y) => {
    const a = col[2](x), b = col[2](y);
    return (typeof a === 'string' ? a.localeCompare(b) : a - b) * state.sort.dir;
  });
  const LIMIT = 400;
  el.innerHTML = `<div class="table-tools"><input id="flt" type="search" placeholder="Filter by student name" value="${esc(state.filter)}" aria-label="Filter by student name">
    <span class="note">${rows.length} pairs${rows.length > LIMIT ? `, showing the first ${LIMIT}` : ''}</span></div>
    <div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th data-k="${c[0]}" class="${c[3] ? 'n' : ''}" aria-sort="${state.sort.key === c[0] ? (state.sort.dir < 0 ? 'descending' : 'ascending') : 'none'}">${c[1]}</th>`).join('')}<th>Verdict</th></tr></thead>
    <tbody>${rows.slice(0, LIMIT).map((p) => {
    const v = verdict(p.score, state.threshold);
    return `<tr data-pair="${esc(pairKey(p))}"><td>${esc(sub(p.a).name)}</td><td>${esc(sub(p.b).name)}</td><td>${esc(sub(p.a).langName)}</td>
      <td class="n"><b>${pct(p.score)}</b></td><td class="n">${p.hasNeural ? fmt2(p.neural) : '-'}</td><td class="n">${pct(p.wContainment)}%</td><td class="n">${pct(p.gstMax)}%</td>
      <td><span class="stamp ${v.level}">${esc(v.label)}</span></td></tr>`;
  }).join('')}</tbody></table></div>`;
  const f = $('#flt');
  f.addEventListener('input', () => {
    state.filter = f.value;
    const pos = f.selectionStart;
    renderAll(el);
    const nf = $('#flt'); nf.focus(); nf.setSelectionRange(pos, pos);
  });
  $$('th[data-k]', el).forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (['a', 'b', 'lang'].includes(k) ? 1 : -1) };
    renderAll(el);
  }));
  el.querySelector('tbody').onclick = (e) => { const tr = e.target.closest('[data-pair]'); if (tr) openCompare(tr.dataset.pair); };
}

// ------------------------------------------------------------------------------- compare
const CLS = ['', 'kw', 'str', 'num', 'com', 'kn'];

function codeHTML(S, spans) {
  let html = '';
  S.files.forEach((f, fi) => {
    if (S.files.length > 1) html += `<div class="file">${esc(f.path)}</div>`;
    const text = f.text, n = text.length;
    const tile = new Int32Array(n + 1).fill(-1);
    for (const sp of spans) if (sp.file === fi) tile.fill(sp.tile, sp.start, sp.end);
    const cls = new Uint8Array(n + 1);
    const tok = f.tok;
    for (let t = 0; t < tok.n; t++) {
      const k = tok.kinds[t];
      const c = k === KIND.FIXED && /^[A-Za-z_#]/.test(VOCAB[tok.ids[t]]) ? 1 : (k === KIND.STR || k === KIND.CHR) ? 2 : k === KIND.NUM ? 3 : k === KIND.KNOWN ? 5 : 0;
      if (c) cls.fill(c, tok.starts[t], tok.ends[t]);
    }
    for (const c of tok.comments) cls.fill(4, c.start, c.end);
    let line = 1, i = 0;
    for (;;) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      let inner = '', k = i;
      while (k < j) {
        const t0 = tile[k], c0 = cls[k];
        let m = k + 1;
        while (m < j && tile[m] === t0 && cls[m] === c0) m++;
        let piece = esc(text.slice(k, m));
        if (c0) piece = `<span class="k-${CLS[c0]}">${piece}</span>`;
        if (t0 >= 0) piece = `<mark class="t${t0 % 6}" data-tile="${t0}">${piece}</mark>`;
        inner += piece;
        k = m;
      }
      html += `<div class="ln" data-line="${line}"><span>${line}</span><code>${inner || ' '}</code></div>`;
      if (j >= n) break;
      line++;
      i = j + 1;
    }
  });
  return html;
}

function tileLines(spans) {
  const m = new Map();
  for (const s of spans) {
    const cur = m.get(s.tile) || { from: Infinity, to: -Infinity, file: s.file };
    cur.from = Math.min(cur.from, s.line);
    cur.to = Math.max(cur.to, s.endLine);
    m.set(s.tile, cur);
  }
  return m;
}

function sigRow(label, value, help, color = 'var(--accent)') {
  return `<div class="sig"><div>${esc(label)}<small>${esc(help)}</small></div><div class="track"><i style="width:${Math.max(0, Math.min(100, pct(value)))}%;background:${color}"></i></div><b>${pct(value)}</b></div>`;
}

function openCompare(key) {
  const p = state.result.pairs.find((x) => pairKey(x) === key);
  if (!p) return;
  const A = sub(p.a), B = sub(p.b);
  const e = explanation(p);
  const v = verdict(p.score, state.threshold);
  const la = tileLines(e.spansA), lb = tileLines(e.spansB);
  const blocks = e.tiles.filter((t) => la.has(t.id) && lb.has(t.id)).sort((x, y) => y.len - x.len);
  const fam = state.result.pairs.filter((x) => sub(x.a).family === A.family);
  const rank = fam.filter((x) => x.score > p.score).length + 1;
  const scores = fam.map((x) => x.score).sort((x, y) => x - y);
  const typical = scores[Math.floor(scores.length / 2)] || 0;
  const ctx = `Rank ${rank} of ${fam.length} pairs in this class; a typical pair scores ${pct(typical)}.`;
  const findings = e.findings.map((f) => `<li class="${KEY_REASONS.has(f.type) ? 'key' : ''}"><b>${esc(f.title)}</b><span>${esc(f.text)}</span>
      ${f.examples && f.type === 'rename' ? `<div class="renames">${f.examples.map(([a, b]) => `<code>${esc(a)} → ${esc(b)}</code>`).join('')}</div>` : ''}
      ${f.examples && f.type === 'literal' ? `<div class="renames">${f.examples.map(([a, b]) => `<code>${esc(a)} → ${esc(b)}</code>`).join('')}</div>` : ''}
      ${f.examples && f.type === 'shared-literal' ? `<div class="renames">${f.examples.map(([a]) => `<code>${esc(a)}</code>`).join('')}</div>` : ''}</li>`).join('');
  const truth = isTruth(p);
  const c = $('#compare');
  c.innerHTML = `<div class="wrap">
    <div class="cmp-head">
      <button class="btn" id="cmp-back" aria-label="Back to results">← Back</button>
      <h2 id="cmp-title">${esc(A.name)} <span class="vs">⇄</span> ${esc(B.name)}</h2>
      <span class="stamp big ${v.level}">${esc(v.label)} · ${pct(p.score)}</span>
      ${state.downloads || !state.inFrame ? '<button class="btn" id="cmp-dl">Download this comparison</button>' : ''}
    </div>
    ${truth === null ? '' : `<p class="note">${truth ? '✓ In the example answer key, these two submissions share a source.' : 'In the example answer key, these two students wrote their own code.'}</p>`}
    <div class="cmp-grid">
      <div class="panel">
        <h3>Evidence</h3>
        ${sigRow('Suspicion score', p.score, 'All signals combined', v.level === 'high' ? 'var(--flag)' : v.level === 'medium' ? 'var(--warn)' : 'var(--calm)')}
        ${p.hasNeural ? sigRow('AI similarity', Math.max(0, p.neural), 'Neural model: same logic despite rewrites') : ''}
        ${sigRow('Fingerprint overlap', p.wContainment, 'Shared code fingerprints (MOSS method)')}
        ${sigRow('Shared unusual text', Math.min(1, p.litShare * 1.5), 'Same messages or constants, rare in this class')}
        ${sigRow(`Matched code in ${A.name}`, e.coverageA, 'Share covered by matching blocks')}
        ${sigRow(`Matched code in ${B.name}`, e.coverageB, 'Share covered by matching blocks')}
        <p class="note">${esc(ctx)} Longest identical run: ${e.longest} tokens (about ${e.longestLines} line${e.longestLines === 1 ? '' : 's'}).</p>
      </div>
      <div class="panel">
        <h3>Why it was flagged</h3>
        <ul class="findings">${findings || '<li><b>No specific disguise detected</b><span>The programs share code directly.</span></li>'}</ul>
      </div>
    </div>
    ${blocks.length ? `<div class="panel"><h3>Matching blocks <span class="note">(longest first; click to jump)</span></h3><div class="blocks">${blocks.slice(0, 40).map((t) => {
    const a = la.get(t.id), b = lb.get(t.id);
    return `<button class="block-btn" data-tile="${t.id}"><i class="sw${t.id % 6}"></i>${esc(A.name.split(' ')[0])} ${a.from}–${a.to} · ${esc(B.name.split(' ')[0])} ${b.from}–${b.to}</button>`;
  }).join('')}</div></div>` : ''}
    <div class="pane-switch"><button class="btn" data-show="a">${esc(A.name)}</button><button class="btn" data-show="b">${esc(B.name)}</button></div>
    <div class="panes show-a">
      <div class="pane a"><div class="pane-head"><b>${esc(A.name)}</b><span>${esc(A.files.map((f) => f.path).join(', '))} · ${A.lines} lines</span></div><div class="code" id="code-a">${codeHTML(A, e.spansA)}</div></div>
      <div class="pane b"><div class="pane-head"><b>${esc(B.name)}</b><span>${esc(B.files.map((f) => f.path).join(', '))} · ${B.lines} lines</span></div><div class="code" id="code-b">${codeHTML(B, e.spansB)}</div></div>
    </div>
  </div>`;
  c.hidden = false;
  c.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  $('#cmp-back').addEventListener('click', closeCompare);
  $('#cmp-back').focus();
  const dl = $('#cmp-dl');
  if (dl) dl.addEventListener('click', () => saveFile(`clonescope-${slug()}-${A.name}-vs-${B.name}.html`.replace(/\s+/g, '-'), buildReport([p]), 'text/html'));
  const highlight = (id, on) => $$(`#compare mark[data-tile="${id}"]`).forEach((m) => m.classList.toggle('active', on));
  c.onmouseover = (ev) => { const m = ev.target.closest('mark[data-tile]'); if (m) highlight(m.dataset.tile, true); };
  c.onmouseout = (ev) => { const m = ev.target.closest('mark[data-tile]'); if (m) highlight(m.dataset.tile, false); };
  c.onclick = (ev) => {
    const b = ev.target.closest('[data-tile]');
    if (b && (b.classList.contains('block-btn') || b.tagName === 'MARK')) {
      const id = b.dataset.tile;
      for (const pane of ['#code-a', '#code-b']) {
        const m = $(`${pane} mark[data-tile="${id}"]`);
        if (m) {
          const box = $(pane);
          box.scrollTop = Math.max(0, m.closest('.ln').offsetTop - box.clientHeight / 3);
        }
      }
      $$('#compare mark.active').forEach((m) => m.classList.remove('active'));
      highlight(id, true);
      if (b.classList.contains('block-btn')) {
        const panes = $('.panes', c);
        if (panes.getBoundingClientRect().top > window.innerHeight * 0.6) panes.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
    const sw = ev.target.closest('[data-show]');
    if (sw) {
      const panes = $('.panes', c);
      panes.classList.toggle('show-a', sw.dataset.show === 'a');
      panes.classList.toggle('show-b', sw.dataset.show === 'b');
    }
  };
}

function closeCompare() {
  $('#compare').hidden = true;
  $('#compare').innerHTML = '';
  document.body.style.overflow = '';
}

// ------------------------------------------------------------------------------- exports
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCSV() {
  const r = state.result;
  const head = ['student_a', 'student_b', 'language', 'suspicion_score', 'verdict', 'ai_similarity', 'fingerprint_overlap',
    'matched_a_percent', 'matched_b_percent', 'reasons'];
  const lines = [head.join(',')];
  for (const p of r.pairs) {
    // full explanations only where they matter (keeps big classes fast)
    const e = p.score >= state.threshold * 0.5 ? explanation(p) : null;
    const A = sub(p.a), B = sub(p.b);
    const v = verdict(p.score, state.threshold);
    lines.push([A.name, B.name, A.langName, pct(p.score), v.label, p.hasNeural ? p.neural.toFixed(3) : '',
      pct(p.wContainment), pct(e ? e.coverageA : p.matched / Math.max(1, A.kids.length)),
      pct(e ? e.coverageB : p.matched / Math.max(1, B.kids.length)),
      e ? e.findings.filter((f) => f.type !== 'weak').map((f) => REASON_LABEL[f.type]).join('; ') : ''].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

function excerpt(S, spans, tileId, maxLines = 18) {
  const sp = spans.filter((s) => s.tile === tileId);
  if (!sp.length) return '';
  const file = S.files[sp[0].file];
  const lines = file.text.split('\n');
  const from = Math.min(...sp.map((s) => s.line)), to = Math.min(Math.max(...sp.map((s) => s.endLine)), from + maxLines - 1);
  return lines.slice(from - 1, to).map((l, i) => `<span class="l">${String(from + i).padStart(3)}</span> ${esc(l)}`).join('\n')
    + (Math.max(...sp.map((s) => s.endLine)) > to ? '\n    …' : '');
}

function buildReport(only = null) {
  const r = state.result, ds = state.dataset;
  const pairs = only || r.pairs.filter((p) => p.score >= state.threshold);
  const date = new Date().toLocaleString();
  const rows = pairs.map((p) => {
    const A = sub(p.a), B = sub(p.b), e = explanation(p), v = verdict(p.score, state.threshold);
    const blocks = [...e.tiles].sort((x, y) => y.len - x.len).slice(0, 3);
    return `<section class="pair"><h2>${esc(A.name)} ⇄ ${esc(B.name)} <span class="v ${v.level}">${esc(v.label)} · ${pct(p.score)}</span></h2>
      <p class="sig">${p.hasNeural ? `AI similarity ${fmt2(p.neural)} · ` : ''}Fingerprint overlap ${pct(p.wContainment)}% · Matched code ${pct(e.coverageA)}% of ${esc(A.name)}, ${pct(e.coverageB)}% of ${esc(B.name)}</p>
      <ul>${e.findings.map((f) => `<li><b>${esc(f.title)}.</b> ${esc(f.text)}${f.type === 'rename' && f.examples ? ` <span class="ex">(${f.examples.map(([a, b]) => `${esc(a)} → ${esc(b)}`).join(', ')})</span>` : ''}</li>`).join('')}</ul>
      ${blocks.map((t) => `<div class="blk"><pre>${excerpt(A, e.spansA, t.id)}</pre><pre>${excerpt(B, e.spansB, t.id)}</pre></div>`).join('')}
    </section>`;
  }).join('');
  const groups = r.groups.map((g, i) => `<li><b>Group ${i + 1}:</b> ${g.members.map((m) => esc(sub(m).name)).join(', ')}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CloneScope report · ${esc(ds.title)}</title>
<style>
body{font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#13212b;background:#fff;max-width:1100px;margin:0 auto;padding:28px 20px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:0 0 6px}.meta{color:#4a5a67;margin:0 0 18px}
.stats{display:flex;gap:24px;flex-wrap:wrap;margin:14px 0 20px}.stats b{display:block;font:600 22px ui-monospace,Menlo,monospace}
.pair{border-top:1px solid #d8e0e5;padding:16px 0;break-inside:avoid}.sig{color:#4a5a67;margin:0 0 8px}
.v{font-size:12px;text-transform:uppercase;letter-spacing:.08em;border:1.5px solid currentColor;border-radius:4px;padding:2px 6px;margin-left:8px;white-space:nowrap}
.v.high{color:#bf2530}.v.medium{color:#a95c08}.v.low,.v.none{color:#59707f}
.blk{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}pre{margin:0;background:#fffbe0;border:1px solid #efe3a0;border-radius:6px;padding:8px;font:11.5px/1.5 ui-monospace,Menlo,monospace;overflow:auto;white-space:pre}
.l{color:#9aa7b0}.ex{color:#4a5a67}.note{color:#4a5a67;font-size:12px;margin-top:22px}
@media print{body{padding:0}.pair{page-break-inside:avoid}}
</style></head><body>
<h1>CloneScope report · ${esc(ds.title)}</h1>
<p class="meta">${esc(ds.subtitle)} · generated ${esc(date)} · threshold ${pct(state.threshold)}${r.hasTemplate ? ' · starter code ignored' : ''}</p>
<div class="stats"><div><b>${r.submissions.length}</b>submissions</div><div><b>${r.pairs.length}</b>pairs compared</div><div><b>${pairs.length}</b>${only ? 'pair in this report' : 'pairs flagged'}</div><div><b>${r.groups.length}</b>copy groups</div></div>
${!only && groups ? `<h2>Copy groups</h2><ul>${groups}</ul>` : ''}
${rows || '<p>No pairs reached the threshold.</p>'}
<p class="note">CloneScope compares normalized token streams (winnowing fingerprints and greedy string tiling) and a neural code encoder. A high score is evidence for a person to review, not proof of misconduct; it cannot tell who copied from whom.</p>
</body></html>`;
}

async function saveFile(filename, text, mime) {
  if (state.downloads) {
    try {
      await state.downloads.save({ filename, data: text });
      toast(`Saved ${filename}`);
    } catch (e) {
      if (e && e.code === 'declined') return;
      toast(e && e.code === 'rate_limited' ? 'A save is already waiting for confirmation.' : 'This view cannot save files. Use “Copy results as CSV” instead.');
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copyText(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(ok); } catch { toast('Copy failed. Select the table and copy it manually.'); }
    ta.remove();
  }
}

// ----------------------------------------------------------------------------- how it works
function metricRow(m, best) {
  const i = m.irplag;
  const f = (v) => v.toFixed(3);
  const pc = (v) => `${Math.round(v * 100)}%`;
  const hi = (v, k, txt) => (Math.abs(v - best[k]) < 1e-9 ? `<b>${txt}</b>` : txt);
  const s3 = m.stress_recall?.S3;
  return `<tr${m.key === 'fused' ? ' style="background:var(--accent-soft)"' : ''}><td>${esc(m.name)}</td>
    <td class="n">${hi(i.auc, 'auc', f(i.auc))}</td><td class="n">${hi(m.irplag_case_auc_mean ?? 0, 'cauc', f(m.irplag_case_auc_mean ?? 0))}</td>
    <td class="n">${hi(i.balanced_accuracy, 'ba', f(i.balanced_accuracy))}</td><td class="n">${pc(i.recall)}</td><td class="n">${pc(i.false_positive_rate)}</td>
    <td class="n">${hi(m.synthetic.auc, 'sauc', f(m.synthetic.auc))}</td><td class="n">${s3 === undefined ? '-' : hi(s3, 's3', pc(s3))}</td></tr>`;
}

function levelChart(methods) {
  const pick = methods.filter((m) => ['diff', 'wContainment', 'gstAvg', 'fused'].includes(m.key));
  const colors = { diff: cssVar('--ink-3'), wContainment: cssVar('--kw'), gstAvg: cssVar('--accent'), fused: cssVar('--flag') };
  const L = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  const W = 640, H = 250, x0 = 44, y0 = 24, ch = 170, gw = (W - x0 - 10) / L.length, bw = Math.min(18, (gw - 14) / pick.length);
  const y = (v) => y0 + ch - v * ch;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recall per plagiarism level on IR-Plag"><text class="title" x="${x0}" y="14">Share of plagiarized files caught, by disguise level (IR-Plag)</text>`;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line x1="${x0}" x2="${W - 10}" y1="${y(t)}" y2="${y(t)}" stroke="${cssVar('--rule-2')}"/><text x="${x0 - 6}" y="${y(t) + 4}" text-anchor="end">${Math.round(t * 100)}%</text>`;
  }
  L.forEach((lv, li) => {
    const gx = x0 + li * gw + (gw - bw * pick.length) / 2;
    pick.forEach((m, mi) => {
      const v = m.irplag_levels[lv] || 0;
      s += `<rect x="${(gx + mi * bw).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(ch - (y(v) - y0)).toFixed(1)}" rx="2" fill="${colors[m.key]}"><title>${esc(m.name)} ${lv}: ${Math.round(v * 100)}%</title></rect>`;
    });
    s += `<text x="${(x0 + li * gw + gw / 2).toFixed(1)}" y="${y0 + ch + 16}" text-anchor="middle">${lv}</text>`;
  });
  let lx = x0;
  for (const m of pick) {
    s += `<rect x="${lx}" y="${H - 18}" width="10" height="10" rx="2" fill="${colors[m.key]}"/><text x="${lx + 14}" y="${H - 9}">${esc(m.name)}</text>`;
    lx += 26 + m.name.length * 6.1;
  }
  return s + '</svg>';
}

function stressChart(methods) {
  const W = 420, H = 270, x0 = 46, y0 = 28, cw = 300, ch = 170;
  const colors = { diff: cssVar('--ink-3'), rawTok: cssVar('--num'), wContainment: cssVar('--kw'), gstAvg: cssVar('--accent'), neural: cssVar('--ok'), fused: cssVar('--flag') };
  const X = (k) => x0 + ((k - 1) / 2) * cw, Y = (v) => y0 + ch - v * ch;
  let s = `<svg viewBox="0 0 ${W + 150} ${H}" role="img" aria-label="Copies caught after stacked disguises"><text class="title" x="${x0}" y="14">Copies caught after stacked disguises (held-out programs)</text>`;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) s += `<line x1="${x0}" x2="${x0 + cw}" y1="${Y(t)}" y2="${Y(t)}" stroke="${cssVar('--rule-2')}"/><text x="${x0 - 6}" y="${Y(t) + 4}" text-anchor="end">${Math.round(t * 100)}%</text>`;
  [1, 2, 3].forEach((k) => { s += `<text x="${X(k)}" y="${y0 + ch + 18}" text-anchor="middle">L6 ×${k}</text>`; });
  let ly = y0 + 6;
  for (const m of methods) {
    if (!m.stress_recall) continue;
    const pts = [1, 2, 3].map((k) => `${X(k).toFixed(1)},${Y(m.stress_recall[`S${k}`]).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${colors[m.key]}" stroke-width="${m.key === 'fused' ? 3 : 1.5}"/>`;
    [1, 2, 3].forEach((k) => { s += `<circle cx="${X(k).toFixed(1)}" cy="${Y(m.stress_recall[`S${k}`]).toFixed(1)}" r="${m.key === 'fused' ? 3.5 : 2.5}" fill="${colors[m.key]}"><title>${esc(m.name)}: ${Math.round(m.stress_recall[`S${k}`] * 100)}%</title></circle>`; });
    s += `<line x1="${x0 + cw + 24}" x2="${x0 + cw + 38}" y1="${ly}" y2="${ly}" stroke="${colors[m.key]}" stroke-width="2.5"/><text x="${x0 + cw + 42}" y="${ly + 4}" style="font-size:10px">${esc(m.name.replace(/ \(.*\)/, ''))}</text>`;
    ly += 17;
  }
  return s + '</svg>';
}

/** One honest sentence about how the fused score compares on IR-Plag, worked out from the numbers. */
function irplagVerdict(methods) {
  const f = methods.find((m) => m.key === 'fused');
  if (!f) return '';
  const others = methods.filter((m) => m.key !== 'fused');
  const checks = [
    [f.irplag.auc, Math.max(...others.map((m) => m.irplag.auc)), 'overall ranking (AUC)'],
    [f.irplag_case_auc_mean, Math.max(...others.map((m) => m.irplag_case_auc_mean)), 'ranking within a task'],
    [f.irplag.balanced_accuracy, Math.max(...others.map((m) => m.irplag.balanced_accuracy)), 'balanced accuracy'],
  ];
  const best = checks.filter(([v, b]) => v > b + 0.002).map((c) => `the best ${c[2]}`);
  const tie = checks.filter(([v, b]) => Math.abs(v - b) <= 0.002).map((c) => `the best ${c[2]}`);
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  const bits = [];
  if (best.length) bits.push(`has ${list(best)}`);
  if (tie.length) bits.push(`ties for ${list(tie)}`);
  return bits.length ? `CloneScope ${bits.join(', and ')}.` : 'CloneScope is close to the best single method here.';
}

function renderAbout(el) {
  const M = DATA.metrics, T = DATA.training || {};
  const methods = M?.methods || [];
  const best = {
    auc: Math.max(...methods.map((m) => m.irplag.auc)), ba: Math.max(...methods.map((m) => m.irplag.balanced_accuracy)),
    sauc: Math.max(...methods.map((m) => m.synthetic.auc)), s3: Math.max(...methods.map((m) => m.stress_recall?.S3 ?? 0)),
    cauc: Math.max(...methods.map((m) => m.irplag_case_auc_mean ?? 0)),
  };
  const fused = methods.find((m) => m.key === 'fused');
  const fmtN = (x) => (x ?? 0).toLocaleString('en-US');
  el.innerHTML = `<div class="about">
    <section>
      <h2>What CloneScope checks</h2>
      <div class="prose"><p>Students hide copied code by renaming variables, rewriting comments, moving functions around, swapping <code>for</code> and <code>while</code> loops, or padding the file with code that does nothing. CloneScope looks past all of that by comparing the <em>structure</em> of the programs, then explains which tricks were used.</p></div>
      <div class="pipeline">
        <div class="step"><span class="eyebrow">Step 1</span><h3>Normalize</h3><p>Comments, layout and names are removed; only the program's structure is kept.</p><code>total += marks[i]
ID += ID [ ID ]</code></div>
        <div class="step"><span class="eyebrow">Step 2</span><h3>Fingerprint</h3><p>Winnowing (the method behind Stanford's MOSS) keeps hashes of short token runs.</p><code>9f3a 41c0 77e2 …</code></div>
        <div class="step"><span class="eyebrow">Step 3</span><h3>Tile</h3><p>Greedy string tiling (as in JPlag) finds the longest shared blocks, in any order.</p><code>A 12–19 ⇄ B 30–37</code></div>
        <div class="step"><span class="eyebrow">Step 4</span><h3>Neural similarity</h3><p>A Siamese neural network embeds each program; rewritten but equivalent code stays close.</p><code>cos(A, B) = 0.94</code></div>
        <div class="step"><span class="eyebrow">Step 5</span><h3>Shared text</h3><p>Copied prompts and constants, ignoring text most of the class uses (what the assignment asked for).</p><code>"Enter the no. of elements :"</code></div>
        <div class="step"><span class="eyebrow">Step 6</span><h3>Fuse and explain</h3><p>Logistic regression turns all signals into one suspicion score, and the matches are explained.</p><code>score 92 · renamed, loops rewritten</code></div>
      </div>
    </section>
    <section>
      <h3>Try the normalizer</h3>
      <div class="try">
        <div><textarea id="try-code" aria-label="Code to normalize" spellcheck="false">int total = 0;
for (int i = 0; i < n; i++) {
    total += marks[i]; // add up
}</textarea>
          <div class="chips" id="try-lang" style="margin-top:6px">${['c', 'cpp', 'java', 'python'].map((l) => `<button class="chip" data-l="${l}" aria-pressed="${l === 'c'}">${LANGUAGE_NAMES[l]}</button>`).join('')}</div></div>
        <div class="tokens" id="try-out" aria-live="polite"></div>
      </div>
      <p class="note">Rename <code>total</code> or <code>marks</code>, or delete the comment: the token stream does not change.</p>
    </section>
    <section>
      <h2>How the neural model was trained</h2>
      <div class="prose"><p>No one labelled any data by hand. A disguise generator rewrote ${fmtN(T.originals)} real programs (Rosetta Code and TheAlgorithms, in Python, Java, C and C++) the way students do, at six levels of disguise. Each original and its disguised copy form a known copied pair. Different people's solutions to the same Rosetta Code task form known <em>not copied</em> pairs, the hardest case in a class where everyone solves the same assignment.</p>
      <p>Every disguise is checked by re-parsing it; on the test programs ${esc(T.obfuscator_check || '100%')} of disguised files still compile and print exactly the same output.</p></div>
      <div class="cards">
        <div class="kv"><b>${fmtN(T.originals)}</b><span>original programs (${esc(T.languages || 'Python, Java, C, C++')})</span></div>
        <div class="kv"><b>${fmtN(T.variants)}</b><span>disguised copies generated</span></div>
        <div class="kv"><b>${fmtN(T.hard_pairs)}</b><span>same-task, not-copied pairs</span></div>
        <div class="kv"><b>${fmtN(T.parameters)}</b><span>neural network parameters (runs in the browser)</span></div>
      </div>
      <ul class="plain">
        <li><b>L1</b> comments, indentation, braces, blank lines · <b>L2</b> + renamed identifiers · <b>L3</b> + split or merged declarations</li>
        <li><b>L4</b> + reordered functions and statements · <b>L5</b> + for ⇄ while, i++ ⇄ i += 1, list comprehension ⇄ loop</li>
        <li><b>L6</b> + flipped if/else, dead code, temporary variables, extra parentheses</li>
      </ul>
    </section>
    ${fused ? `<section id="accuracy">
      <h2>How accurate it is</h2>
      <div class="prose">
        <p>Two tests, and every method gets its threshold from CloneScope's own validation data (nothing is tuned on the test sets).</p>
        <p><b>Held-out programs with stacked disguises.</b> Rosetta Code tasks the model never saw, with the strongest disguise applied up to three times in a row. After three rounds CloneScope still catches ${fused.stress_recall ? Math.round(fused.stress_recall.S3 * 100) : '-'}% of the copies, compared with about ${Math.round(Math.max(...methods.filter((m) => m.key === 'gstAvg' || m.key === 'wContainment').map((m) => m.stress_recall?.S3 ?? 0)) * 100)}% for MOSS- and JPlag-style matching and ${Math.round((methods.find((m) => m.key === 'diff')?.stress_recall?.S3 ?? 0) * 100)}% for a text diff.</p>
        <p><b>IR-Plag</b> (Karnalim et al., 2019): ${fmtN(M.irplag_counts.plagiarized)} Java files that people plagiarized by hand at levels L1–L6, and ${fmtN(M.irplag_counts.independent)} solutions written independently for the same seven textbook exercises. It is a hard test: the exercises are tiny (11–34 lines), so honest solutions almost match the textbook answer, while the L4–L6 copies were heavily refactored. Every method raises false alarms here. ${irplagVerdict(methods)} The shared-text signal is what still separates many of the copies.</p>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Method</th><th class="n">IR-Plag AUC</th><th class="n">AUC within a task</th><th class="n">Balanced accuracy</th><th class="n">Copies caught</th><th class="n">False alarms</th><th class="n">Held-out AUC</th><th class="n">Caught after 3× L6</th></tr></thead>
        <tbody>${methods.map((m) => metricRow(m, best)).join('')}</tbody></table></div>
      <p class="note">AUC: chance that a copied pair scores above an honest pair (1 = perfect, 0.5 = guessing). Balanced accuracy: the average of copies caught and honest pairs cleared. ${M.recalibrated ? `Refitting the fusion weights on IR-Plag itself (leave-one-task-out) raises its AUC within a task to ${M.recalibrated.case_auc_mean.toFixed(3)}, so a college can recalibrate CloneScope on its own labelled cases.` : ''}</p>
      <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))"><div class="chart">${stressChart(methods)}</div><div class="chart">${levelChart(methods)}</div></div>
    </section>` : ''}
    <section>
      <h2>Reading the score</h2>
      <ul class="plain">
        <li>The suspicion score (0–100) combines all signals. Pairs at or above your threshold are flagged; the default comes from validation data.</li>
        <li>It cannot tell who copied from whom. When a whole group shares code, it may come from one student, a senior's file, a website or an AI tool.</li>
        <li>Very short programs (a few lines) are naturally similar; judge them with care. Starter code you gave out should be added so it is ignored.</li>
        <li>Copying across languages (C to Python, say) is not detected. A high score is evidence for a person to review, never an automatic penalty.</li>
      </ul>
    </section>
  </div>`;
  const tryOut = () => {
    const lang = $('#try-lang [aria-pressed="true"]').dataset.l;
    const code = $('#try-code').value;
    const t = tokenize(code, lang);
    $('#try-out').innerHTML = Array.from(t.ids, (id, i) => {
      const k = t.kinds[i];
      const label = VOCAB[id];
      const raw = code.slice(t.starts[i], t.ends[i]);
      const cls = k === KIND.ID ? 'i' : (k === KIND.NUM || k === KIND.STR || k === KIND.CHR) ? 'l' : '';
      return `<span class="${cls}" title="${esc(raw)}">${esc(label)}</span>`;
    }).join('') || '<span>(no tokens)</span>';
  };
  $('#try-code').addEventListener('input', tryOut);
  $('#try-lang').addEventListener('click', (e) => {
    const b = e.target.closest('[data-l]');
    if (!b) return;
    $$('#try-lang .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    tryOut();
  });
  tryOut();
}

init();
