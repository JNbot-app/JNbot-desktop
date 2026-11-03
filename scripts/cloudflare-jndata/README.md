# JNdata + plugin Cloudflare Pages proxy

A two-route Cloudflare **Pages** project that replaces both jsDelivr and the
GitHub-CDN dependency for distributing JNdata and plugins. Free tier.

| Route | Backed by | Caching | Why |
|---|---|---|---|
| `GET /jndata/<version>` | GitHub **Contents API** | `no` long cache — 15s edge | JNdata.json is mutable; the API is cached only 60s (vs raw's 5 min), so a re-publish propagates in ~a minute. |
| `GET /plugin/<branch>/<server>/<hash>.jnp` | **raw**.githubusercontent | `immutable`, 1y edge | Plugin files are content-hashed → immutable → cache forever; raw has no hourly quota. |
| `GET /latest-plugin/<server>/<pluginId>` | latest `jndata-N.N.N` branch → `/plugin` | 15s edge | Resolve the freshest bundle when you know only server+pluginId. Finds the highest `jndata-N.N.N` branch, reads its JNdata, then 302-redirects to the matching immutable `/plugin` URL (bytes never re-stream). Optional `?version=N.N.N` pins a specific release branch. |
| `GET /mods/manifest.json`, `GET /mods/<mc>/<jar>` | `jnbot-mods` branch (manifest: Contents API → raw; jars: raw) | manifest 15s edge; jars `immutable`, 1y | JNbot client mod, published by `scripts/publishMods.mjs`. The manifest names the newest mod build per Minecraft version; jar filenames carry the mod version and are never overwritten. |

GitHub stays the source of truth. `build-jndata.mjs` / `publishJNdata.mjs` push
data to the `jndata-<version>` branch exactly as before — this proxy just reads
from it. **jsDelivr is gone**, and so is the `purgeJsdelivr()` step.

## Abuse resistance — "one attacker can't lock everyone out"

Two distinct attack surfaces, both covered:

1. **GitHub quota exhaustion.** The JNdata route reads the Contents API
   (60/hr unauthenticated, 5000/hr with a token). If an attacker burns it by
   spamming many *distinct* versions, the route falls back to **raw**, which has
   **no hourly quota** — so real users are never rejected, just briefly served
   ≤5-min-stale data. Both routes also reject malformed paths with `400` before
   any origin call. Plugins use raw only → immune.

2. **Cloudflare request-quota exhaustion** (Pages free = 100k req/day). Repeat
   requests are served from the **edge cache** without re-hitting origin, and a
   single flooding IP is stopped by a **Rate-Limiting Rule** (see step 3 below).

## Deploy

### 1. Deploy the Functions

```bash
cd scripts/cloudflare-jndata
npx wrangler login
npx wrangler pages deploy . --project-name jnbot-jndata --commit-dirty=true
```

### 2. (Recommended) Add a GitHub token — lifts API limit 60/hr → 5000/hr

Create a **fine-grained PAT**, read-only `Contents` on `JNbot-updater`, then:

```bash
npx wrangler pages secret put GITHUB_TOKEN --project-name jnbot-jndata
```

### 3. (Recommended) Custom domain + rate-limit rule — the real DoS defense

A per-IP rate-limit rule only works on a zone you control, so attach a custom
domain first:

- Dashboard → Pages → `jnbot-jndata` → **Custom domains** → add e.g.
  `jndata.yourdomain.com`.
- Dashboard → that zone → **Security → WAF → Rate limiting rules** → add a rule
  like: *if requests from one IP > 60 in 1 min → Block (1 min)*. The free plan
  includes one rate-limiting rule — that's enough to isolate a single abuser at
  the edge before they consume the Pages request quota.
- Then set the custom domain in the two places below and re-publish so plugin
  URLs point at it.

## Where the domain is configured

| File | Constant | Purpose |
|---|---|---|
| `src/main/src/functions/Settings.ts` | `JNDATA_PROXY_BASE` | App fetches JNdata from `<base>/jndata/<version>`. |
| `scripts/build-jndata.mjs` | `CDN_BASE` | Baked plugin URLs: `<base>/plugin/<branch>/<server>/<hash>.jnp`. |

Both default to `https://jnbot-jndata.pages.dev`. The app also falls back to raw
GitHub directly if the proxy is unreachable (see `fetchHosts` in
`ProfileScripts.ts` and the fallback URLs in `Settings.ts`).

## Verify

```bash
# JNdata served from the API path, never cached:
curl -s -D - -o /dev/null https://jnbot-jndata.pages.dev/jndata/3.0.3 \
  | grep -iE "x-jndata-source|cache-control"
# expect: x-jndata-source: api   /   cache-control: public, max-age=15

# A plugin (immutable):
curl -s -D - -o /dev/null \
  "https://jnbot-jndata.pages.dev/plugin/jndata-3.0.3/<server>/<hash>.jnp" \
  | grep -i cache-control
# expect: cache-control: public, max-age=31536000, immutable

# Garbage is rejected without hitting origin:
curl -s -o /dev/null -w "%{http_code}\n" https://jnbot-jndata.pages.dev/jndata/not-a-version
# expect: 400

# Latest plugin for a server+pluginId — 302 to the immutable bundle URL:
curl -s -D - -o /dev/null "https://jnbot-jndata.pages.dev/latest-plugin/jartexnetwork/mpojb0gpxnn024s3i2" \
  | grep -iE "location|x-plugin-version"
# expect: location: .../plugin/jndata-3.0.5/jartexnetwork/<hash>.jnp

# Follow the redirect straight to the bundle bytes:
curl -sL "https://jnbot-jndata.pages.dev/latest-plugin/jartexnetwork/mpojb0gpxnn024s3i2"
```
