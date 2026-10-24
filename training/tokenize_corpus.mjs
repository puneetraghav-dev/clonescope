// Step 3 - tokenize every program with the *same* tokenizer the browser app uses.
//
//   node training/tokenize_corpus.mjs
//
// Writes
//   data/corpus/tokens.bin          all token ids, uint16 little-endian, concatenated
//   data/corpus/tokens_index.jsonl  one line per program: id, offset, n, lang, split, task, orig, level
//   data/corpus/task_pairs.jsonl    similarity between independent solutions of the same task
//                                   (used to drop near-duplicate "hard negatives")
import fs from 'node:fs';
import readline from 'node:readline';
import { tokenize, VOCAB, vocabHash } from '../engine/tokenizer.js';
import { greedyStringTiling, tilingSimilarity } from '../engine/gst.js';

const DIR = process.argv[2] || 'data/corpus';
const MAX_TOKENS = 4096;

async function* records(path) {
  const rl = readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

const bin = fs.openSync(`${DIR}/tokens.bin`, 'w');
const index = fs.createWriteStream(`${DIR}/tokens_index.jsonl`);
let offset = 0, count = 0;
const origTokens = new Map(); // id -> Uint16Array (originals only, for task pairs)
const origMeta = new Map();

async function run(path, isOrig) {
  for await (const r of records(path)) {
    const tok = tokenize(r.code, r.lang);
    const ids = tok.ids.length > MAX_TOKENS ? tok.ids.slice(0, MAX_TOKENS) : tok.ids;
    const buf = Buffer.from(ids.buffer, ids.byteOffset, ids.byteLength);
    fs.writeSync(bin, buf);
    index.write(JSON.stringify({
      id: r.id, offset, n: ids.length, lang: r.lang, split: r.split, task: r.task,
      orig: isOrig ? r.id : r.orig, level: isOrig ? 0 : r.level, tag: isOrig ? 'O' : r.tag,
      ops: isOrig ? [] : r.ops, source: r.source,
    }) + '\n');
    offset += ids.length; count++;
    if (isOrig) { origTokens.set(r.id, ids); origMeta.set(r.id, { lang: r.lang, task: r.task }); }
    if (count % 10000 === 0) console.log(count, 'programs tokenized');
  }
}

await run(`${DIR}/originals.jsonl`, true);
if (fs.existsSync(`${DIR}/variants.jsonl`)) await run(`${DIR}/variants.jsonl`, false);
fs.closeSync(bin);
index.end();

// similarity between different solutions of the same task (same language)
const groups = new Map();
for (const [id, m] of origMeta) {
  const k = `${m.lang}|${m.task}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(id);
}
const tp = fs.createWriteStream(`${DIR}/task_pairs.jsonl`);
let pairs = 0;
for (const ids of groups.values()) {
  if (ids.length < 2) continue;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = origTokens.get(ids[i]), b = origTokens.get(ids[j]);
      const g = greedyStringTiling(a, b, 8);
      const s = tilingSimilarity(g.matched, a.length, b.length);
      tp.write(JSON.stringify({ a: ids[i], b: ids[j], gst_avg: +s.avg.toFixed(4), gst_max: +s.max.toFixed(4) }) + '\n');
      pairs++;
    }
  }
}
tp.end();
fs.writeFileSync(`${DIR}/vocab.json`, JSON.stringify({ vocab: VOCAB, hash: vocabHash() }));
console.log(`done: ${count} programs, ${offset} tokens, ${pairs} same-task pairs, vocab ${VOCAB.length} (${vocabHash()})`);
