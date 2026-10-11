import { html, render, useState, useEffect, useRef, useMemo } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { db } from './db.js';
import { SEED_BOOKS, SEED_AUDIO } from './seed.js';
import { importBookFile, readAudioTracks, scaleImage, stripExt } from './importers.js';
import { Player } from './player.js';

// ===== Constants =====
const PREFS_KEY = 'my-library-prefs-v1';  // { theme, fontSize, lastId }
const SCROLL_KEY = 'my-library-scroll-v1'; // { [bookId]: 0..1 } scroll position within the chapter
const SWATCHES = [['Coral', '#E8605C'], ['Lavender', '#8C7BC4'], ['Sage', '#5BA56B'], ['Denim', '#46668F'], ['Teal', '#3E8A8C'], ['Honey', '#F2B33D'], ['Cocoa', '#8A6A5A'], ['Blush', '#E9A6A0']];
const GENRES = [['Romance', '#E8605C'], ['Adventure', '#46668F'], ['Classic', '#8A6A5A'], ['Fantasy', '#8C7BC4'], ['Gothic', '#3E8A8C']];
const EMPTY_CH = [{ title: 'Chapter 1', paras: ['This book has no content yet. Tap the pencil and import an EPUB or TXT file to start reading.'] }];
const THEME_COLOR = { light: '#FBF8F3', dark: '#1E1916' };

const newDraft = kind => kind === 'audio'
  ? { id: null, kind, title: 'New audiobook', author: 'Author', color: '#8C7BC4', genre: 'Classic', image: '', showText: true, tracks: [], len: 0, pos: 0 }
  : { id: null, kind, title: 'New book', author: 'Author', color: '#8C7BC4', genre: 'Classic', image: '', showText: true, chapter: 0 };
const DEFAULT_TITLES = ['New book', 'New audiobook', ''];

// ===== Helpers =====
const readJSON = (key, fallback) => { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }; } catch (e) { return fallback; } };
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Storage full', e); } };

