# Bandcamp Wishlist Bridge

A lightweight Chrome extension that watches the current Spotify album page, searches Bandcamp automatically, and opens the closest matching release.

## What it does

1. Open a Spotify album page like `https://open.spotify.com/album/...`.
2. Click the extension icon.
3. The React popup reads the current album, shows loading feedback, and searches Bandcamp automatically.
4. Review the matches or open the best match directly.
5. Use the settings tab to switch language, theme, and result count.

## Tech notes

- The popup UI is now built with React and a shadcn-style component structure.
- Settings are stored with `chrome.storage.sync`.
- The extension uses Bandcamp search results instead of any private Bandcamp API.

## Build

1. Run `npm install`.
2. Run `npm run build`.
3. Reload the unpacked extension in Chrome so it picks up the new popup bundle.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/Users/valentincabioch/dev/bandcampWhishListManager`.

## Project structure

- `manifest.json`: MV3 extension manifest
- `scripts/build-popup.mjs`: esbuild bundle step for the popup
- `src/popup/App.jsx`: React popup app
- `src/popup/components/ui/*`: shadcn-style UI components
- `src/popup/lib/extension.js`: Spotify metadata and Bandcamp search logic
- `src/popup/popup.bundle.js`: built popup bundle loaded by Chrome
