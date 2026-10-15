// Audiobooks read in place from a folder on the device (File System Access API).
// The folder's handle is kept in IndexedDB; tracks store their path inside it and are
// opened from there each time they play, so nothing is copied into the app.
//
// What counts as an audiobook, anywhere in the folder tree:
//   every .m4b file                      its own audiobook ("Series/02 - Book.m4b")
//   other audio files in one folder      one audiobook named after that folder, tracks in name order
//   (audio files straight in the picked folder are each their own audiobook)
// Covers: an image with the same name as an .m4b, else cover/folder/front.* (or any image) in its folder.
import { db } from './db.js';

const FOLDER_KEY = 'folder';
const AUDIO = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|flac|wav)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const stripExt = name => name.replace(/\.[^.]+$/, '');
const pretty = name => stripExt(name).replace(/[_]+/g, ' ').trim();

export const folderSupported = () => typeof window.showDirectoryPicker === 'function';

export async function pickFolder() {
  const dir = await window.showDirectoryPicker({ id: 'audiobooks', mode: 'read' });
  await db.set(FOLDER_KEY, dir);
  return dir;
}

export const savedFolder = () => db.get(FOLDER_KEY).catch(() => null);

// true when the folder can be read. With `ask`, shows the browser's prompt (needs a tap).
export async function folderAccess(dir, ask) {
  const opts = { mode: 'read' };
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  return ask ? (await dir.requestPermission(opts)) === 'granted' : false;
}

export async function folderFile(dir, path) {
  const parts = path.split('/');
  let h = dir;
  for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p);
  return (await h.getFileHandle(parts[parts.length - 1])).getFile();
}

// → [{ id, title, cover, tracks: [{ path, name }] }], `id` being the audiobook's path.
export async function scanFolder(dir) {
  const out = [];
  const walk = async (h, prefix, top) => {
    const files = [], dirs = [];
    for await (const entry of h.values()) (entry.kind === 'file' ? files : dirs).push(entry);
    files.sort(byName);
    dirs.sort(byName);
    const names = new Set(files.map(f => f.name));
    const images = files.filter(f => IMAGE.test(f.name)).map(f => f.name);
    const folderCover = images.find(n => /^(cover|folder|front)\./i.test(n)) || images[0] || null;
    const sameNameImage = n => ['jpg', 'jpeg', 'png', 'webp'].map(e => stripExt(n) + '.' + e).find(k => names.has(k)) || null;
    const audio = files.filter(f => AUDIO.test(f.name));

    const loose = [];
    for (const f of audio) {
      if (/\.m4b$/i.test(f.name) || top) {
        const cover = sameNameImage(f.name) || (top ? null : folderCover);
        out.push({ id: prefix + f.name, title: pretty(f.name), cover: cover && prefix + cover, tracks: [{ path: prefix + f.name, name: f.name }] });
      } else loose.push(f);
    }
    if (loose.length) {
      out.push({ id: prefix, title: h.name.replace(/[_]+/g, ' ').trim(), cover: folderCover && prefix + folderCover,
        tracks: loose.map(f => ({ path: prefix + f.name, name: f.name })) });
    }
    for (const d of dirs) await walk(d, prefix + d.name + '/', false);
  };
  await walk(dir, '', true);
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}
