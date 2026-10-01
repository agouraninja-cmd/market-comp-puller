"use strict";
// pdf-text.js — the words on each page of a PDF and where they sit, for the
// city reports the permit sweep reads (Nampa's published permit reports,
// 2026-10-01). Zero dependencies: Node's own zlib inflates the streams.
//
// Deliberately small. It reads what a report generator writes: objects found
// by scanning for "N G obj" (so a missing or broken cross-reference table
// does not matter), FlateDecode or plain streams, simple and Type0 fonts with
// a ToUnicode map, text placed with Tm / Td / TD / T* and drawn with Tj / TJ /
// ' / ", inside q / Q / cm transforms; and the straight lines a table is ruled
// with. It does not render, read images, or open encrypted files or object
// streams: those throw "pdf-unsupported: …" so a caller names the problem
// rather than reading an empty page.
//
// TEXT RUNS, NOT GLYPHS. A run starts wherever the text position is set and
// gathers every string drawn after it until the next positioning operator.
// That is exactly the unit a report writes a cell or a label in, and it means
// no font widths are needed: a Td is relative to the start of the LINE, never
// to where the last glyph ended, so positions stay exact without them.
//
// Coordinates come back top-down (`top` grows down the page from the top
// edge, like a screen), so sorting by top then x is reading order.

const zlib = require("zlib");

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------
const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;

// A tiny parser for the object syntax: dictionaries, arrays, names, numbers,
// strings (as raw byte strings), refs and keywords. Answers [value, nextPos].
function parseValue(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === "<" && s[i + 1] === "<") {
    const out = {};
    i += 2;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ">" && s[i + 1] === ">") return [out, i + 2];
      if (i >= s.length) return [out, i];
      const [k, j] = parseValue(s, i);
      const [v, n] = parseValue(s, j);
      if (k && k.name) out[k.name] = v;
      i = n;
    }
  }
  if (c === "[") {
    const out = [];
    i += 1;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === "]") return [out, i + 1];
      if (i >= s.length) return [out, i];
      const [v, n] = parseValue(s, i);
      out.push(v);
      i = n;
    }
  }
  if (c === "/") {
    let j = i + 1;
    while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
    return [{ name: s.slice(i + 1, j).replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) }, j];
  }
  if (c === "(") return parseLiteral(s, i);
  if (c === "<") {
    const j = s.indexOf(">", i);
    return [{ str: hexBytes(s.slice(i + 1, j)) }, j + 1];
  }
  // A number, possibly the start of "N G R".
  const num = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 40));
  if (num) {
    const ref = /^(\d+)\s+(\d+)\s+R\b/.exec(s.slice(i, i + 40));
    if (ref) return [{ ref: Number(ref[1]) }, i + ref[0].length];
    return [Number(num[0]), i + num[0].length];
  }
  let j = i;
  while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
  if (j === i) j = i + 1;
  return [{ kw: s.slice(i, j) }, j];
}

function skipWs(s, i) {
  for (;;) {
    while (i < s.length && WS.test(s[i])) i++;
    if (s[i] === "%") { while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    return i;
  }
}

function hexBytes(h) {
  const t = h.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  for (let k = 0; k < t.length; k += 2) out += String.fromCharCode(parseInt((t[k] + (t[k + 1] || "0")), 16));
  return out;
}

// A literal string, its escapes resolved, as a byte string.
function parseLiteral(s, i) {
  let out = "", depth = 0, j = i + 1;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\") {
      const n = s[j + 1];
      const esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[n];
      if (esc !== undefined) { out += esc; j++; continue; }
      if (/[0-7]/.test(n)) {
        const m = /^[0-7]{1,3}/.exec(s.slice(j + 1, j + 4))[0];
        out += String.fromCharCode(parseInt(m, 8) & 255);
        j += m.length;
        continue;
      }
      if (n === "\r") { j += s[j + 2] === "\n" ? 2 : 1; continue; }
      if (n === "\n") { j++; continue; }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") { if (depth === 0) break; depth--; }
    out += ch;
  }
  return [{ str: out }, j + 1];
}

