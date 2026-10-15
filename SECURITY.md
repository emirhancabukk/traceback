# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's **Report a vulnerability** button on this repository's Security tab, not in a public issue. You will get a reply within a week.

## How Traceback protects your data

**No server.** The app is static files. Its Content-Security-Policy limits scripts, styles, fonts and network requests to the app's own origin (plus the Vite dev-server socket on localhost), so a bug in the page cannot send your trail anywhere.

**Rendering.** Entry text is always escaped before it reaches the page. Links are accepted only as `http(s)`, embedded `user:password@` credentials are stripped, and links open with `noopener`, `noreferrer`.

**Browser captures.** The extension never passes captured text in a URL. The hand-over works like this:

1. When you click **Capture source**, the popup stores the capture inside the extension under its own key.
2. A content script runs on `localhost` and `127.0.0.1` pages, but stays silent unless the page's origin equals the app address configured in the extension.
3. The Traceback page announces itself with `window.postMessage`. The content script replies with the waiting captures.
4. The page accepts messages only when `event.source` is its own window and `event.origin` is its own origin, validates every field, saves the capture and replies with an acknowledgement.
5. Only acknowledged captures are deleted from the extension.

Other websites cannot write into your trail: their messages carry their own origin, and the content script does not run on their pages.

**Known limits.** Any program that can run JavaScript on the configured localhost origin can read and change the trail, as with any local web app. Data in `localStorage` is not encrypted at rest. Two tabs saving within the same instant can, rarely, lose one of the two edits.
