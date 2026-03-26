# OpenClaw Daily Web Browsing Log Collector (Chrome Extension)

## 1) Architecture (Design First)

This extension uses a **Manifest V3** architecture with:

- `src/content.js` (content script): collects metadata from page `<head>` only.
- `src/background.js` (service worker): applies allow/deny privacy rules, persists visit records, prepares/sends daily batches, and handles resend/history.
- `src/idb.js`: IndexedDB data layer for bulk visit/batch data.
- `popup/*`: popup UI for count, one-click block, preview/delete/send, settings, and batch history.

### Data flow

1. User visits page.
2. Content script extracts only approved metadata fields from `<head>`.
3. Background service worker normalizes URL, applies denylist/allowlist, and stores in IndexedDB.
4. User opens popup to review daily entries and optionally delete records.
5. User explicitly confirms send (first successful manual send grants auto-send consent).
6. Batch is POSTed to configured webhook with bearer token.
7. Batch status is stored as `pending` / `sent` / `failed` and can be resent later.

## 2) Annotated file structure

```text
.
├── manifest.json                 # MV3 manifest: permissions, SW, popup, content scripts
├── README.md                     # design log + schema + test guide + limitations
├── popup
│   ├── popup.css                 # lightweight popup styling
│   ├── popup.html                # count/actions/settings/history + pre-send preview
│   └── popup.js                  # popup controller and messaging to SW
└── src
    ├── background.js             # orchestration, filtering, batching, webhook send/resend
    ├── content.js                # head-only metadata capture
    ├── idb.js                    # IndexedDB wrapper for visits/batches
    ├── rules.js                  # allow/deny/privacy filtering logic
    └── shared.js                 # URL normalization, date helpers, common constants
```

## 3) Design decision log

- **MV3 + service worker**: compliant with modern Chrome extension constraints.
- **IndexedDB for bulk records**: satisfies requirement to avoid localStorage/chrome.storage.local for large datasets.
- **chrome.storage.local for settings/token**: webhook credentials are user-entered and never hardcoded.
- **Denylist precedence**: deny rules are evaluated before allow rules.
- **Privacy-first defaults**: local/internal/auth/sensitive-query URLs are excluded by default.
- **Manual confirmation before send**: popup uses explicit confirmation dialog; auto-send only runs after consent is set.
- **Batch replayability**: persisted payload per batch enables resend for any past batch.
- **OpenClaw hook compatibility**: when webhook URL ends with `/hooks/agent` or `/hooks/wake`, payload is wrapped into the endpoint-specific required schema to avoid `400 invalid payload`.

## 4) Finalized payload schema

```json
{
  "day": "YYYY-MM-DD",
  "source": "chrome-extension",
  "batchId": "browser-YYYY-MM-DD",
  "sentAt": "ISO-8601 with timezone",
  "itemCount": 12,
  "items": [
    {
      "url": "https://example.com/article",
      "canonicalUrl": "https://example.com/article",
      "title": "Example",
      "description": "Summary",
      "ogTitle": "Example",
      "ogDescription": "Summary",
      "siteName": "Example Site",
      "hostname": "example.com",
      "visitedAt": "ISO-8601 with timezone",
      "referrer": "https://google.com/",
      "favicon": "https://example.com/favicon.ico"
    }
  ]
}
```

## 5) Testing / verification guide

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repo root.
4. Visit public pages (`https://example.com`, etc.) to generate sample records.
5. Open popup:
   - Verify today's count increments.
   - Use **Don't record this site** and confirm future visits are excluded.
   - Open **Preview & Send**, delete an item, then send with confirmation.
   - Configure webhook/token and test send.
   - Verify batch history updates and resend works.
6. For auto-send, keep browser open near local 23:00 and verify alarm-triggered batch attempt after consent.

## 6) Known limitations

- Service worker timing is best-effort; alarms are periodic checks, not exact second-level scheduling.
- No deduplication heuristic is currently applied; repeat visits are stored as separate entries.
- Default financial/password manager denylist is conservative, not exhaustive.
- Popup is intentionally simple (single-screen workflow) and not optimized for very large daily datasets.
- Favicon fallback may point to `/favicon.ico` even if site uses nonstandard icon handling.

## Clarifications recommended before production hardening

- Exact OpenClaw retry/backoff policy and expected webhook response shape.
- Desired deduplication semantics (none vs per-URL vs URL+time window).
- Whether auto-send should require re-confirmation daily or only first-use consent.
