# JNbot shares and marketplace

Hosts the plugins, plugin bundles, profiles, chains and triggers that people
share. A share is a **private link** or a **public marketplace entry**; both use
the same routes, storage and app code. It runs at:

```text
https://share.jnbot.workers.dev
```

It runs on the Workers Free plan with no payment method, so it can never be
billed. Past a daily limit, requests fail until the limit resets.

## Storage (D1 only)

- `shares`: one row per share: owner key, kind, visibility, review status and
  note, the revision downloads get (`live_revision`) and the latest upload.
- `share_revisions`: at most two rows per share (the live revision and one
  waiting for review). Each holds the uncompressed **listing** (title,
  contents, details, app version, target servers — everything a list or
  landing page shows), the **gzipped signed envelope** (max 1 MB) and an
  optional **banner** (PNG/JPEG/WebP/GIF, max 256 KB, never SVG). Older rows
  are deleted on approve, update or unlist, so nothing piles up.
- `reports`: one report per key per listed share.
- `meta.market_version`: bumped whenever the listed set changes; it is the
  marketplace ETag.

## Review

Public shares only appear on the marketplace after a reviewer approves the
exact revision. The approval is an Ed25519 signature by an official key
(`OFFICIAL_PUBLIC_KEYS` here, `OFFICIAL_ED25519_PUBLIC_KEYS` in the app) over
`approvalMessage(id, revision, sha256(listing), sha256(content))`. The app
verifies it itself, so the Worker cannot fake an approval. An update to a
listed share waits for review while the approved revision stays live.

The app becomes a reviewer when `plugins.ed25519.private.pem` is in
`userData/keys/`; it then also publishes as JNbot (official profiles become the
built-in, read-only servers).

## Routes

| Route | Purpose |
| --- | --- |
| `GET /s/<id>` | HTML landing page with an **Open in JNbot** button (`jnbot://share/<id>`) |
| `GET /api/s/<id>` | The record of the revision downloads get (listing, hashes, approval) |
| `GET /api/s/<id>/content/<rev>` | Gzipped envelope, cached forever |
| `GET /api/s/<id>/banner/<rev>` | Banner image, cached forever |
| `GET /api/market` | Every listed share in one response (`If-None-Match` → 304) |
| `POST /api/revisions` | `{ids}` → status per id, a batched update/status check |
| `PUT /api/s` · `PUT /api/s/<id>` | Create / update (signed multipart: `listing`, `content`, `banner?`, `visibility`) |
| `POST /api/s/<id>/unlist` | Owner: back to a private link |
| `POST /api/s/<id>/report` | Signed: report a listed share |
| `DELETE /api/s/<id>` | Owner or official key |
| `GET /api/review` · `POST /api/s/<id>/review` | Official key: queue, approve / reject / dismiss reports |

## Request signing

Writes are signed with the publisher's Ed25519 key, the same key JNbot uses
to sign plugins. There are no accounts: the key is the owner. The signed
message is `shareRequestMessage()` from `src/common/share.ts`.

## Limits

- 1 MB gzipped content, 8 MB unpacked (checked by the app), 256 KB banner,
  16 KB listing.
- 50 shares and 5 pending reviews per publisher key.
- 10 writes and 300 reads per minute per IP; 200 ids per revision lookup.

## Deploy

```bash
cd cloud/share
npm ci
npx wrangler login
npx wrangler d1 create jnbot-share   # answer "no" to adding it; put the id in the existing DB entry
npm run check
npm test
npm run deploy
```
