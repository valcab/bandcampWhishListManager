# Bandcamp Wishlist Bridge

A lightweight Chrome extension that helps you jump from a Spotify album page to the matching Bandcamp release and click the wishlist button for you.

## What it does

1. Open a Spotify album page like `https://open.spotify.com/album/...`.
2. Click the extension icon.
3. Search Bandcamp for likely album matches.
4. Use `Quick add best match` or pick a specific result.
5. The extension opens the Bandcamp album page and tries to click `Add to wishlist` automatically.

## Notes

- You need to be signed in to Bandcamp for the wishlist action to stick.
- This extension intentionally uses Bandcamp's own web UI instead of a private Bandcamp API.
- If Bandcamp changes its page structure, the search or auto-click step may need a selector update.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/Users/valentincabioch/dev/bandcampWhishListManager`.

## Project structure

- `manifest.json`: MV3 extension manifest
- `src/background.js`: Bandcamp search and tab-opening logic
- `src/content/bandcamp.js`: auto-clicks the wishlist button on Bandcamp pages opened by the extension
- `src/popup/*`: popup UI shown from the extension toolbar
