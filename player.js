// Audiobook playback: one <audio> element that walks through an audiobook's
// tracks as if they were a single timeline. Positions are global seconds.
import { db } from './db.js';

export class Player {
  constructor({ onTime, onState }) {
    this.onTime = onTime;   // (id, pos)
    this.onState = onState; // (id | null) — the id that is playing now
    this.el = new Audio();
    this.el.preload = 'auto';
    this.item = null;
    this.idx = -1;
    this.url = '';
    this.switching = false;

    this.el.addEventListener('timeupdate', () => {
      if (this.item && !this.switching) this.onTime(this.item.id, this.pos());
    });
    this.el.addEventListener('play', () => this.item && this.onState(this.item.id));
    this.el.addEventListener('pause', () => {
      if (this.item && !this.switching && !this.el.ended) this.onState(null);
    });
    this.el.addEventListener('ended', () => this.next());
    this.initSession();
  }

  pos() { return this.item ? this.starts[this.idx] + this.el.currentTime : 0; }

  async play(item) {
    if (!this.item || this.item.id !== item.id) {
      this.stop();
      this.item = item;
      let t = 0;
      this.starts = item.tracks.map(tr => { const s = t; t += tr.dur; return s; });
      await this.seek(item.pos >= item.len ? 0 : item.pos);
    }
    this.updateSession();
    await this.el.play();
  }

  pause() { this.el.pause(); }

  async seek(pos) {
    if (!this.item) return;
    pos = Math.max(0, Math.min(pos, this.item.len));
    let i = this.starts.length - 1;
    while (i > 0 && this.starts[i] > pos) i--;
    if (i !== this.idx) await this.load(i);
    this.el.currentTime = pos - this.starts[i];
    this.onTime(this.item.id, pos);
  }

  async load(i) {
    const blob = await db.getFile(`${this.item.id}:${i}`);
    if (!blob) throw new Error('The audio file for this CD is missing. Re-add it in the editor.');
    this.switching = true;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.idx = i;
    this.el.src = this.url;
    await new Promise((resolve, reject) => {
      this.el.addEventListener('loadedmetadata', resolve, { once: true });
      this.el.addEventListener('error', () => reject(new Error('This audio format is not supported.')), { once: true });
    });
    this.switching = false;
  }

  async next() {
    if (!this.item) return;
    if (this.idx + 1 < this.item.tracks.length) {
      await this.load(this.idx + 1);
      this.el.currentTime = 0;
      this.el.play();
    } else {
      const id = this.item.id;
      this.onTime(id, this.item.len);
      this.onState(null);
    }
  }

  stop() {
    const wasPlaying = this.item && !this.el.paused;
    this.switching = true;
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    this.idx = -1;
    this.item = null;
    this.switching = false;
    if (wasPlaying) this.onState(null);
  }

  // Lock-screen / notification controls.
  initSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const skip = d => () => this.item && this.seek(this.pos() + d);
    const handlers = {
      play: () => this.el.play(),
      pause: () => this.el.pause(),
      seekbackward: skip(-15),
      seekforward: skip(30),
      seekto: e => this.seek(e.seekTime),
      previoustrack: skip(-15),
      nexttrack: skip(30),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(action, fn); } catch (e) { /* unsupported action */ }
    }
  }

  updateSession() {
    if (!navigator.mediaSession || !this.item || !window.MediaMetadata) return;
    const it = this.item;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.title,
      artist: it.author,
      album: 'My Library',
      artwork: it.image ? [{ src: it.image, sizes: '700x700', type: 'image/jpeg' }] : [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
}
