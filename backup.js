// Library backups: a .zip holding library.json plus (optionally) every audio file.
//   library.json         → { app, version, exported, books, audio, tags, scroll }
//   audio/<id>/<track>   → the audio blob for that track
import { db } from './db.js';
import { loadJSZip } from './importers.js';

const APP = 'my-library';
const VERSION = 1;

export async function exportBackup({ books, audio, tags, scroll, includeAudio, onProgress }) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  zip.file('library.json', JSON.stringify({ app: APP, version: VERSION, exported: new Date().toISOString(), books, audio, tags, scroll }));
  if (includeAudio) {
    for (const a of audio) {
      for (let i = 0; i < (a.tracks || []).length; i++) {
        const blob = await db.getFile(`${a.id}:${i}`);
        if (blob) zip.file(`audio/${a.id}/${i}`, blob);
      }
    }
  }
  // Audio is already compressed, so files are stored as-is (much faster).
  return zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, m => onProgress && onProgress(m.percent));
}

export async function readBackup(file) {
  const JSZip = await loadJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(file); } catch (e) { throw new Error('That file is not a My Library backup.'); }
  const entry = zip.file('library.json');
  if (!entry) throw new Error('That file is not a My Library backup.');
  const data = JSON.parse(await entry.async('text'));
  if (data.app !== APP) throw new Error('That file is not a My Library backup.');
  if (data.version > VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  return {
    data: { books: data.books || [], audio: data.audio || [], tags: data.tags || [], scroll: data.scroll || {} },
    getAudio: (id, i) => { const f = zip.file(`audio/${id}/${i}`); return f ? f.async('blob') : null; },
  };
}

export const backupName = () => `my-library-backup-${new Date().toISOString().slice(0, 10)}.zip`;

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
