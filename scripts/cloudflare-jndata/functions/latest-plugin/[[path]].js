/**
 * Cloudflare Pages Function — resolve the *latest* plugin for a server.
 *
 * Route:  GET /latest-plugin/<server>/<pluginId>
 *   e.g.  /latest-plugin/jartexnetwork/mpojb0gpxnn024s3i2
 *
 * A caller that knows only the server + pluginId (but not the current app
 * version, content hash, or version branch) can resolve the freshest published
 * bundle here:
 *
 *   1. Resolve the *latest app version* — the highest `jndata-N.N.N` branch in
 *      the repo (these branches are what publish writes; `main` is legacy/stale
 *      and is intentionally NOT used here).
 *   2. Read that branch's JNdata.json.
 *   3. Find the entry whose `pluginId` matches inside `data[<server>]`.
 *   4. 302-redirect to its immutable `/plugin/...` URL. The client then fetches
 *      a content-hashed file that's edge-cached `immutable` for a year, so the
 *      actual bytes never re-stream through this function. (No need to hand back
 *      the entry's checksum/signature — the `.jnp` bundle carries its own
 *      signature, which the app verifies on load.)
 *
 * Optional `?version=N.N.N` pins a specific `jndata-N.N.N` branch instead of
 * resolving the latest, mirroring how the app freezes data to its own release.
 *
 * Free-tier / abuse resistance — same posture as the other two routes:
 *   - Strict validation of <server> and <pluginId> rejects junk with 400 before
 *     any origin call, so a spammer can't burn quota with garbage paths.
 *   - The resolved redirect is edge-cached briefly (latest is mutable), so a
 *     flood of lookups collapses to ~one GitHub call per lookup per window.
 *   - GitHub is read API-first (fresh, 60s) with a raw fallback that has NO
 *     hourly quota, so even API-quota exhaustion can't lock anyone out for the
 *     JNdata read. (Resolving the latest version needs the API; with no token
 *     that's 60/hr, but the result is edge-cached, so floods don't exhaust it.)
 *   - Per-IP flooding is handled by the Cloudflare Rate-Limiting Rule on the
 *     custom domain (see README).
 *
 * GITHUB_TOKEN (optional env/secret): lifts the API limit 60/hr → 5000/hr.
 */

const REPO = 'usserwout/JNbot-updater';
const FILE = 'data/v1/JNdata.json';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const EDGE_TTL = 15; // seconds the resolved redirect may be served from the edge

// Plugin entries live in these slots inside data[server]. Arrays hold many
// entries; the two *Action keys hold a single entry object.
const ARRAY_SLOTS = ['scripts', 'actions'];
const SINGLE_SLOTS = ['profileUiAction', 'botExtensionAction'];

export async function onRequestGet({ params, env, request }) {
  const parts = Array.isArray(params.path) ? params.path : String(params.path || '').split('/');
  const server = String(parts[0] || '').trim();
  const pluginId = String(parts[1] || '').trim();

  const url = new URL(request.url);
  const version = (url.searchParams.get('version') || '').trim();

  // Cheap rejection of anything malformed — no origin call.
  if (!/^[A-Za-z0-9_.-]+$/.test(server) || !/^[A-Za-z0-9_-]+$/.test(pluginId) || parts.length !== 2) {
    return json({ error: 'expected /latest-plugin/<server>/<pluginId>' }, 400, 'no-store');
  }
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
    return json({ error: 'invalid version' }, 400, 'no-store');
  }

  // 1. Serve the resolved lookup from the edge cache when warm.
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 2. Resolve the version branch. Explicit `?version=` pins it; otherwise find
  //    the latest published `jndata-N.N.N` branch.
  const resolvedVersion = version || (await resolveLatestVersion(env));
  if (!resolvedVersion) {
    return json({ error: 'could not resolve the latest version' }, 502, 'no-store');
  }

  // 3. Fetch that branch's JNdata. API first (fresh), raw as no-quota fallback.
  const data = await fetchJNdata(`jndata-${resolvedVersion}`, env);
  if (!data) return json({ error: `JNdata unavailable for ${resolvedVersion}` }, 502, 'no-store');

  // 4. Locate the plugin entry for this server + pluginId.
  const serverData = data && data.data && data.data[server];
  if (!serverData) return json({ error: `unknown server "${server}"` }, 404, 'no-store');

  const entry = findPluginEntry(serverData, pluginId);
  if (!entry || !entry.source || !entry.source.url) {
    return json({ error: `plugin "${pluginId}" not found for "${server}"` }, 404, 'no-store');
  }

  // Redirect to the immutable, year-cached /plugin URL — the bytes never
  // re-stream through this function. Short-cache the redirect itself since
  // "latest" is mutable.
  const res = new Response(null, {
    status: 302,
    headers: {
      location: entry.source.url,
      'cache-control': `public, max-age=${EDGE_TTL}`,
      'access-control-allow-origin': '*',
      'x-plugin-version': resolvedVersion,
    },
  });

  await cache.put(cacheKey, res.clone());
  return res;
}

/**
 * Resolve the latest app version = the highest `jndata-N.N.N` branch in the
 * repo. Uses the "list matching refs" API (one call, prefix-filtered server
 * side). Returns e.g. "3.0.5", or null if it can't be determined.
 */
async function resolveLatestVersion(env) {
  const headers = { 'User-Agent': 'jnbot-jndata-proxy', Accept: 'application/vnd.github+json' };
  if (env && env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  let refs;
  try {
    const r = await fetch(`${API}/repos/${REPO}/git/matching-refs/heads/jndata-`, { headers });
    if (!r.ok) return null;
    refs = await r.json();
  } catch {
    return null;
  }
  if (!Array.isArray(refs)) return null;

  let best = null;
  for (const { ref } of refs) {
    const m = /^refs\/heads\/jndata-(\d+\.\d+\.\d+)$/.exec(ref || '');
    if (m && (!best || compareVersions(m[1], best) > 0)) best = m[1];
  }
  return best;
}

/** Compare two `N.N.N` strings numerically. >0 if a is newer than b. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Fetch + parse JNdata.json for a git ref, API-first with a raw fallback. */
async function fetchJNdata(ref, env) {
  const headers = { 'User-Agent': 'jnbot-jndata-proxy', Accept: 'application/vnd.github.raw' };
  if (env && env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const sources = [
    { url: `${API}/repos/${REPO}/contents/${FILE}?ref=${ref}`, headers },
    { url: `${RAW}/${REPO}/refs/heads/${ref}/${FILE}` },
  ];

  for (const src of sources) {
    try {
      const upstream = await fetch(src.url, { headers: src.headers });
      if (!upstream.ok) continue;
      return JSON.parse(await upstream.text());
    } catch {
      /* try next source */
    }
  }
  return null;
}

/** Search every plugin-bearing slot of a server's data for a pluginId. */
function findPluginEntry(serverData, pluginId) {
  for (const slot of ARRAY_SLOTS) {
    const arr = serverData[slot];
    if (Array.isArray(arr)) {
      const hit = arr.find((e) => e && e.pluginId === pluginId);
      if (hit) return hit;
    }
  }
  for (const slot of SINGLE_SLOTS) {
    const e = serverData[slot];
    if (e && e.pluginId === pluginId) return e;
  }
  return null;
}

function json(obj, status, cacheControl) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'access-control-allow-origin': '*',
    },
  });
}
