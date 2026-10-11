# My Library

A warm, cosy ebook reader with an audiobook shelf of CD cases, built as an installable PWA. It's based on the "Ebook Reader — Mobile (warm theme)" design handoff.

- **Books** tab: continue-reading card and a grid of every book
- **Audio** tab: continue-listening card (play, back 15s, forward 30s) and a grid of CD cases
- **Reader**: chapters, text size and light/dark theme
- **Cover editor**: title, author, cover image, colour and tags (several per item; create your own, delete any via "Edit tags")
  - **Books:** import **EPUB** or **TXT** files (Project Gutenberg headers are stripped automatically)
  - **Audiobooks:** add one audio file or every track in order (MP3, M4A, M4B, OGG, Opus, FLAC or WAV). The tracks play as one timeline, with lock-screen controls (Media Session).
- **Share to My Library**: once installed, the app appears in Android's share menu. Shared EPUB/TXT files become books; shared audio files become one audiobook, with the tracks in name order.
- **Library sheet** (archive button in the header): storage used, **Export backup** (a `.zip` with or without the audio) and **Restore from backup** (merges into the library and never deletes anything).

Everything stays on the device:
- Books and audiobooks are listed in IndexedDB. Each book's text is a separate record, loaded only when the book is opened, and each audio track is stored as its own file.
- Preferences and reading position are kept in localStorage.

## Files
| File | What it does |
|---|---|
| `index.html` | Page shell, fonts, service-worker registration |
| `styles.css` | Design tokens (light/dark) and every component's styles |
| `app.js` | The app (Preact + htm, no build step) |
| `importers.js` | EPUB / TXT parsing, audio durations, image scaling |
| `player.js` | Multi-track audiobook player + lock-screen controls |
| `backup.js` | Backup export / restore (.zip) |
| `db.js` | IndexedDB wrapper |
| `seed.js` | Sample books and CDs shown on first launch |
| `sw.js` | Network-first service worker for offline use + share-target handler |

Runtime dependencies come from CDNs and the service worker caches them:
- `htm@3.1.1/preact/standalone`
- `jszip@3.10.1`, loaded only for EPUB import and backups

## Local preview
It needs to be served over http (ES modules and IndexedDB don't work from `file://`):

```
npx serve .
```

## Deploying
This is a static site. Deploy it the same way as Tasks, on GitHub Pages:
1. Push this folder to a new GitHub repo, e.g. `My-Library`.
2. In the repo, open **Settings → Pages** and set **Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The app will be live at `https://lro-ui.github.io/My-Library/`.

When you ship changes, bump `CACHE_NAME` in `sw.js`.

## Turning it into an Android app
Use Bubblewrap, the same way as the Tasks APK:

```
bubblewrap init --manifest=https://lro-ui.github.io/My-Library/manifest.json
bubblewrap build
```

Use a new package id (e.g. `com.lroui.library`). Then add the new app's SHA-256 fingerprint to the `assetlinks.json` served at `https://lro-ui.github.io/.well-known/assetlinks.json`, next to the Tasks entry, so the app opens without a browser bar.

Bubblewrap reads the `share_target` from the web manifest during `init`, which is what puts the app in the share menu. If you change the share target later, run `bubblewrap update` and rebuild.
