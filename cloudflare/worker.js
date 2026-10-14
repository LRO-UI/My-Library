// My Library cloud server: a Cloudflare Worker in front of an R2 bucket.
//
//   GET /catalog        → JSON list of every book and audiobook in the bucket
//   GET /file/<key>     → streams one file (supports Range, so audio can seek)
//
// Every request needs the access token, as ?t=<token> or "Authorization: Bearer <token>".
//
// Bucket layout:
//   books/<name>.epub            a book (.epub or .txt); an image with the same name is its cover
//   audio/<Audiobook name>/...   one audiobook per folder; tracks play in name order,
//                                any image in the folder (cover.jpg preferred) is the cover
//   audio/<name>.m4b             a single-file audiobook; an image with the same name is its cover
//
// Bindings (Worker → Settings → Bindings / Variables):
//   BUCKET  R2 bucket binding → your bucket ("library")
//   TOKEN   secret → any long random password; the app needs the same one

const BOOK = /\.(epub|txt)$/i;
const AUDIO = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const TYPES = {
  epub: 'application/epub+zip', txt: 'text/plain; charset=utf-8',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET' && req.method !== 'HEAD') return text('Method not allowed', 405);

    const url = new URL(req.url);
    const token = url.searchParams.get('t') || (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.TOKEN) return text('The TOKEN secret is not set on this Worker.', 500);
    if (!env.BUCKET) return text('The BUCKET binding is not set on this Worker.', 500);
    if (!safeEqual(token, env.TOKEN)) return text('Wrong or missing token', 401);

    if (url.pathname === '/catalog') return json(await catalog(env.BUCKET));
    if (url.pathname.startsWith('/file/')) return file(req, env.BUCKET, decodeURIComponent(url.pathname.slice(6)));
    return text('Not found', 404);
  },
};

// ---------- Catalog ----------

async function listAll(bucket) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const baseName = key => key.slice(key.lastIndexOf('/') + 1);
const stripExt = name => name.replace(/\.[^.]+$/, '');
const pretty = name => stripExt(name).replace(/[_]+/g, ' ').trim();
const byName = (a, b) => a.key.localeCompare(b.key, undefined, { numeric: true });

async function catalog(bucket) {
  const objects = (await listAll(bucket)).sort(byName);
  const keys = new Set(objects.map(o => o.key));
  // An image next to a file with the same name, e.g. books/Dune.epub + books/Dune.jpg
  const sameNameImage = key => ['jpg', 'jpeg', 'png', 'webp'].map(e => stripExt(key) + '.' + e).find(k => keys.has(k)) || null;

  const books = objects
    .filter(o => o.key.startsWith('books/') && BOOK.test(o.key))
    .map(o => ({ key: o.key, name: baseName(o.key), title: pretty(baseName(o.key)), size: o.size, cover: sameNameImage(o.key) }));

  const folders = new Map(); // 'audio/<folder>/' → { tracks, images }
  const audio = [];
  for (const o of objects) {
    if (!o.key.startsWith('audio/')) continue;
    const rest = o.key.slice(6);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      // A single file straight under audio/ is its own audiobook.
      if (AUDIO.test(rest)) audio.push({ id: o.key, title: pretty(rest), cover: sameNameImage(o.key), tracks: [{ key: o.key, name: rest, size: o.size }] });
      continue;
    }
    const id = 'audio/' + rest.slice(0, slash + 1);
    if (!folders.has(id)) folders.set(id, { title: rest.slice(0, slash), tracks: [], images: [] });
    const f = folders.get(id);
    if (AUDIO.test(o.key)) f.tracks.push({ key: o.key, name: baseName(o.key), size: o.size });
    else if (IMAGE.test(o.key)) f.images.push(o.key);
  }
  for (const [id, f] of folders) {
    if (!f.tracks.length) continue;
    const cover = f.images.find(k => /^(cover|folder|front)\./i.test(baseName(k))) || f.images[0] || null;
    audio.push({ id, title: f.title, cover, tracks: f.tracks });
  }
  audio.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));

  return { books, audio };
}

// ---------- Files ----------

async function file(req, bucket, key) {
  const obj = await bucket.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return text('Not found', 404);

  const headers = new Headers(CORS);
  obj.writeHttpMetadata(headers);
  if (!headers.get('Content-Type')) headers.set('Content-Type', TYPES[(key.split('.').pop() || '').toLowerCase()] || 'application/octet-stream');
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=86400');

  // onlyIf matched (e.g. If-None-Match): R2 returns the object without a body.
  if (!('body' in obj)) return new Response(null, { status: 304, headers });

  const size = obj.size;
  let start = 0, end = size - 1;
  const r = obj.range;
  const partial = req.headers.has('Range') && r;
  if (partial) {
    if ('suffix' in r) start = Math.max(0, size - r.suffix);
    else {
      start = r.offset || 0;
      if (r.length != null) end = start + r.length - 1;
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  return new Response(req.method === 'HEAD' ? null : obj.body, { status: partial ? 206 : 200, headers });
}

// ---------- Helpers ----------

function json(data) {
  return new Response(JSON.stringify(data), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(msg, status) {
  return new Response(msg, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
