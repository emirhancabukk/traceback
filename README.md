# Traceback

Traceback is a local-first evidence trail for digital work. It records sources, notes, decisions, commands, and file changes, then keeps the evidence connected to the decisions it supports.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To validate the app:

```bash
npm test
npm run build
```

## MVP workflow

1. Capture entries with **Capture entry**.
2. Select a decision in the timeline.
3. Use **Link evidence** to attach a source, note, command, or file change.
4. Export the selected decision's bundle as Markdown or JSON.
5. Search the trail or filter it by entry type from the left rail.

## Architecture

The UI is a small TypeScript/Vite client. `TimelineRepository` is the persistence boundary; the MVP uses `LocalStorageTimelineRepository` so it is immediately runnable without a native toolchain. Entries and links are stored as one versioned JSON document under `traceback.timeline.v1`. The domain and export modules are UI-independent and covered by focused Vitest tests. A future Tauri build can replace the repository implementation with SQLite commands without changing the UI or export format.

This first slice intentionally has no cloud sync, accounts, AI, or multi-device merge behavior. The evidence-link picker is intentionally simple for the MVP and will be a natural candidate for a richer native UI later.

## Browser extension

The `extension/` directory contains a Chrome/Firefox-compatible Manifest V3 extension. It uses `activeTab` and `scripting` only after the user clicks the toolbar button, reads the active tab's title, URL, and current selection, then opens the local Traceback app with a short-lived capture payload. The app validates that payload and saves it through the same `TimelineRepository` localStorage layer; no cloud endpoint or extension-to-page privileged bridge is needed.

To install locally:

1. Start Traceback with `npm run dev` (the default extension target is `http://localhost:5173`).
2. Chrome: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/`.
3. Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `extension/manifest.json`.
4. Open a webpage, optionally select text, click the Traceback extension, and choose **Capture source**. The app opens in a new tab and records the source locally.

Use the popup's app URL field or **Configure app URL** if the Vite port differs. The extension accepts localhost HTTP/HTTPS URLs only by design.