// Every "N G obj … endobj" in the file: { dict | value, stream (Buffer) }.
function readObjects(buf) {
  const s = buf.toString("latin1");
  if (/\/Encrypt\s/.test(s.slice(-4096)) || /\/Encrypt\s/.test(s.slice(0, 4096))) throw new Error("pdf-unsupported: encrypted");
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const [value, after] = parseValue(s, m.index + m[0].length);
    let stream = null;
    const k = skipWs(s, after);
    if (s.startsWith("stream", k)) {
      let start = k + 6;
      if (s[start] === "\r") start++;
      if (s[start] === "\n") start++;
      const len = value && typeof value.Length === "number" ? value.Length : null;
      let end = len != null && s.startsWith("endstream", skipWs(s, start + len)) ? start + len : s.indexOf("endstream", start);
      if (end < 0) end = s.length;
      stream = buf.subarray(start, end);
      re.lastIndex = end;
    }
    objs.set(num, { value, stream });
  }
  for (const o of objs.values()) {
    if (o.value && o.value.Type && o.value.Type.name === "ObjStm") throw new Error("pdf-unsupported: object streams");
  }
  return objs;
}

function resolve(objs, v) {
  let guard = 0;
  while (v && typeof v === "object" && "ref" in v && guard++ < 20) {
    const o = objs.get(v.ref);
    v = o ? o.value : null;
  }
  return v;
}

