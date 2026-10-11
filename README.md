# My Library

A warm, cosy ebook reader with an audiobook shelf of CD cases, built as an installable PWA. It's based on the "Ebook Reader — Mobile (warm theme)" design handoff.

- **Books** tab: continue-reading card and a grid of every book
- **Audio** tab: continue-listening card (play, back 15s, forward 30s) and a grid of CD cases
- **Reader**: chapters, text size and light/dark theme
- **Cover editor**: title, author, cover image, colour and tags (several per item; create your own, delete any via "Edit tags")
  - **Books:** import **EPUB** or **TXT** files (Project Gutenberg headers are stripped automatically)
  - **Audiobooks:** add one audio file or every track in order. The tracks play as one timeline, with lock-screen controls (Media Session).

Everything stays on the device:
- Books and audiobook metadata are kept in IndexedDB, and so are the audio files themselves.
- Preferences and reading position are kept in localStorage.

## Files
| File | What it does |
|---|---|
| `index.html` | Page shell, fonts, service-worker registration |
| `styles.css` | Design tokens (light/dark) and every component's styles |
| `app.js` | The app (Preact + htm, no build step) |
| `importers.js` | EPUB / TXT parsing, audio durations, image scaling |
| `player.js` | Multi-track audiobook player + lock-screen controls |
| `db.js` | IndexedDB wrapper |
| `seed.js` | Sample books and CDs shown on first launch |
| `sw.js` | Network-first service worker for offline use |

Runtime dependencies come from CDNs and the service worker caches them:
- `htm@3.1.1/preact/standalone`
- `jszip@3.10.1`, loaded only when an EPUB is imported

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
