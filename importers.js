// Turns user files into library content.
//   importBookFile(file)     → { title, author, image, chapters: [{ title, paras }] }
//   readAudioTracks(files)   → [{ name, dur }]   (seconds)
//   readAudioDurations(urls) → [dur]             (seconds, for cloud tracks)
//   scaleImage(fileOrBlob)   → JPEG data URL, long edge ≤ 700px

const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const PART_SIZE = 60; // paragraphs per part when a text has no chapter headings

export async function importBookFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.epub')) return parseEpub(file);
  if (name.endsWith('.txt') || file.type === 'text/plain') return parseTxt(decode(await file.arrayBuffer()), file.name);
  throw new Error('Only .epub and .txt files can be imported for now.');
}

export function scaleImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 700 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
    img.src = url;
  });
}

export function readAudioTracks(files) {
  return Promise.all(files.map(f => new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(f);
    const done = dur => { URL.revokeObjectURL(url); resolve({ name: f.name, dur }); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  })));
}

// Durations of remote tracks (seconds, 0 if unreadable). MP3 and MP4/M4B lengths are read
// from the file header with a few small Range requests; other formats (and any header that
// can't be parsed) fall back to loading the track's metadata in an <audio> element, which
// phones can be slow or unwilling to do in the background.
export async function readAudioDurations(urls) {
  const durationOf = async url => {
    const ext = (new URL(url).pathname.split('.').pop() || '').toLowerCase();
    try {
      const dur = ext === 'mp3' ? await mp3Duration(url) : ['m4a', 'm4b', 'mp4'].includes(ext) ? await mp4Duration(url) : 0;
      if (dur > 0) return dur;
    } catch (e) { console.warn('Header read failed', url, e); }
    return elementDuration(url);
  };
  const elementDuration = url => new Promise(resolve => {
    const a = new Audio();
    const timer = setTimeout(() => done(0), 120000);
    const done = dur => { clearTimeout(timer); a.removeAttribute('src'); a.load(); resolve(dur); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
  const out = new Array(urls.length);
  let next = 0;
  const worker = async () => { while (next < urls.length) { const i = next++; out[i] = await durationOf(urls[i]); } };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
  return out;
}

// Bytes start..end of a remote file, plus the file's total size.
async function rangeBytes(url, start, end) {
  const ctrl = new AbortController();
  // no-store: tiny cached fragments of the file would otherwise be stitched into the
  // <audio> element's later stream of the same URL.
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: ctrl.signal, cache: 'no-store' });
  // A server that ignores Range would send the whole file; don't download it.
  if (res.status !== 206) { ctrl.abort(); throw new Error('Range not supported (' + res.status + ')'); }
  const total = Number((res.headers.get('Content-Range') || '').split('/')[1]) || 0;
  return { view: new DataView(await res.arrayBuffer()), total };
}
const fourcc = (v, i) => String.fromCharCode(v.getUint8(i), v.getUint8(i + 1), v.getUint8(i + 2), v.getUint8(i + 3));

// MP4/M4A/M4B: walk the top-level boxes to 'moov', then read 'mvhd' (timescale + duration).
async function mp4Duration(url) {
  let pos = 0, total = Infinity;
  for (let n = 0; n < 64 && pos < total; n++) {
    const { view, total: t } = await rangeBytes(url, pos, pos + 15);
    if (t) total = t;
    if (view.byteLength < 8) return 0;
    let size = view.getUint32(0), hdr = 8;
    const type = fourcc(view, 4);
    if (size === 1 && view.byteLength >= 16) { size = view.getUint32(8) * 2 ** 32 + view.getUint32(12); hdr = 16; }
    else if (size === 0) size = total - pos;
    if (type === 'moov') {
      const { view: m } = await rangeBytes(url, pos + hdr, pos + hdr + 255);
      for (let i = 4; i + 36 <= m.byteLength; i++) {
        if (fourcc(m, i) !== 'mvhd') continue;
        const v1 = m.getUint8(i + 4) === 1;
        const scale = m.getUint32(i + (v1 ? 24 : 16));
        const dur = v1 ? m.getUint32(i + 28) * 2 ** 32 + m.getUint32(i + 32) : m.getUint32(i + 20);
        return scale ? dur / scale : 0;
      }
      return 0;
    }
    if (size < 8) return 0;
    pos += size;
  }
  return 0;
}

// MP3: skip the ID3 tag, find the first frame, then use its Xing/Info or VBRI frame count;
// without one the file is constant bitrate and the length follows from its size.
async function mp3Duration(url) {
  const { view: id3, total } = await rangeBytes(url, 0, 9);
  let start = 0;
  if (id3.byteLength >= 10 && fourcc(id3, 0).startsWith('ID3')) {
    const s = i => id3.getUint8(i) & 0x7f;
    start = 10 + ((s(6) << 21) | (s(7) << 14) | (s(8) << 7) | s(9)) + (id3.getUint8(5) & 0x10 ? 10 : 0);
  }
  const { view: v } = await rangeBytes(url, start, start + 16383);
  const len = v.byteLength;
  for (let i = 0; i + 4 <= len; i++) {
    const b2 = v.getUint8(i + 1);
    if (v.getUint8(i) !== 0xff || (b2 & 0xe0) !== 0xe0) continue;
    const ver = (b2 >> 3) & 3;      // 3 MPEG-1, 2 MPEG-2, 0 MPEG-2.5
    const layer = (b2 >> 1) & 3;    // 1 = Layer III
    const b3 = v.getUint8(i + 2), b4 = v.getUint8(i + 3);
    const brIdx = b3 >> 4, srIdx = (b3 >> 2) & 3;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const mpeg1 = ver === 3;
    const rate = [44100, 48000, 32000][srIdx] / (mpeg1 ? 1 : ver === 2 ? 2 : 4);
    const kbps = (mpeg1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[brIdx];
    const perFrame = mpeg1 ? 1152 : 576;
    const mono = b4 >> 6 === 3;
    const x = i + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    if (x + 12 <= len && ['Xing', 'Info'].includes(fourcc(v, x)) && v.getUint32(x + 4) & 1) return (v.getUint32(x + 8) * perFrame) / rate;
    if (i + 36 + 18 <= len && fourcc(v, i + 36) === 'VBRI') return (v.getUint32(i + 36 + 14) * perFrame) / rate;
    return total ? ((total - start - i) * 8) / (kbps * 1000) : 0;
  }
  return 0;
}

export const stripExt = name =>name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

// ---------- TXT ----------

function decode(buf) {
  let text = new TextDecoder('utf-8').decode(buf);
  if ((text.match(/�/g) || []).length > 5) text = new TextDecoder('windows-1252').decode(buf);
  return text.replace(/^﻿/, '');
}

const HEADING = /^(chapter|cap[ií]tulo|part|parte|book|livro|letter|carta|prologue|pr[oó]logo|epilogue|ep[ií]logo|preface|pref[aá]cio)\b/i;

function parseTxt(raw, fileName) {
  let text = raw.replace(/\r\n?/g, '\n');
  let title = '', author = '';

  // Project Gutenberg files: keep only the book body.
  const start = text.match(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  if (start) {
    const head = text.slice(0, start.index);
    title = (head.match(/^Title:\s*(.+)$/m) || [])[1] || '';
    author = (head.match(/^Author:\s*(.+)$/m) || [])[1] || '';
    text = text.slice(start.index + start[0].length);
    const end = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
    if (end > 0) text = text.slice(0, end);
  }

  let blocks = text.split(/\n\s*\n/);
  if (blocks.length < 3) blocks = text.split('\n');
  blocks = blocks.map(b => b.replace(/\s+/g, ' ').trim()).filter(b => b && !/^(table of )?contents\.?$|^(í|i)ndice$|^sum(á|a)rio$/i.test(b));

  let chapters = [];
  let cur = null;
  for (const b of blocks) {
    if (b.length < 80 && HEADING.test(b)) {
      cur = { title: b, paras: [] };
      chapters.push(cur);
    } else {
      if (!cur) { cur = { title: 'Opening', paras: [] }; chapters.push(cur); }
      cur.paras.push(b);
    }
  }
  // Headings with no text (e.g. a table of contents) are dropped.
  chapters = chapters.filter(c => c.paras.length);
  // No chapter headings found: split into equal parts instead.
  if (!chapters.length || (chapters.length === 1 && chapters[0].title === 'Opening')) chapters = chunk(blocks);

  return { title: title.trim() || stripExt(fileName), author: author.trim(), image: '', chapters };
}

function chunk(paras) {
  if (!paras.length) return [];
  const out = [];
  for (let i = 0; i < paras.length; i += PART_SIZE) {
    out.push({ title: `Part ${out.length + 1}`, paras: paras.slice(i, i + PART_SIZE) });
  }
  return out;
}

// ---------- EPUB ----------

let jszipPromise = null;
export function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSZIP_URL;
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => { jszipPromise = null; reject(new Error('Could not load the EPUB reader. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return jszipPromise;
}

const resolvePath = (base, href) => decodeURIComponent(new URL(href, 'http://x/' + base).pathname.slice(1));
const dirOf = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
const byTag = (doc, tag) => [...doc.getElementsByTagNameNS('*', tag)];
const clean = s => (s || '').replace(/\s+/g, ' ').trim();

async function parseEpub(file) {
  const JSZip = await loadJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch (e) { throw new Error('That EPUB file looks damaged.'); }

  const readText = async path => { const f = zip.file(path); return f ? f.async('text') : null; };
  const parseXml = s => new DOMParser().parseFromString(s, 'application/xml');
  const parseHtml = s => new DOMParser().parseFromString(s, 'text/html');

  const container = await readText('META-INF/container.xml');
  if (!container) throw new Error('That EPUB file is missing its table of contents.');
  const opfPath = parseXml(container).getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  const opfText = opfPath && await readText(opfPath);
  if (!opfText) throw new Error('That EPUB file is missing its table of contents.');
  const opf = parseXml(opfText);
  const base = dirOf(opfPath);

  const title = clean(byTag(opf, 'title')[0]?.textContent);
  const author = clean(byTag(opf, 'creator')[0]?.textContent);

  const items = {};
  for (const it of byTag(opf, 'item')) {
    items[it.getAttribute('id')] = {
      path: resolvePath(base, it.getAttribute('href')),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    };
  }
  const all = Object.values(items);

  // Chapter names from the EPUB3 nav document or the EPUB2 NCX.
  const tocTitles = {};
  const nav = all.find(i => i.props.split(' ').includes('nav'));
  const ncx = all.find(i => i.type === 'application/x-dtbncx+xml');
  if (nav) {
    const s = await readText(nav.path);
    if (s) for (const a of parseHtml(s).querySelectorAll('nav a[href]')) {
      const p = resolvePath(dirOf(nav.path), a.getAttribute('href').split('#')[0]);
      if (!tocTitles[p] && clean(a.textContent)) tocTitles[p] = clean(a.textContent);
    }
  } else if (ncx) {
    const s = await readText(ncx.path);
    if (s) for (const np of byTag(parseXml(s), 'navPoint')) {
      const src = np.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src');
      const label = clean(np.getElementsByTagNameNS('*', 'text')[0]?.textContent);
      if (!src || !label) continue;
      const p = resolvePath(dirOf(ncx.path), src.split('#')[0]);
      if (!tocTitles[p]) tocTitles[p] = label;
    }
  }

  const chapters = [];
  for (const ref of byTag(opf, 'itemref')) {
    const it = items[ref.getAttribute('idref')];
    if (!it) continue;
    const s = await readText(it.path);
    if (!s) continue;
    const body = parseHtml(s).body;
    if (!body) continue;
    const heading = clean(body.querySelector('h1, h2, h3')?.textContent);
    let paras = [...body.querySelectorAll('p, li, h4, h5, h6, pre')]
      .filter(el => !el.querySelector('p'))
      .map(el => clean(el.textContent))
      .filter(Boolean);
    if (!paras.length) paras = (body.textContent || '').split(/\n\s*\n/).map(clean).filter(Boolean);
    if (heading && paras[0] === heading) paras.shift();
    if (!paras.length) continue;
    chapters.push({ title: tocTitles[it.path] || heading || `Section ${chapters.length + 1}`, paras });
  }
  if (!chapters.length) throw new Error('No readable text was found in that EPUB.');

  // Cover: EPUB3 'cover-image' property, else the EPUB2 <meta name="cover">.
  let coverItem = all.find(i => i.props.split(' ').includes('cover-image'));
  if (!coverItem) {
    const id = byTag(opf, 'meta').find(m => m.getAttribute('name') === 'cover')?.getAttribute('content');
    if (id && items[id] && items[id].type.startsWith('image/')) coverItem = items[id];
  }
  let image = '';
  if (coverItem) {
    try {
      const blob = await zip.file(coverItem.path).async('blob');
      image = await scaleImage(new Blob([blob], { type: coverItem.type }));
    } catch (e) { /* a missing cover is fine */ }
  }

  return { title: title || stripExt(file.name), author, image, chapters };
}