function streamBytes(objs, ref) {
  const o = ref && typeof ref === "object" && "ref" in ref ? objs.get(ref.ref) : null;
  if (!o || !o.stream) return Buffer.alloc(0);
  const f = o.value && o.value.Filter;
  const filters = Array.isArray(f) ? f.map((x) => x.name) : f ? [f.name] : [];
  let b = o.stream;
  for (const name of filters) {
    if (name === "FlateDecode") {
      try { b = zlib.inflateSync(b); } catch (_) { b = zlib.inflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
    } else {
      throw new Error(`pdf-unsupported: ${name} stream`);
    }
  }
  return b;
}

// ---------------------------------------------------------------------------
// Fonts: bytes -> text
// ---------------------------------------------------------------------------
// WinAnsi's printable 0x80–0x9F, the codes a simple font without a ToUnicode
// map most often uses for typographic punctuation. The rest is Latin-1.
const WIN_ANSI = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function utf16(bytes) {
  let out = "";
  for (let k = 0; k + 1 < bytes.length; k += 2) out += String.fromCharCode((bytes.charCodeAt(k) << 8) | bytes.charCodeAt(k + 1));
  return out;
}

// A ToUnicode CMap's bfchar and bfrange entries -> Map(code -> text).
function parseCMap(text) {
  const map = new Map();
  let width = 1;
  const cs = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
  if (cs) width = Math.max(1, cs[1].length / 2);
  const code = (h) => parseInt(h, 16);
  for (const block of text.match(/beginbfchar[\s\S]*?endbfchar/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(code(m[1]), utf16(hexBytes(m[2])));
  }
  for (const block of text.match(/beginbfrange[\s\S]*?endbfrange/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = code(m[1]), hi = code(m[2]);
      if (hi - lo > 65535) continue;
      if (m[3][0] === "[") {
        const list = [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => utf16(hexBytes(x[1])));
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
      } else {
        const base = hexBytes(m[3].slice(1, -1));
        for (let c = lo; c <= hi; c++) {
          const last = base.length >= 2 ? (base.charCodeAt(base.length - 2) << 8 | base.charCodeAt(base.length - 1)) + (c - lo) : c;
          map.set(c, utf16(base.slice(0, -2)) + String.fromCharCode(last));
        }
      }
    }
  }
  return { map, width };
}

function fontDecoder(objs, fontRef) {
  const f = resolve(objs, fontRef) || {};
  const type0 = f.Subtype && f.Subtype.name === "Type0";
  let cmap = null;
  if (f.ToUnicode) {
    try { cmap = parseCMap(streamBytes(objs, f.ToUnicode).toString("latin1")); } catch (_) { cmap = null; }
  }
  const width = type0 ? 2 : cmap ? Math.min(cmap.width, 2) : 1;
  return (bytes) => {
    let out = "";
    for (let k = 0; k < bytes.length; k += width) {
      const c = width === 2 ? (bytes.charCodeAt(k) << 8) | (bytes.charCodeAt(k + 1) || 0) : bytes.charCodeAt(k);
      if (cmap && cmap.map.has(c)) out += cmap.map.get(c);
      else if (width === 1) out += WIN_ANSI[c] || String.fromCharCode(c);
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
function pageList(objs) {
  let root = null;
  for (const o of objs.values()) if (o.value && o.value.Type && o.value.Type.name === "Catalog") { root = o.value; break; }
  const out = [];
  const walk = (node, inherited, depth) => {
    const n = resolve(objs, node);
    if (!n || depth > 30) return;
    const inh = { ...inherited };
    if (n.Resources) inh.Resources = n.Resources;
    if (n.MediaBox) inh.MediaBox = n.MediaBox;
    if (n.Type && n.Type.name === "Pages") { for (const k of resolve(objs, n.Kids) || []) walk(k, inh, depth + 1); }
    else if (n.Type && n.Type.name === "Page") out.push({ ...inh, ...n, Resources: n.Resources || inh.Resources, MediaBox: n.MediaBox || inh.MediaBox });
  };
  if (root && root.Pages) walk(root.Pages, {}, 0);
  if (!out.length) {
    // No usable tree: every Page object, in file order.
    for (const o of objs.values()) if (o.value && o.value.Type && o.value.Type.name === "Page") out.push(o.value);
  }
  return out;
}

function mul(a, b) {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
}
const ID = [1, 0, 0, 1, 0, 0];

// The content-stream tokens: operands then an operator.
function* tokens(s) {
  let i = 0;
  while (i < s.length) {
    i = skipWs(s, i);
    if (i >= s.length) return;
    const c = s[i];
    if (c === "(" || c === "<" || c === "[" || c === "/" || /[+\-.\d]/.test(c)) {
      const [v, n] = parseValue(s, i);
      yield { v };
      i = n;
      continue;
    }
    let j = i;
    while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
    if (j === i) { i++; continue; }
    const op = s.slice(i, j);
    i = j;
    if (op === "BI") { // an inline image: skip to its end
      const e = s.indexOf("EI", i);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    yield { op };
  }
}

function pageText(objs, page) {
  const box = (resolve(objs, page.MediaBox) || [0, 0, 612, 792]).map((x) => resolve(objs, x));
  const height = box[3] - box[1], width = box[2] - box[0];
  const res = resolve(objs, page.Resources) || {};
  const fonts = resolve(objs, res.Font) || {};
  const decoders = {};
  const decoderFor = (name) => (decoders[name] = decoders[name] || fontDecoder(objs, fonts[name]));
  const contents = Array.isArray(resolve(objs, page.Contents)) ? resolve(objs, page.Contents) : [page.Contents];
  const src = contents.map((r) => streamBytes(objs, r).toString("latin1")).join("\n");

  const items = [], segs = [];
  let ctm = ID.slice(), stack = [];
  let tm = ID.slice(), tlm = ID.slice(), leading = 0, font = null, size = 0;
  let cur = null;
  let path = [], pt = null;
  const ops = [];
  const at = (m) => {
    const t = mul(m, ctm);
    return { x: t[4], y: t[5], scale: Math.hypot(t[2], t[3]) };
  };
  const start = () => { cur = null; };
  const show = (str) => {
    if (!font) return;
    const text = decoderFor(font)(str);
    if (!cur) {
      const p = at(tm);
      cur = { x: round(p.x - box[0]), top: round(height - (p.y - box[1])), size: round(size * p.scale), str: "" };
      items.push(cur);
    }
    cur.str += text;
  };
  for (const t of tokens(src)) {
    if (!t.op) { ops.push(t.v); continue; }
    const a = ops.splice(0);
    const n = (k) => (typeof a[k] === "number" ? a[k] : 0);
    switch (t.op) {
      case "q": stack.push(ctm.slice()); break;
      case "Q": ctm = stack.pop() || ID.slice(); break;
      case "cm": ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm); break;
      case "BT": tm = ID.slice(); tlm = ID.slice(); start(); break;
      case "ET": start(); break;
      case "Tf": font = a[0] && a[0].name; size = n(1); break;
      case "TL": leading = n(0); break;
      case "Td": tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm); tm = tlm.slice(); start(); break;
      case "TD": leading = -n(1); tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm); tm = tlm.slice(); start(); break;
      case "Tm": tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; tm = tlm.slice(); start(); break;
      case "T*": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); start(); break;
      case "Tj": if (a[0] && a[0].str != null) show(a[0].str); break;
      case "'": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); start(); if (a[0] && a[0].str != null) show(a[0].str); break;
      case "\"": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm.slice(); start(); if (a[2] && a[2].str != null) show(a[2].str); break;
      case "TJ":
        for (const el of Array.isArray(a[0]) ? a[0] : []) {
          if (el && el.str != null) show(el.str);
          else if (typeof el === "number" && el < -250 && cur && !/\s$/.test(cur.str)) cur.str += " ";
        }
        break;
      // Paths: only straight lines matter (a table's rules).
      case "m": pt = [n(0), n(1)]; path.push({ m: pt }); break;
      case "l": if (pt) { path.push({ l: [pt, [n(0), n(1)]] }); pt = [n(0), n(1)]; } break;
      case "re": {
        const x = n(0), y = n(1), w = n(2), h = n(3);
        path.push({ re: [x, y, w, h] });
        break;
      }
      case "h": break;
      case "S": case "s": case "B": case "B*": case "b": case "b*": case "f": case "F": case "f*": {
        const stroke = t.op !== "f" && t.op !== "F" && t.op !== "f*";
        for (const p of path) {
          if (p.l && stroke) segs.push(seg(p.l[0], p.l[1]));
          if (p.re) {
            const [x, y, w, h] = p.re;
            if (Math.abs(h) < 2.5 && Math.abs(w) > 2) segs.push(seg([x, y + h / 2], [x + w, y + h / 2]));
            else if (Math.abs(w) < 2.5 && Math.abs(h) > 2) segs.push(seg([x + w / 2, y], [x + w / 2, y + h]));
            else if (stroke) {
              segs.push(seg([x, y], [x + w, y]), seg([x, y + h], [x + w, y + h]), seg([x, y], [x, y + h]), seg([x + w, y], [x + w, y + h]));
            }
          }
        }
        path = []; pt = null;
        break;
      }
      case "n": path = []; pt = null; break;
      default: break;
    }
  }
  function seg(p1, p2) {
    const a1 = at([1, 0, 0, 1, p1[0], p1[1]]), a2 = at([1, 0, 0, 1, p2[0], p2[1]]);
    return { x1: round(a1.x - box[0]), top1: round(height - (a1.y - box[1])), x2: round(a2.x - box[0]), top2: round(height - (a2.y - box[1])) };
  }
  const clean = items.map((it) => ({ ...it, str: it.str.replace(/\s+/g, " ").trim() })).filter((it) => it.str);
  return {
    width: round(width), height: round(height), items: clean,
    hlines: segs.filter((g) => Math.abs(g.top1 - g.top2) < 0.6).map((g) => ({ top: g.top1, x1: Math.min(g.x1, g.x2), x2: Math.max(g.x1, g.x2) })),
    vlines: segs.filter((g) => Math.abs(g.x1 - g.x2) < 0.6).map((g) => ({ x: g.x1, top1: Math.min(g.top1, g.top2), top2: Math.max(g.top1, g.top2) })),
  };
}

function round(v) { return Math.round(v * 100) / 100; }

// A PDF Buffer -> { pages: [{ width, height, items: [{ x, top, size, str }], hlines, vlines }] }.
function readPdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("pdf-unsupported: not a PDF");
  const objs = readObjects(buf);
  return { pages: pageList(objs).map((p) => pageText(objs, p)) };
}

// A page's runs grouped into lines (tops within `tol` points), each line's
// runs left to right: [{ top, items, text }]. Reports are read line by line.
function lines(page, tol = 1.5) {
  const sorted = page.items.slice().sort((a, b) => a.top - b.top || a.x - b.x);
  const out = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(it.top - last.top) <= tol) last.items.push(it);
    else out.push({ top: it.top, items: [it] });
  }
  for (const l of out) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join(" ");
  }
  return out;
}

module.exports = { readPdf, lines, parseCMap, parseValue };