function rgb(hex) {
  const h = (hex || '').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const isLight = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
const darken = ([r, g, b]) => `rgb(${[r, g, b].map(v => Math.round(v * 0.82)).join(',')})`;
const tint = ([r, g, b]) => `rgb(${[[r, 251], [g, 248], [b, 243]].map(([v, w]) => Math.round(v * 0.28 + w * 0.72)).join(',')})`;

const fmtLeft = sec => {
  const m = Math.max(0, Math.round(sec / 60));
  const h = Math.floor(m / 60);
  return (h ? h + 'h ' : '') + (m % 60) + 'm left';
};
const fmtDur = sec => (sec < 60 ? Math.round(sec) + 's' : fmtLeft(sec).replace(' left', ''));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const matches = (item, cat, q) => (cat === 'All' || item.genre === cat) && (!q || (item.title + ' ' + item.author).toLowerCase().includes(q));
const stop = fn => e => { e.stopPropagation(); fn(e); };

// ===== Icons (Lucide style) =====
const Svg = ({ size = 20, sw = 2, fill, children }) => html`
  <svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill ? 'currentColor' : 'none'} stroke=${fill ? 'none' : 'currentColor'}
    stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
const I = {
  book: p => html`<${Svg} ...${p}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></${Svg}>`,
  grid: p => html`<${Svg} ...${p}><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></${Svg}>`,
  bookmark: p => html`<${Svg} ...${p}><path d="M6 3h12v18l-6-4-6 4z" /></${Svg}>`,
  plus: p => html`<${Svg} sw="2.6" ...${p}><path d="M12 5v14M5 12h14" /></${Svg}>`,
  search: p => html`<${Svg} sw="2.2" ...${p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></${Svg}>`,
  x: p => html`<${Svg} sw="3" ...${p}><path d="M18 6 6 18M6 6l12 12" /></${Svg}>`,
  pencil: p => html`<${Svg} sw="2.2" ...${p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></${Svg}>`,
  play: p => html`<${Svg} fill ...${p}><path d="M7 4.5v15l13-7.5z" /></${Svg}>`,
  pause: p => html`<${Svg} fill ...${p}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></${Svg}>`,
  chevL: p => html`<${Svg} sw="2.2" ...${p}><path d="m15 18-6-6 6-6" /></${Svg}>`,
  chevR: p => html`<${Svg} sw="2.2" ...${p}><path d="m9 18 6-6-6-6" /></${Svg}>`,
  upload: p => html`<${Svg} sw="2.2" ...${p}><path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></${Svg}>`,
  file: p => html`<${Svg} sw="2.2" ...${p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></${Svg}>`,
  music: p => html`<${Svg} sw="2.2" ...${p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></${Svg}>`,
  trash: p => html`<${Svg} sw="2.2" ...${p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></${Svg}>`,
  sun: p => html`<${Svg} ...${p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></${Svg}>`,
  moon: p => html`<${Svg} ...${p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></${Svg}>`,
  headphones: p => html`<${Svg} sw="2.4" ...${p}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></${Svg}>`,
};

// ===== Covers =====
function BookCover({ color = '#E8605C', image, title, author, showText = true, flat = false, ribbon = true }) {
  const c = rgb(color);
  const light = isLight(c);
  const [r, g, b] = c;
  const amber = r > 220 && g > 150 && g < 210 && b < 110;
  const vars = {
    '--c': color, '--edge': darken(c),
    '--ink': light ? '#4A3B35' : '#FFFDF9',
    '--frame': light ? 'rgba(74,59,53,0.35)' : 'rgba(255,253,249,0.45)',
    '--ribbon': amber ? '#E8605C' : '#F2B33D',
  };
  return html`
    <div class=${'cover' + (flat ? ' flat' : '')} style=${vars}>
      ${!flat && html`<div class="cover-pages"></div>`}
      <div class="cover-face">
        ${image && html`<div class="cover-img" style=${{ backgroundImage: `url("${image}")` }}></div>`}
        ${!image && html`
          <div class="cover-frame">
            <div class="cover-title">${title || 'Untitled'}</div>
            <div class="cover-rule"></div>
            <div class="cover-author">${author}</div>
          </div>`}
        ${image && showText && html`
          <div class="cover-band">
            <div class="cover-title">${title || 'Untitled'}</div>
            <div class="cover-author">${author}</div>
          </div>`}
      </div>
      ${ribbon && html`<div class="cover-ribbon"></div>`}
    </div>`;
}

function CdCase({ color = '#8C7BC4', image, title, showText = true, badge = true, playing = false }) {
  const c = rgb(color);
  const light = isLight(c);
  const vars = {
    '--c': color, '--edge': darken(c), '--tint': tint(c),
    '--ink': light ? '#4A3B35' : '#FFFDF9',
    '--frame': light ? 'rgba(74,59,53,0.18)' : 'rgba(255,253,249,0.28)',
  };
  return html`
    <div class=${'cd' + (playing ? ' playing' : '')} style=${vars}>
      <div class="cd-tray"></div>
      <div class="cd-disc" style=${image ? { backgroundImage: `url("${image}")` } : null}>
        <div class="cd-sheen"></div>
        <div class="cd-groove"></div>
        ${(!image || showText) && html`<div class="cd-title">${title || 'Untitled'}</div>`}
        <div class="cd-hub"></div>
      </div>
      <div class="cd-front"></div>
      ${badge && html`<div class="cd-sticker"><span>AUDIO</span><span>BOOK</span></div>`}
    </div>`;
}

// ===== App =====
function App() {
  const [ready, setReady] = useState(false);
  const [books, setBooks] = useState([]);
  const [audio, setAudio] = useState([]);
  const [prefs, setPrefs] = useState(() => readJSON(PREFS_KEY, { theme: 'light', fontSize: 19, lastId: 'b1' }));
  const [view, setView] = useState('home');
  const [readerId, setReaderId] = useState(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [draft, setDraft] = useState(null);
  const [sheetShown, setSheetShown] = useState(false);
  const [typeShown, setTypeShown] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [toast, setToast] = useState('');

  const scrollRef = useRef(null);
  const readerRef = useRef(null);
  const closeTimer = useRef(0);
  const pendingAudio = useRef(null); // File[] picked in the editor, written on Save
  const scrollPos = useRef(readJSON(SCROLL_KEY, {}));
  const scrollSaveTimer = useRef(0);
  const audioRef = useRef(audio);
  audioRef.current = audio;

  const isDark = prefs.theme === 'dark';
  const setPref = patch => setPrefs(p => ({ ...p, ...patch }));

  // --- Load & persist ---
  useEffect(() => {
    (async () => {
      let b = null, a = null;
      try { [b, a] = await Promise.all([db.get('books'), db.get('audio')]); } catch (e) { console.warn('Could not open storage', e); }
      setBooks(b || SEED_BOOKS);
      setAudio(a || SEED_AUDIO);
      setReady(true);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    })();
  }, []);

  useEffect(() => { if (ready) db.set('books', books).catch(e => console.warn(e)); }, [books]);

  // Audio positions change every second while playing, so saves are batched.
  const audioSaveTimer = useRef(0);
  const flushAudio = () => { clearTimeout(audioSaveTimer.current); audioSaveTimer.current = 0; db.set('audio', audioRef.current).catch(e => console.warn(e)); };
  useEffect(() => {
    if (ready && !audioSaveTimer.current) audioSaveTimer.current = setTimeout(flushAudio, 3000);
  }, [audio]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && audioSaveTimer.current) flushAudio(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); };
  }, []);

  useEffect(() => {
    writeJSON(PREFS_KEY, prefs);
    document.documentElement.dataset.theme = prefs.theme;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', THEME_COLOR[prefs.theme]);
  }, [prefs]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [view]);

  const flash = msg => { setToast(msg); setTimeout(() => setToast(t => (t === msg ? '' : t)), 2600); };

  // --- Player ---
  const player = useMemo(() => new Player({
    onTime: (id, pos) => setAudio(list => {
      const a = list.find(x => x.id === id);
      if (!a || Math.floor(a.pos) === Math.floor(pos)) return list;
      return list.map(x => (x.id === id ? { ...x, pos } : x));
    }),
    onState: id => setPlayingId(id),
  }), []);

  // --- Android back button: each overlay pushes a history entry ---
  const layers = useRef([]);
  const closers = useRef({});
  closers.current = {
    library: () => setView('home'),
    reader: () => { setReaderId(null); setTypeShown(false); },
    type: () => setTypeShown(false),
    editor: () => {
      setSheetShown(false);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => { setDraft(null); pendingAudio.current = null; }, 320);
    },
  };
  const pushLayer = name => { layers.current.push(name); history.pushState({ layer: name }, ''); };
  const popLayer = name => {
    if (layers.current[layers.current.length - 1] === name) history.back();
    else closers.current[name]();
  };
  useEffect(() => {
    const onPop = () => { const name = layers.current.pop(); if (name) closers.current[name](); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // --- Navigation ---
  const goView = v => {
    if (v === view) return;
    if (v === 'library') { setView('library'); pushLayer('library'); }
    else popLayer('library');
  };
  const openBook = id => {
    setReaderId(id);
    setPref({ lastId: id });
    setTypeShown(false);
    pushLayer('reader');
  };
  const openType = () => { setTypeShown(true); pushLayer('type'); };

  // --- Reader ---
  const vm = b => {
    const chs = b.chapters && b.chapters.length ? b.chapters : EMPTY_CH;
    const ch = Math.min(b.chapter || 0, chs.length - 1);
    return { ...b, chs, ch, pct: Math.round(((ch + 1) / chs.length) * 100) + '%', chapterLabel: `Chapter ${ch + 1} of ${chs.length}` };
  };
  const setChapter = (id, ch) => {
    setBooks(list => list.map(b => (b.id === id ? { ...b, chapter: ch } : b)));
    scrollPos.current[id] = 0;
    writeJSON(SCROLL_KEY, scrollPos.current);
    if (readerRef.current) readerRef.current.scrollTop = 0;
  };
  useEffect(() => {
    const el = readerRef.current;
    if (!readerId || !el) return;
    requestAnimationFrame(() => { el.scrollTop = (scrollPos.current[readerId] || 0) * (el.scrollHeight - el.clientHeight); });
  }, [readerId]);
  const onReaderScroll = e => {
    const el = e.currentTarget;
    scrollPos.current[readerId] = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => writeJSON(SCROLL_KEY, scrollPos.current), 400);
  };

  // --- Audiobooks ---
  const toggleAudio = async a => {
    if (playingId === a.id) { player.pause(); return; }
    if (!a.tracks || !a.tracks.length) { flash('Add an audio file to play this CD'); edit(a, 'audio'); return; }
    try { await player.play(a); } catch (e) { if (e.name !== 'AbortError') flash(e.message); }
  };

  // --- Editor ---
  const edit = (item, kind = 'book') => {
    clearTimeout(closeTimer.current);
    pendingAudio.current = null;
    setDraft(item ? { ...item, kind } : newDraft(kind));
    setSheetShown(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setSheetShown(true)));
    pushLayer('editor');
  };
  const closeEdit = () => popLayer('editor');
  const patchDraft = patch => setDraft(d => ({ ...d, ...patch }));
  const switchKind = kind => setDraft(d => {
    if (d.kind === kind) return d;
    pendingAudio.current = null;
    const fresh = newDraft(kind);
    return { ...fresh, title: DEFAULT_TITLES.includes(d.title) ? fresh.title : d.title, author: d.author, color: d.color, genre: d.genre, image: d.image, showText: d.showText };
  });

  const onImageFile = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { patchDraft({ image: await scaleImage(f) }); } catch (err) { flash(err.message); }
  };

  const onBookFile = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setToast('Importing…');
    try {
      const r = await importBookFile(f);
      setDraft(d => ({
        ...d,
        chapters: r.chapters, chapter: 0, source: f.name,
        title: DEFAULT_TITLES.includes(d.title) && r.title ? r.title : d.title,
        author: (d.author === 'Author' || !d.author) && r.author ? r.author : d.author,
        image: d.image || r.image,
      }));
      flash(`Imported ${plural(r.chapters.length, 'chapter', 'chapters')}`);
    } catch (err) { flash(err.message); }
  };

  const onAudioFiles = async e => {
    const files = [...(e.target.files || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    e.target.value = '';
    if (!files.length) return;
    setToast('Reading audio…');
    const tracks = await readAudioTracks(files);
    pendingAudio.current = files;
    const guess = files.length === 1 ? stripExt(files[0].name) : stripExt(files[0].name).replace(/[\s\-_.]*\d+$/, '');
    setDraft(d => ({
      ...d, tracks, pos: 0, len: tracks.reduce((s, t) => s + t.dur, 0),
      title: DEFAULT_TITLES.includes(d.title) && guess ? guess : d.title,
    }));
    setToast('');
  };

  const saveEdit = async () => {
    const d = draft;
    if (!d) return;
    const { kind, ...item } = d;
    if (kind === 'book') {
      setBooks(list => (item.id ? list.map(b => (b.id === item.id ? item : b)) : [...list, { ...item, id: 'b' + Date.now() }]));
    } else {
      const id = item.id || 'a' + Date.now();
      if (pendingAudio.current) {
        setToast('Saving audio…');
        try {
          if (player.item && player.item.id === id) player.stop();
          await db.deleteFiles(id);
          await Promise.all(pendingAudio.current.map((f, i) => db.putFile(`${id}:${i}`, f)));
        } catch (err) {
          flash('Could not save the audio: ' + err.message);
          return;
        }
        setToast('');
      }
      const rec = { ...item, id };
      setAudio(list => (item.id ? list.map(a => (a.id === id ? rec : a)) : [...list, rec]));
    }
    closeEdit();
  };

  const deleteItem = async () => {
    const d = draft;
    if (!d || !d.id || !confirm(`Delete “${d.title}” from your library?`)) return;
    if (d.kind === 'book') {
      const rest = books.filter(b => b.id !== d.id);
      setBooks(rest);
      if (prefs.lastId === d.id) setPref({ lastId: rest[0] ? rest[0].id : null });
    } else {
      if (player.item && player.item.id === d.id) player.stop();
      db.deleteFiles(d.id).catch(e => console.warn(e));
      setAudio(list => list.filter(a => a.id !== d.id));
    }
    closeEdit();
  };

  if (!ready) return html`<div class="shell"></div>`;

  // --- Derived ---
  const isHome = view === 'home';
  const q = query.trim().toLowerCase();
  const all = books.map(vm);
  const shelf = all.filter(b => matches(b, cat, q));
  const current = all.find(b => b.id === prefs.lastId) || all[0];
  const audioList = audio.filter(a => matches(a, cat, q));
  const rb = readerId && all.find(b => b.id === readerId);
  const showCarousel = isHome && shelf.length > 0;
  const showGrid = !isHome;

  // --- Pieces ---
  const editBadge = (onClick, size = 13) => html`
    <button class="badge-edit" title="Edit cover" onClick=${stop(onClick)}><${I.pencil} size=${size} sw="2.4" /></button>`;

  const chips = (active, onPick, withAll) => (withAll ? [['All', '#F2B33D'], ...GENRES] : GENRES).map(([label, dot]) => html`
    <button class=${'chip' + (active === label ? ' on' : '')} onClick=${() => onPick(label)}>
      ${withAll && html`<span class="chip-dot" style=${{ background: dot }}></span>`}
      ${label}
    </button>`);

  const renderShelfView = () => html`
    <div class="scroll hide-scroll" ref=${scrollRef}>
      <header class="hdr">
        <div class="hdr-left">
          <div class="brand"><${I.book} size="19" /></div>
          <h1>${isHome ? 'Reading' : 'Library'}</h1>
        </div>
        <button class="theme-btn" title="Toggle theme" onClick=${() => setPref({ theme: isDark ? 'light' : 'dark' })}>
          ${isDark ? html`<${I.sun} size="19" />` : html`<${I.moon} size="19" />`}
        </button>
      </header>

      <label class="search">
        <${I.search} size="19" />
        <input value=${query} onInput=${e => setQuery(e.target.value)} placeholder="Search for books" type="search" enterkeyhint="search" />
        ${query && html`<button class="search-clear" title="Clear" onClick=${e => { e.preventDefault(); setQuery(''); }}><${I.x} size="12" /></button>`}
      </label>

      <div class="chips bleed hide-scroll">${chips(cat, setCat, true)}</div>

      ${isHome && current && !q && cat === 'All' && html`
        <section class="continue">
          <div class="cover-tap" onClick=${() => openBook(current.id)}>
            <${BookCover} ...${current} />
          </div>
          <div class="continue-body">
            <div class="kicker">Continue reading</div>
            <div style="display:flex; flex-direction:column; gap:3px; min-width:0;">
              <h2>${current.title}</h2>
              <div class="author" style="font-size:13px;">${current.author}</div>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <div class="bar" style="height:8px;"><span style=${{ width: current.pct }}></span></div>
              <div class="caption">${current.pct} · ${current.chapterLabel}</div>
            </div>
            <div class="btn-row">
              <button class="btn-coral" style="flex:1;" onClick=${() => openBook(current.id)}><${I.play} size="14" /> Keep reading</button>
              <button class="btn-round surface" title="Edit cover" onClick=${() => edit(current)}><${I.pencil} size="16" /></button>
            </div>
          </div>
        </section>`}

      <section class="section">
        <div class="section-hd">
          <h2>${isHome ? 'Your shelf' : plural(books.length, 'book', 'books')}</h2>
          ${isHome && html`<button class="pill" onClick=${() => goView('library')}>View all</button>`}
        </div>

        ${showCarousel && html`
          <div class="carousel bleed hide-scroll">
            ${shelf.map(b => html`
              <div class="shelf-card" key=${b.id}>
                <div class="cover-tap press" onClick=${() => openBook(b.id)}>
                  <${BookCover} ...${b} />
                  ${editBadge(() => edit(b))}
                </div>
                <div class="card-text">
                  <div class="t ellipsis">${b.title}</div>
                  <div class="a author ellipsis">${b.author}</div>
                </div>
                <div class="pct-row">
                  <div class="bar"><span style=${{ width: b.pct }}></span></div>
                  <span class="lbl">${b.pct}</span>
                </div>
              </div>`)}
          </div>`}

        ${showGrid && html`
          <div class="grid">
            <button class="add-tile" onClick=${() => edit(null)}>
              <span class="plus"><${I.plus} size="18" /></span>
              <span>Add a book</span>
            </button>
            ${shelf.map(b => html`
              <div class="grid-card" key=${b.id}>
                <div class="cover-tap press" onClick=${() => openBook(b.id)}>
                  <${BookCover} ...${b} />
                  ${editBadge(() => edit(b), 12)}
                </div>
                <div class="card-text">
                  <div class="t ellipsis">${b.title}</div>
                  <div class="a author ellipsis">${b.author}</div>
                </div>
                <div class="bar"><span style=${{ width: b.pct }}></span></div>
              </div>`)}
          </div>`}

        ${shelf.length === 0 && isHome && html`<div class="empty">No books found. Try another search or category.</div>`}
      </section>

      ${isHome && audioList.length > 0 && html`
        <section class="section" style="gap:0;">
          <div class="section-hd">
            <h2>Audiobooks</h2>
            <span class="pill muted"><${I.headphones} size="14" /> ${plural(audioList.length, 'CD', 'CDs')}</span>
          </div>
          <div class="carousel audio-row bleed hide-scroll">
            ${audioList.map(a => {
              const playing = playingId === a.id;
              const done = a.len > 0 && a.pos >= a.len;
              const status = !a.len ? 'No audio yet'
                : done ? 'Finished'
                : playing ? 'Playing · ' + fmtLeft(a.len - a.pos)
                : a.pos === 0 ? 'Not started · ' + fmtLeft(a.len)
                : fmtLeft(a.len - a.pos);
              return html`
                <div class="audio-card" key=${a.id}>
                  <div class="cover-tap press" title=${playing ? 'Pause' : 'Play'} onClick=${() => toggleAudio(a)}>
                    <${CdCase} ...${a} playing=${playing} />
                    ${editBadge(() => edit(a, 'audio'))}
                    <span class=${'play-btn' + (playing ? ' playing' : '')}>
                      ${playing ? html`<${I.pause} size="14" />` : html`<${I.play} size="14" />`}
                    </span>
                  </div>
                  <div class="card-text">
                    <div class="t ellipsis">${a.title}</div>
                    <div class="a author ellipsis">${a.author}</div>
                  </div>
                  <div class="audio-meta">
                    <div class="bar"><span style=${{ width: (a.len ? Math.round((a.pos / a.len) * 100) : 0) + '%' }}></span></div>
                    <span class=${'status' + (playing ? ' playing' : '')}>${status}</span>
                  </div>
                </div>`;
            })}
          </div>
        </section>`}
    </div>

    <nav class="tabbar">
      <div>
        <button class=${'tab' + (isHome ? ' on' : '')} onClick=${() => goView('home')}>
          <span class="ico"><${I.grid} /></span><span>Home</span>
        </button>
      </div>
      <div>
        <button class="fab" title="New" onClick=${() => edit(null)}><${I.plus} size="22" /></button>
      </div>
      <div>
        <button class=${'tab' + (!isHome ? ' on' : '')} onClick=${() => goView('library')}>
          <span class="ico"><${I.bookmark} /></span><span>Library</span>
        </button>
      </div>
    </nav>`;

  const renderReader = () => {
    const c = rb.chs[rb.ch];
    const first = rb.ch === 0;
    const last = rb.ch >= rb.chs.length - 1;
    return html`
      <div class="reader">
        <div class="reader-top">
          <button class="btn-round" title="Back to shelf" onClick=${() => popLayer('reader')}><${I.chevL} /></button>
          <div class="mid">
            <div class="t ellipsis">${rb.title}</div>
            <div class="a author ellipsis">${rb.author}</div>
          </div>
          <button class="btn-round aa-btn" title="Reading settings" onClick=${openType}><span>A</span><span>a</span></button>
        </div>

        <article class="article hide-scroll" ref=${readerRef} onScroll=${onReaderScroll}>
          <div class="chapter-hd">
            <div class="kicker">${rb.chapterLabel}</div>
            <h2>${c.title}</h2>
          </div>
          <div class="prose" style=${{ fontSize: prefs.fontSize + 'px' }}>
            ${c.paras.map(p => html`<p>${p}</p>`)}
          </div>
        </article>

        <footer class="reader-foot">
          <button class="btn-round" title="Previous chapter" disabled=${first} onClick=${() => setChapter(rb.id, Math.max(0, rb.ch - 1))}><${I.chevL} /></button>
          <div class="mid">
            <div class="bar"><span style=${{ width: rb.pct }}></span></div>
            <div class="lbls"><span>${rb.chapterLabel}</span><span>${rb.pct}</span></div>
          </div>
          <button class="btn-coral next-btn" title="Next chapter" disabled=${last} onClick=${() => setChapter(rb.id, Math.min(rb.chs.length - 1, rb.ch + 1))}>
            Next <${I.chevR} size="18" />
          </button>
        </footer>

        <div class=${'overlay' + (typeShown ? ' on' : '')} onClick=${() => popLayer('type')}></div>
        <div class=${'type-sheet' + (typeShown ? ' on' : '')} inert=${!typeShown}>
          <div class="grabber"></div>
          <div class="sheet-hd">
            <h3>Reading settings</h3>
            <button class="btn-round" title="Close" onClick=${() => popLayer('type')}><${I.x} size="16" sw="2.4" /></button>
          </div>
          <div class="field">
            <span class="label">Text size</span>
            <div class="size-ctl">
              <button title="Smaller text" style="font-size:14px;" onClick=${() => setPref({ fontSize: Math.max(14, prefs.fontSize - 1) })}>A</button>
              <div class="meter">
                <div class="bar"><span style=${{ width: Math.round(((prefs.fontSize - 14) / 14) * 100) + '%' }}></span></div>
                <span class="num">${prefs.fontSize}</span>
              </div>
              <button title="Larger text" style="font-size:21px;" onClick=${() => setPref({ fontSize: Math.min(28, prefs.fontSize + 1) })}>A</button>
            </div>
          </div>
          <div class="field">
            <span class="label">Theme</span>
            <div class="segment">
              ${[['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => html`
                <button class=${prefs.theme === v ? 'on' : ''} onClick=${() => setPref({ theme: v })}>${label}</button>`)}
            </div>
          </div>
        </div>
      </div>`;
  };

  const renderEditor = () => {
    const d = draft;
    const isAudio = d.kind === 'audio';
    const isNew = !d.id;
    const preset = SWATCHES.some(([, h]) => h.toLowerCase() === d.color.toLowerCase());
    const chCount = d.chapters ? d.chapters.length : 0;
    return html`
      <div class=${'overlay blur' + (sheetShown ? ' on' : '')} onClick=${closeEdit}></div>
      <div class=${'edit-sheet' + (sheetShown ? ' on' : '')}>
        <div class="edit-hd">
          <div class="grabber"></div>
          <div class="row">
            <button class="btn-cancel" onClick=${closeEdit}>Cancel</button>
            <h3>${isNew ? (isAudio ? 'New audiobook' : 'New book') : 'Edit cover'}</h3>
            <button class="btn-save" onClick=${saveEdit}>Save</button>
          </div>
        </div>

        <div class="edit-body hide-scroll">
          ${isNew && html`
            <div class="segment">
              <button class=${!isAudio ? 'on' : ''} onClick=${() => switchKind('book')}>Book</button>
              <button class=${isAudio ? 'on' : ''} onClick=${() => switchKind('audio')}>Audiobook</button>
            </div>`}

          <div class="preview">
            <div style=${{ width: isAudio ? '160px' : '140px', paddingTop: isAudio ? '24px' : 0 }}>
              ${isAudio ? html`<${CdCase} ...${d} />` : html`<${BookCover} ...${d} />`}
            </div>
            <div class="cap">Live preview</div>
          </div>

          <label class="field">
            <span class="label">Title</span>
            <input class="input" value=${d.title} onInput=${e => patchDraft({ title: e.target.value })} />
          </label>
          <label class="field">
            <span class="label">Author</span>
            <input class="input" value=${d.author} onInput=${e => patchDraft({ author: e.target.value })} />
          </label>

          ${!isAudio && html`
            <div class="field" style="gap:8px;">
              <span class="label">Book file</span>
              <label class="upload">
                <span class="ico"><${I.file} /></span>
                <span class="txt">
                  <b>${chCount ? 'Replace book file' : 'Import a book'}</b>
                  <small class="ellipsis">${chCount ? `${d.source || 'Imported'} · ${plural(chCount, 'chapter', 'chapters')}` : 'EPUB or TXT'}</small>
                </span>
                <input type="file" accept=".epub,.txt,application/epub+zip,text/plain" onChange=${onBookFile} />
              </label>
            </div>`}

          ${isAudio && html`
            <div class="field" style="gap:8px;">
              <span class="label">Audio</span>
              <label class="upload">
                <span class="ico"><${I.music} /></span>
                <span class="txt">
                  <b>${d.tracks && d.tracks.length ? 'Replace audio' : 'Add audio files'}</b>
                  <small class="ellipsis">${d.tracks && d.tracks.length ? `${plural(d.tracks.length, 'track', 'tracks')} · ${fmtDur(d.len)}` : 'One file, or every track in order'}</small>
                </span>
                <input type="file" accept="audio/*,.m4b" multiple onChange=${onAudioFiles} />
              </label>
            </div>`}

          <div class="field" style="gap:8px;">
            <span class="label">Cover image</span>
            <div class="upload-row">
              <label class="upload">
                <span class="ico"><${I.upload} /></span>
                <span class="txt">
                  <b>${d.image ? 'Replace image' : 'Upload an image'}</b>
                  <small>From photos or files</small>
                </span>
                <input type="file" accept="image/*" onChange=${onImageFile} />
              </label>
              ${d.image && html`<button class="btn-trash" title="Remove image" onClick=${() => patchDraft({ image: '' })}><${I.trash} size="18" /></button>`}
            </div>
            ${d.image && html`
              <button class="switch-row" onClick=${() => patchDraft({ showText: !d.showText })}>
                Show title over the image
                <span class=${'switch' + (d.showText ? ' on' : '')}></span>
              </button>`}
          </div>

          <div class="field">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span class="label">${isAudio ? 'CD colour' : 'Book colour'}</span>
              <span class="hex">${d.color}</span>
            </div>
            <div class="swatches">
              ${SWATCHES.map(([name, hex]) => html`
                <button class=${'swatch' + (d.color.toLowerCase() === hex.toLowerCase() ? ' on' : '')} title=${name}
                  style=${{ background: hex }} onClick=${() => patchDraft({ color: hex })}></button>`)}
              <label class=${'swatch swatch-custom' + (!preset ? ' on' : '')} title="Custom colour">
                <${I.plus} size="14" />
                <input type="color" value=${d.color} onInput=${e => patchDraft({ color: e.target.value })} />
              </label>
            </div>
          </div>

          <div class="field">
            <span class="label">Category</span>
            <div class="chips-wrap">${chips(d.genre, g => patchDraft({ genre: g }), false)}</div>
          </div>

          ${!isNew && html`<button class="btn-delete" onClick=${deleteItem}>${isAudio ? 'Delete audiobook' : 'Delete book'}</button>`}
        </div>
      </div>`;
  };

  return html`
    <div class="shell">
      ${rb ? renderReader() : renderShelfView()}
      ${draft && renderEditor()}
      ${toast && html`<div class="toast" role="status">${toast}</div>`}
    </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
