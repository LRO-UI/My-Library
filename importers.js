// Turns user files into library content.
//   importBookFile(file)     → { title, author, image, chapters: [{ title, paras }] }
//   readAudioTracks(files)   → [{ name, dur }]   (seconds)
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

export const stripExt = name => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

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
  if (chapters.length <= 1) chapters = chunk(blocks);

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
