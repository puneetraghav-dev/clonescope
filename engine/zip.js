// Minimal ZIP reader (no dependencies)
// ------------------------------------
// Reads the central directory and inflates entries with the built-in
// DecompressionStream('deflate-raw') (all modern browsers, Node 18+).
// Supports "stored" and "deflate" entries, UTF-8 names and nested zips one level deep.

const SIG_EOCD = 0x06054b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    const zlib = await import('node:zlib');
    return new Uint8Array(zlib.inflateRawSync(data));
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»';

function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* not utf-8 */ }
  let s = '';
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : (CP437[b - 128] || '?');
  return s;
}

/**
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {Promise<{path:string, data:Uint8Array}[]>}
 */
export async function readZip(buf, depth = 0) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (end of central directory not found)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let e = 0; e < count; e++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== SIG_CEN) break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = decodeName(u8.subarray(p + 46, p + 46 + nlen), (flags & 0x800) !== 0);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || (flags & 1) || csize === 0xffffffff) continue; // dir, encrypted, zip64
    if (dv.getUint32(loc, true) !== SIG_LOC) continue;
    const lnlen = dv.getUint16(loc + 26, true), lxlen = dv.getUint16(loc + 28, true);
    const start = loc + 30 + lnlen + lxlen;
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      try { data = await inflateRaw(raw); } catch { continue; }
    } else continue;
    if (/\.zip$/i.test(name) && depth < 1) {
      try {
        const inner = await readZip(data, depth + 1);
        const base = name.replace(/\.zip$/i, '');
        for (const f of inner) out.push({ path: `${base}/${f.path}`, data: f.data });
        continue;
      } catch { /* not a zip after all */ }
    }
    out.push({ path: name, data });
  }
  return out;
}

/** Decodes file bytes as UTF-8 (falls back to Windows-1252 for old lab machines). */
export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* fall through */ }
  try { return new TextDecoder('windows-1252').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}
