import { html, render, Component, useState, useEffect, useRef, useMemo } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { db } from './db.js';
import { SEED_BOOKS, SEED_AUDIO, SEED_TAGS, RETIRED_SEEDS } from './seed.js';
import { importBookFile, readAudioTracks, scaleImage, stripExt } from './importers.js';
import { Player } from './player.js';
import { exportBackup, readBackup, backupName, download } from './backup.js';

// ===== Constants =====
const PREFS_KEY = 'my-library-prefs-v1';  // { theme, fontSize, lastId, lastAudioId }
const SCROLL_KEY = 'my-library-scroll-v1'; // { [bookId]: 0..1 } scroll position within the chapter
const SWATCHES = [['Coral', '#E8605C'], ['Lavender', '#8C7BC4'], ['Sage', '#5BA56B'], ['Denim', '#46668F'], ['Teal', '#3E8A8C'], ['Honey', '#F2B33D'], ['Cocoa', '#8A6A5A'], ['Blush', '#E9A6A0']];
const EMPTY_CH = [{ title: 'Chapter 1', paras: ['This book has no content yet. Tap the pencil and import an EPUB or TXT file to start reading.'] }];
const THEME_COLOR = { light: '#FBF8F3', dark: '#1E1916' };
const TAG_MAX = 24;
const AUDIO_FORMATS = 'MP3, M4A, M4B, OGG, Opus, FLAC or WAV';
const SHARE_KEY = 'share:pending'; // files handed over by the share target (see sw.js)
const TEXT_KEY = id => 'text:' + id; // a book's chapters live in their own record, loaded when it is opened
const SEED_VERSION = 2;              // bump when samples change; see RETIRED_SEEDS
const TEXT_CACHE_SIZE = 3;
const isBookFile = f => /\.(epub|txt)$/i.test(f.name) || f.type === 'application/epub+zip' || f.type === 'text/plain';
const isAudioFile = f => f.type.startsWith('audio/') || /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav)$/i.test(f.name);
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const guessTitle = files => (files.length === 1 ? stripExt(files[0].name) : stripExt(files[0].name).replace(/[\s\-_.]*\d+$/, ''));
const fmtBytes = n => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

const newDraft = kind => kind === 'audio'
  ? { id: null, kind, title: 'New audiobook', author: 'Author', color: '#8C7BC4', tags: [], image: '', showText: true, tracks: [], len: 0, pos: 0 }
  : { id: null, kind, title: 'New book', author: 'Author', color: '#8C7BC4', tags: [], image: '', showText: true, chapter: 0 };
const DEFAULT_TITLES = ['New book', 'New audiobook', ''];

// Items saved before tags existed had a single `genre`.
const withTags = ({ genre, ...item }) => ({ ...item, tags: item.tags || (genre ? [genre] : []) });
// Book records keep only a chapter count; the chapters themselves are stored under TEXT_KEY.
const withoutText = ({ chapters, ...book }) => (chapters ? { ...book, chCount: chapters.length } : book);

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
const matches = (item, cat, q) => (cat === 'All' || item.tags.includes(cat)) && (!q || [item.title, item.author, ...item.tags].join(' ').toLowerCase().includes(q));
const stop = fn => e => { e.stopPropagation(); fn(e); };

// ===== Icons (Lucide style) =====
const Svg = ({ size = 20, sw = 2, fill, children }) => html`
  <svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill ? 'currentColor' : 'none'} stroke=${fill ? 'none' : 'currentColor'}
    stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
const I = {
  book: p => html`<${Svg} ...${p}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></${Svg}>`,
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
  rewind: p => html`<${Svg} sw="2.2" ...${p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></${Svg}>`,
  forward: p => html`<${Svg} sw="2.2" ...${p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></${Svg}>`,
  check: p => html`<${Svg} sw="2.6" ...${p}><path d="M20 6 9 17l-5-5" /></${Svg}>`,
  archive: p => html`<${Svg} ...${p}><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></${Svg}>`,
  download: p => html`<${Svg} sw="2.2" ...${p}><path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></${Svg}>`,
  share: p => html`<${Svg} sw="2.2" ...${p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></${Svg}>`,
  headphones: p => html`<${Svg} sw="2.4" ...${p}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></${Svg}>`,
};

// ===== Covers =====
function BookCover({ color = '#E8605C', image, title, author, ribbon = true }) {
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
    <div class="cover" style=${vars}>
      <div class="cover-pages"></div>
      <div class="cover-face">
        ${image && html`<div class="cover-img" style=${{ backgroundImage: `url("${image}")` }}></div>`}
        ${!image && html`
          <div class="cover-frame">
            <div class="cover-title">${title || 'Untitled'}</div>
            <div class="cover-rule"></div>
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

// The chapter text. The app re-renders every second while an audiobook plays,
// so this skips re-diffing what can be hundreds of paragraphs.
class Prose extends Component {
  shouldComponentUpdate(next) { return next.paras !== this.props.paras || next.size !== this.props.size; }
  render({ paras, size }) {
    return html`<div class="prose" style=${{ fontSize: size + 'px' }}>${paras.map(p => html`<p>${p}</p>`)}</div>`;
  }
}

// ===== App =====
function App() {
  const [ready, setReady] = useState(false);
  const [books, setBooks] = useState([]);
  const [audio, setAudio] = useState([]);
  const [tags, setTags] = useState([]); // [{ name, color }]
  const [prefs, setPrefs] = useState(() => readJSON(PREFS_KEY, { theme: 'light', fontSize: 19, lastId: 'b1', lastAudioId: 'a1' }));
  const [view, setView] = useState('books'); // 'books' | 'audio'
  const [readerId, setReaderId] = useState(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All');
  const [draft, setDraft] = useState(null);
  const [sheetShown, setSheetShown] = useState(false);
  const [typeShown, setTypeShown] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [toast, setToast] = useState('');
  const [tagInput, setTagInput] = useState(null); // null = closed, string = new tag name being typed
  const [manageTags, setManageTags] = useState(false);
  const [libShown, setLibShown] = useState(false);
  const [withAudio, setWithAudio] = useState(true);
  const [usage, setUsage] = useState(null); // bytes used by the app, from navigator.storage
  const [text, setText] = useState(null);   // { id, chapters } for the book open in the reader

  const scrollRef = useRef(null);
  const readerRef = useRef(null);
  const tagInputRef = useRef(null);
  const closeTimer = useRef(0);
  const pendingAudio = useRef(null); // File[] picked in the editor, written on Save
  const scrollPos = useRef(readJSON(SCROLL_KEY, {}));
  const scrollSaveTimer = useRef(0);
  const textCache = useRef(new Map()); // recently opened books' chapters
  const audioRef = useRef(audio);
  audioRef.current = audio;

  const isDark = prefs.theme === 'dark';
  const setPref = patch => setPrefs(p => ({ ...p, ...patch }));

  // --- Load & persist ---
  useEffect(() => {
    (async () => {
      let b = null, a = null, t = null, seedVersion = null;
      try { [b, a, t, seedVersion] = await Promise.all([db.get('books'), db.get('audio'), db.get('tags'), db.get('seedVersion')]); } catch (e) { console.warn('Could not open storage', e); }
      let bookList = (b || SEED_BOOKS).map(withTags);
      let audioList = (a || SEED_AUDIO).map(withTags);
      try {
        // Older installs: drop sample items that were never edited.
        if (b && seedVersion !== SEED_VERSION) {
          const retired = x => RETIRED_SEEDS.includes(x.id) && !x.image && !x.source && !(x.tracks && x.tracks.length);
          const gone = bookList.filter(retired).map(x => x.id);
          bookList = bookList.filter(x => !retired(x));
          audioList = audioList.filter(x => !retired(x));
          await Promise.all(gone.map(id => db.del(TEXT_KEY(id))));
        }
        // Move chapter text out of the book records (first run, or data from before v2).
        await Promise.all(bookList.filter(x => x.chapters).map(x => db.set(TEXT_KEY(x.id), x.chapters)));
        await db.set('seedVersion', SEED_VERSION);
      } catch (e) { console.warn('Migration failed', e); }
      setBooks(bookList.map(withoutText));
      setAudio(audioList);
      setTags(t || SEED_TAGS);
      setReady(true);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    })();
  }, []);

  useEffect(() => { if (ready) db.set('books', books).catch(e => console.warn(e)); }, [books]);
  useEffect(() => {
    if (!ready || !new URLSearchParams(location.search).has('shared')) return;
    history.replaceState(null, '', location.pathname);
    (async () => {
      const files = await db.getFile(SHARE_KEY).catch(() => null);
      await db.deleteFiles('share').catch(() => {});
      if (files && files.length) importFiles(files);
    })();
  }, [ready]);
  useEffect(() => { if (ready) db.set('tags', tags).catch(e => console.warn(e)); }, [tags]);

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
  useEffect(() => { if (tagInput === '' && tagInputRef.current) tagInputRef.current.focus(); }, [tagInput === '']);

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
    audio: () => { setView('books'); setCat('All'); },
    reader: () => { setReaderId(null); setTypeShown(false); },
    type: () => setTypeShown(false),
    lib: () => setLibShown(false),
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
    if (v === 'audio') { setView('audio'); setCat('All'); pushLayer('audio'); }
    else popLayer('audio');
  };
  const openBook = id => {
    setReaderId(id);
    setText(null);
    getText(id).then(chapters => setText({ id, chapters }));
    setPref({ lastId: id });
    setTypeShown(false);
    pushLayer('reader');
  };
  const openType = () => { setTypeShown(true); pushLayer('type'); };
  const openLib = () => {
    setLibShown(true);
    pushLayer('lib');
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => setUsage(e.usage)).catch(() => {});
  };

  // --- Book text ---
  const cacheText = (id, chapters) => {
    const cache = textCache.current;
    cache.delete(id);
    cache.set(id, chapters);
    if (cache.size > TEXT_CACHE_SIZE) cache.delete(cache.keys().next().value);
  };
  const getText = async id => {
    if (textCache.current.has(id)) return textCache.current.get(id);
    const chapters = (await db.get(TEXT_KEY(id)).catch(() => null)) || null;
    cacheText(id, chapters);
    return chapters;
  };
  const saveText = async (id, chapters) => { await db.set(TEXT_KEY(id), chapters); cacheText(id, chapters); };
  const dropText = id => { textCache.current.delete(id); delete scrollPos.current[id]; return db.del(TEXT_KEY(id)); };

  // --- Reader ---
  const vm = b => {
    const count = b.chCount || 1;
    const ch = Math.min(b.chapter || 0, count - 1);
    return { ...b, count, ch, pct: Math.round(((ch + 1) / count) * 100) + '%', chapterLabel: `Chapter ${ch + 1} of ${count}` };
  };
  const setChapter = (id, ch) => {
    setBooks(list => list.map(b => (b.id === id ? { ...b, chapter: ch } : b)));
    scrollPos.current[id] = 0;
    writeJSON(SCROLL_KEY, scrollPos.current);
    if (readerRef.current) readerRef.current.scrollTop = 0;
  };
  useEffect(() => {
    const el = readerRef.current;
    if (!text || !el) return;
    requestAnimationFrame(() => { el.scrollTop = (scrollPos.current[text.id] || 0) * (el.scrollHeight - el.clientHeight); });
  }, [text]);
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
    setPref({ lastAudioId: a.id });
    try { await player.play(a); } catch (e) { if (e.name !== 'AbortError') flash(e.message); }
  };
  const skip = (a, d) => {
    if (player.item && player.item.id === a.id) { player.seek(player.pos() + d); return; }
    if (!a.len) return;
    setAudio(list => list.map(x => (x.id === a.id ? { ...x, pos: Math.max(0, Math.min(x.len, x.pos + d)) } : x)));
  };

  // --- Tags ---
  const addTag = () => {
    const name = (tagInput || '').trim().slice(0, TAG_MAX);
    if (!name) { setTagInput(null); return; }
    const existing = tags.find(t => t.name.toLowerCase() === name.toLowerCase());
    const finalName = existing ? existing.name : name;
    if (!existing) {
      const used = tags.map(t => t.color.toLowerCase());
      const free = SWATCHES.find(([, h]) => !used.includes(h.toLowerCase()));
      setTags(list => [...list, { name, color: (free || SWATCHES[list.length % SWATCHES.length])[1] }]);
    }
    setDraft(d => (d.tags.includes(finalName) ? d : { ...d, tags: [...d.tags, finalName] }));
    setTagInput(null);
  };
  const deleteTag = name => {
    if (!confirm(`Delete the tag “${name}”? It will be removed from every book and audiobook.`)) return;
    const strip = list => list.map(x => (x.tags.includes(name) ? { ...x, tags: x.tags.filter(t => t !== name) } : x));
    setTags(list => list.filter(t => t.name !== name));
    setBooks(strip);
    setAudio(strip);
    setDraft(d => d && { ...d, tags: d.tags.filter(t => t !== name) });
    if (cat === name) setCat('All');
  };
  const toggleDraftTag = name => setDraft(d => ({ ...d, tags: d.tags.includes(name) ? d.tags.filter(t => t !== name) : [...d.tags, name] }));

  // --- Editor ---
  const edit = (item, kind = 'book') => {
    clearTimeout(closeTimer.current);
    pendingAudio.current = null;
    setTagInput(null);
    setManageTags(false);
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
    return { ...fresh, title: DEFAULT_TITLES.includes(d.title) ? fresh.title : d.title, author: d.author, color: d.color, tags: d.tags, image: d.image, showText: d.showText };
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
    const picked = [...(e.target.files || [])].sort(byName);
    e.target.value = '';
    if (!picked.length) return;
    setToast('Reading audio…');
    // Files the browser can't decode report no duration; leave them out.
    const read = await readAudioTracks(picked);
    const files = picked.filter((f, i) => read[i].dur > 0);
    const tracks = read.filter(t => t.dur > 0);
    if (!files.length) { flash(`Can't play that file. Use ${AUDIO_FORMATS}.`); return; }
    if (files.length < picked.length) flash(`Skipped ${plural(picked.length - files.length, 'file', 'files')} that can't be played`);
    else setToast('');
    pendingAudio.current = files;
    const guess = guessTitle(files);
    const len = tracks.reduce((sum, t) => sum + t.dur, 0);
    setDraft(d => ({
      // A CD restored from a backup without audio keeps its listening position.
      ...d, tracks, len, pos: d.tracks && d.tracks.length ? 0 : Math.min(d.pos || 0, len),
      title: DEFAULT_TITLES.includes(d.title) && guess ? guess : d.title,
    }));
  };

  const saveEdit = async () => {
    const d = draft;
    if (!d) return;
    const { kind, ...item } = d;
    if (kind === 'book') {
      const id = item.id || 'b' + Date.now();
      if (item.chapters) {
        try { await saveText(id, item.chapters); } catch (err) { flash('Could not save the book: ' + err.message); return; }
        scrollPos.current[id] = 0;
        if (text && text.id === id) setText({ id, chapters: item.chapters });
      }
      const rec = { ...withoutText(item), id };
      setBooks(list => (item.id ? list.map(b => (b.id === id ? rec : b)) : [...list, rec]));
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
      if (!item.id) setPref({ lastAudioId: id });
    }
    closeEdit();
  };

  const deleteItem = async () => {
    const d = draft;
    if (!d || !d.id || !confirm(`Delete “${d.title}” from your library?`)) return;
    if (d.kind === 'book') {
      const rest = books.filter(b => b.id !== d.id);
      setBooks(rest);
      dropText(d.id).catch(e => console.warn(e));
      if (prefs.lastId === d.id) setPref({ lastId: rest[0] ? rest[0].id : null });
    } else {
      if (player.item && player.item.id === d.id) player.stop();
      db.deleteFiles(d.id).catch(e => console.warn(e));
      setAudio(list => list.filter(a => a.id !== d.id));
    }
    closeEdit();
  };

  // --- Files shared from other apps ---
  const importFiles = async files => {
    const bookFiles = files.filter(isBookFile);
    const audioFiles = files.filter(f => !isBookFile(f) && isAudioFile(f)).sort(byName);
    const added = [];
    let used = 0;
    setToast('Adding to your library…');

    const newBooks = [];
    for (const [i, f] of bookFiles.entries()) {
      try {
        const r = await importBookFile(f);
        const id = 'b' + Date.now() + i;
        await saveText(id, r.chapters);
        newBooks.push({ id, title: r.title, author: r.author || 'Unknown', color: SWATCHES[(books.length + i) % SWATCHES.length][1],
          tags: [], image: r.image, showText: true, chapter: 0, chCount: r.chapters.length, source: f.name });
      } catch (e) { console.warn(f.name, e); }
    }
    if (newBooks.length) { setBooks(list => [...list, ...newBooks]); added.push(plural(newBooks.length, 'book', 'books')); used += newBooks.length; }

    if (audioFiles.length) {
      const read = await readAudioTracks(audioFiles);
      const ok = audioFiles.filter((f, i) => read[i].dur > 0);
      if (ok.length) {
        const id = 'a' + Date.now();
        const tracks = read.filter(t => t.dur > 0);
        await Promise.all(ok.map((f, i) => db.putFile(`${id}:${i}`, f)));
        const rec = { id, title: guessTitle(ok), author: 'Unknown', color: SWATCHES[audio.length % SWATCHES.length][1], tags: [], image: '', showText: true,
          tracks, len: tracks.reduce((sum, t) => sum + t.dur, 0), pos: 0 };
        setAudio(list => [...list, rec]);
        setPref({ lastAudioId: id });
        added.push('1 audiobook');
        used += ok.length;
        if (!newBooks.length && view !== 'audio') goView('audio');
      }
    }
    const skipped = files.length - used;
    flash(added.length
      ? `Added ${added.join(' and ')}${skipped > 0 ? ` · skipped ${plural(skipped, 'file', 'files')}` : ''}`
      : `Nothing could be added. Share EPUB, TXT or ${AUDIO_FORMATS} files.`);
  };

  // --- Backup & restore ---
  const onExport = async () => {
    try {
      let last = -1;
      const blob = await exportBackup({
        books: await Promise.all(books.map(async b => ({ ...b, chapters: (await db.get(TEXT_KEY(b.id))) || undefined }))),
        audio, tags, scroll: scrollPos.current, includeAudio: withAudio,
        onProgress: p => { const n = Math.floor(p / 10) * 10; if (n !== last) { last = n; setToast(`Preparing backup… ${n}%`); } },
      });
      download(blob, backupName());
      flash(`Backup saved to Downloads (${fmtBytes(blob.size)})`);
    } catch (e) { flash('Backup failed: ' + e.message); }
  };

  const onRestore = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      setToast('Reading backup…');
      const { data, getAudio } = await readBackup(f);
      setToast('');
      if (!confirm(`Restore ${plural(data.books.length, 'book', 'books')} and ${plural(data.audio.length, 'audiobook', 'audiobooks')}? Items you already have are updated; nothing else is removed.`)) return;
      setToast('Restoring…');
      const restoredAudio = [];
      let missing = 0;
      for (const a of data.audio.map(withTags)) {
        let rec = a;
        if (a.tracks && a.tracks.length) {
          const blobs = await Promise.all(a.tracks.map((_, i) => getAudio(a.id, i)));
          if (blobs.every(Boolean)) {
            if (player.item && player.item.id === a.id) player.stop();
            await db.deleteFiles(a.id);
            await Promise.all(blobs.map((b, i) => db.putFile(`${a.id}:${i}`, b)));
          } else if (!(await db.getFile(`${a.id}:0`))) {
            rec = { ...a, tracks: [] }; // backup made without audio: keep the CD, re-add audio later
            missing++;
          }
        }
        restoredAudio.push(rec);
      }
      const merge = (list, incoming) => {
        const byId = Object.fromEntries(incoming.map(x => [x.id, x]));
        const have = new Set(list.map(x => x.id));
        return [...list.map(x => byId[x.id] || x), ...incoming.filter(x => !have.has(x.id))];
      };
      const restoredBooks = data.books.map(withTags);
      for (const b of restoredBooks) if (b.chapters) await saveText(b.id, b.chapters);
      setBooks(list => merge(list, restoredBooks.map(withoutText)));
      setAudio(list => merge(list, restoredAudio));
      setTags(list => [...list, ...data.tags.filter(t => !list.some(x => x.name.toLowerCase() === t.name.toLowerCase()))]);
      scrollPos.current = { ...scrollPos.current, ...data.scroll };
      writeJSON(SCROLL_KEY, scrollPos.current);
      flash(`Restored your library${missing ? ` · ${plural(missing, 'CD needs', 'CDs need')} audio re-added` : ''}`);
    } catch (err) { flash(err.message); }
  };

  if (!ready) return html`<div class="shell"></div>`;

  // --- Derived ---
  const isBooks = view === 'books';
  const q = query.trim().toLowerCase();
  const items = isBooks ? books : audio;
  const usedTags = tags.filter(t => items.some(x => x.tags.includes(t.name)));
  const all = books.map(vm);
  const shelf = all.filter(b => matches(b, cat, q));
  const current = all.find(b => b.id === prefs.lastId) || all[0];
  const audioList = audio.filter(a => matches(a, cat, q));
  const nowAudio = audio.find(a => a.id === playingId) || audio.find(a => a.id === prefs.lastAudioId) || audio[0];
  const rb = readerId && all.find(b => b.id === readerId);
  const chapters = rb && text && text.id === rb.id ? (text.chapters && text.chapters.length ? text.chapters : EMPTY_CH) : null;
  const filtering = !!q || cat !== 'All';

  // --- Pieces ---
  const editBadge = (onClick, size = 13) => html`
    <button class="badge-edit" title="Edit" onClick=${stop(onClick)}><${I.pencil} size=${size} sw="2.4" /></button>`;

  const filterChips = () => [{ name: 'All', color: '#F2B33D' }, ...usedTags].map(t => html`
    <button class=${'chip' + (cat === t.name ? ' on' : '')} onClick=${() => setCat(t.name)}>
      <span class="chip-dot" style=${{ background: t.color }}></span>
      ${t.name}
    </button>`);

  const audioStatus = (a, playing) => {
    if (!a.len) return 'No audio yet';
    if (a.pos >= a.len) return 'Finished';
    if (playing) return 'Playing · ' + fmtLeft(a.len - a.pos);
    return a.pos === 0 ? 'Not started · ' + fmtLeft(a.len) : fmtLeft(a.len - a.pos);
  };
  const audioPct = a => (a.len ? Math.round((a.pos / a.len) * 100) : 0) + '%';

  const renderBooks = () => html`
    ${current && !filtering && html`
      <section class="continue">
        <div class="cover-tap" onClick=${() => openBook(current.id)}>
          <${BookCover} ...${current} />
        </div>
        <div class="continue-body">
          <div class="kicker">Continue reading</div>
          <div class="stack-3">
            <h2>${current.title}</h2>
            <div class="author sm">${current.author}</div>
          </div>
          <div class="stack-6">
            <div class="bar lg"><span style=${{ width: current.pct }}></span></div>
            <div class="caption">${current.pct} · ${current.chapterLabel}</div>
          </div>
          <div class="btn-row">
            <button class="btn-coral" onClick=${() => openBook(current.id)}><${I.play} size="14" /> Keep reading</button>
            <button class="btn-round surface" title="Edit" onClick=${() => edit(current)}><${I.pencil} size="16" /></button>
          </div>
        </div>
      </section>`}

    <section class="section">
      <div class="section-hd">
        <h2>${filtering ? plural(shelf.length, 'result', 'results') : plural(books.length, 'book', 'books')}</h2>
      </div>
      <div class="grid">
        ${!filtering && html`
          <button class="add-tile" onClick=${() => edit(null, 'book')}>
            <span class="plus"><${I.plus} size="18" /></span>
            <span>Add a book</span>
          </button>`}
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
      </div>
      ${filtering && !shelf.length && html`<div class="empty">No books found. Try another search or tag.</div>`}
    </section>`;

  const renderAudio = () => {
    const a = nowAudio;
    const playing = a && playingId === a.id;
    return html`
      ${a && !filtering && html`
        <section class="continue listen">
          <div class="cover-tap press" onClick=${() => toggleAudio(a)}>
            <${CdCase} ...${a} playing=${playing} badge=${false} />
          </div>
          <div class="continue-body">
            <div class="kicker">${playing ? 'Now playing' : 'Continue listening'}</div>
            <div class="stack-3">
              <h2>${a.title}</h2>
              <div class="author sm">${a.author}</div>
            </div>
            <div class="stack-6">
              <div class="bar lg live"><span style=${{ width: audioPct(a) }}></span></div>
              <div class="caption">${audioPct(a)} · ${audioStatus(a, false)}</div>
            </div>
            <div class="btn-row">
              <button class="btn-round surface" title="Back 15 seconds" onClick=${() => skip(a, -15)}><${I.rewind} size="18" /></button>
              <button class=${'btn-coral' + (playing ? ' lav' : '')} onClick=${() => toggleAudio(a)}>
                ${playing ? html`<${I.pause} size="14" /> Pause` : html`<${I.play} size="14" /> Play`}
              </button>
              <button class="btn-round surface" title="Forward 30 seconds" onClick=${() => skip(a, 30)}><${I.forward} size="18" /></button>
            </div>
          </div>
        </section>`}

      <section class="section">
        <div class="section-hd">
          <h2>${filtering ? plural(audioList.length, 'result', 'results') : plural(audio.length, 'CD', 'CDs')}</h2>
        </div>
        <div class="grid cds">
          ${!filtering && html`
            <button class="add-tile square" onClick=${() => edit(null, 'audio')}>
              <span class="plus"><${I.plus} size="18" /></span>
              <span>Add an audiobook</span>
            </button>`}
          ${audioList.map(x => {
            const on = playingId === x.id;
            return html`
              <div class="audio-card" key=${x.id}>
                <div class="cover-tap press" title=${on ? 'Pause' : 'Play'} onClick=${() => toggleAudio(x)}>
                  <${CdCase} ...${x} playing=${on} />
                  ${editBadge(() => edit(x, 'audio'))}
                  <span class=${'play-btn' + (on ? ' playing' : '')}>
                    ${on ? html`<${I.pause} size="14" />` : html`<${I.play} size="14" />`}
                  </span>
                </div>
                <div class="card-text">
                  <div class="t ellipsis">${x.title}</div>
                  <div class="a author ellipsis">${x.author}</div>
                </div>
                <div class="audio-meta">
                  <div class="bar"><span style=${{ width: audioPct(x) }}></span></div>
                  <span class=${'status' + (on ? ' playing' : '')}>${audioStatus(x, on)}</span>
                </div>
              </div>`;
          })}
        </div>
        ${filtering && !audioList.length && html`<div class="empty">No audiobooks found. Try another search or tag.</div>`}
      </section>`;
  };

  const renderShelfView = () => html`
    <div class="scroll hide-scroll" ref=${scrollRef}>
      <header class="hdr">
        <div class="hdr-left">
          <div class="brand">${isBooks ? html`<${I.book} size="19" />` : html`<${I.headphones} size="19" sw="2" />`}</div>
          <h1>${isBooks ? 'Reading' : 'Listening'}</h1>
        </div>
        <div class="hdr-right">
          <button class="btn-round" title="Library & backup" onClick=${openLib}><${I.archive} size="19" /></button>
          <button class="theme-btn" title="Toggle theme" onClick=${() => setPref({ theme: isDark ? 'light' : 'dark' })}>
            ${isDark ? html`<${I.sun} size="19" />` : html`<${I.moon} size="19" />`}
          </button>
        </div>
      </header>

      <label class="search">
        <${I.search} size="19" />
        <input value=${query} onInput=${e => setQuery(e.target.value)} placeholder=${isBooks ? 'Search books, authors or tags' : 'Search audiobooks'} type="search" enterkeyhint="search" />
        ${query && html`<button class="search-clear" title="Clear" onClick=${e => { e.preventDefault(); setQuery(''); }}><${I.x} size="12" /></button>`}
      </label>

      ${usedTags.length > 0 && html`<div class="chips bleed hide-scroll">${filterChips()}</div>`}

      ${isBooks ? renderBooks() : renderAudio()}
    </div>

    <nav class="tabbar">
      <div>
        <button class=${'tab' + (isBooks ? ' on' : '')} onClick=${() => goView('books')}>
          <span class="ico"><${I.bookmark} /></span><span>Books</span>
        </button>
      </div>
      <div>
        <button class="fab" title=${isBooks ? 'New book' : 'New audiobook'} onClick=${() => edit(null, isBooks ? 'book' : 'audio')}><${I.plus} size="22" /></button>
      </div>
      <div>
        <button class=${'tab' + (!isBooks ? ' on' : '')} onClick=${() => goView('audio')}>
          <span class="ico"><${I.headphones} size="20" sw="2" /></span><span>Audio</span>
        </button>
      </div>
    </nav>
    ${renderLibSheet()}`;

  const renderLibSheet = () => html`
    <div class=${'overlay' + (libShown ? ' on' : '')} onClick=${() => popLayer('lib')}></div>
    <div class=${'type-sheet' + (libShown ? ' on' : '')} inert=${!libShown}>
      <div class="grabber"></div>
      <div class="sheet-hd">
        <h3>Library</h3>
        <button class="btn-round" title="Close" onClick=${() => popLayer('lib')}><${I.x} size="16" sw="2.4" /></button>
      </div>
      <div class="lib-stats">
        <span><b>${books.length}</b> ${books.length === 1 ? 'book' : 'books'}</span>
        <span><b>${audio.length}</b> ${audio.length === 1 ? 'audiobook' : 'audiobooks'}</span>
        <span><b>${usage == null ? '…' : fmtBytes(usage)}</b> used</span>
      </div>
      <div class="field">
        <span class="label">Backup</span>
        <button class="switch-row" onClick=${() => setWithAudio(v => !v)}>
          Include audio files
          <span class=${'switch' + (withAudio ? ' on' : '')}></span>
        </button>
        <button class="btn-coral" style="height:48px;" onClick=${onExport}><${I.download} size="17" /> Export backup</button>
        <label class="btn-soft">
          <${I.upload} size="17" /> Restore from backup
          <input type="file" accept=".zip,application/zip" onChange=${onRestore} />
        </label>
        <p class="hint">Backups go to your Downloads folder. Copy them to your computer to keep them safe. Restoring adds to your library and never deletes anything.</p>
      </div>
      <p class="hint tip"><${I.share} size="15" /> To add files from anywhere, select EPUB, TXT or audio files in your Files app, tap Share, then My Library.</p>
    </div>`;

  const renderReader = () => {
    const c = chapters && chapters[Math.min(rb.ch, chapters.length - 1)];
    const first = rb.ch === 0;
    const last = rb.ch >= rb.count - 1;
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
          ${c ? html`
            <div class="chapter-hd">
              <div class="kicker">${rb.chapterLabel}</div>
              <h2>${c.title}</h2>
            </div>
            <${Prose} paras=${c.paras} size=${prefs.fontSize} />` : html`<div class="kicker">Opening…</div>`}
        </article>

        <footer class="reader-foot">
          <button class="btn-round" title="Previous chapter" disabled=${first} onClick=${() => setChapter(rb.id, Math.max(0, rb.ch - 1))}><${I.chevL} /></button>
          <div class="mid">
            <div class="bar"><span style=${{ width: rb.pct }}></span></div>
            <div class="lbls"><span>${rb.chapterLabel}</span><span>${rb.pct}</span></div>
          </div>
          <button class="btn-coral next-btn" title="Next chapter" disabled=${last} onClick=${() => setChapter(rb.id, Math.min(rb.count - 1, rb.ch + 1))}>
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

  const renderTagPicker = d => html`
    <div class="field">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="label">Tags</span>
        ${tags.length > 0 && html`
          <button class="link-btn" onClick=${() => { setManageTags(m => !m); setTagInput(null); }}>${manageTags ? 'Done' : 'Edit tags'}</button>`}
      </div>
      <div class="chips-wrap">
        ${tags.map(t => {
          const on = d.tags.includes(t.name);
          return manageTags
            ? html`
              <button class="chip removable" title=${'Delete ' + t.name} onClick=${() => deleteTag(t.name)}>
                <span class="chip-dot" style=${{ background: t.color }}></span>${t.name}<${I.x} size="11" />
              </button>`
            : html`
              <button class=${'chip' + (on ? ' on' : '')} aria-pressed=${on} onClick=${() => toggleDraftTag(t.name)}>
                <span class="chip-dot" style=${{ background: t.color }}></span>${t.name}
                ${on && html`<${I.check} size="13" sw="3" />`}
              </button>`;
        })}
        ${!manageTags && tagInput === null && html`
          <button class="chip dashed" onClick=${() => setTagInput('')}><${I.plus} size="13" /> New tag</button>`}
      </div>
      ${tagInput !== null && html`
        <form class="tag-form" onSubmit=${e => { e.preventDefault(); addTag(); }}>
          <input class="input" ref=${tagInputRef} value=${tagInput} maxlength=${TAG_MAX} placeholder="Tag name, e.g. To read"
            onInput=${e => setTagInput(e.target.value)} enterkeyhint="done" />
          <button type="button" class="btn-cancel" onClick=${() => setTagInput(null)}>Cancel</button>
          <button type="submit" class="btn-save">Add</button>
        </form>`}
    </div>`;

  const renderEditor = () => {
    const d = draft;
    const isAudio = d.kind === 'audio';
    const isNew = !d.id;
    const preset = SWATCHES.some(([, h]) => h.toLowerCase() === d.color.toLowerCase());
    const chCount = d.chapters ? d.chapters.length : d.source ? d.chCount : 0;
    return html`
      <div class=${'overlay blur' + (sheetShown ? ' on' : '')} onClick=${closeEdit}></div>
      <div class=${'edit-sheet' + (sheetShown ? ' on' : '')}>
        <div class="edit-hd">
          <div class="grabber"></div>
          <div class="row">
            <button class="btn-cancel" onClick=${closeEdit}>Cancel</button>
            <h3>${isNew ? (isAudio ? 'New audiobook' : 'New book') : isAudio ? 'Edit audiobook' : 'Edit book'}</h3>
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
                  ${d.tracks && d.tracks.length
                    ? html`<small class="ellipsis">${plural(d.tracks.length, 'track', 'tracks')} · ${fmtDur(d.len)}</small>`
                    : html`<small>${AUDIO_FORMATS}. One file, or every track in order.</small>`}
                </span>
                <input type="file" accept="audio/*,.mp3,.m4a,.m4b,.aac,.ogg,.oga,.opus,.flac,.wav" multiple onChange=${onAudioFiles} />
              </label>
            </div>`}

          <div class="field" style="gap:8px;">
            <span class="label">Cover image</span>
            <div class="upload-row">
              <label class="upload">
                <span class="ico"><${I.upload} /></span>
                <span class="txt">
                  <b>${d.image ? 'Replace image' : 'Upload an image'}</b>
                  <small>${isAudio ? 'Square, 700 × 700 px · shown as a disc' : 'Portrait, 550 × 700 px'}</small>
                </span>
                <input type="file" accept="image/*" onChange=${onImageFile} />
              </label>
              ${d.image && html`<button class="btn-trash" title="Remove image" onClick=${() => patchDraft({ image: '' })}><${I.trash} size="18" /></button>`}
            </div>
            ${d.image && isAudio && html`
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

          ${renderTagPicker(d)}

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
