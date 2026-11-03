/**
 * Cloudflare Pages Function — serves the JNbot client mod (published by
 * scripts/publishMods.mjs to the `jnbot-mods` branch).
 *
 * Routes:
 *   GET /mods/manifest.json                     latest mod build per Minecraft version
 *   GET /mods/<mc>/jnbot-fabric-<mod>+<mc>.jar  a mod jar
 *
 * Same posture as the JNdata and plugin routes:
 *   - The manifest is mutable: read API-first (60s fresh) with a raw fallback
 *     (no hourly quota), edge-cached for 15s.
 *   - Jars carry their version in the filename and are never overwritten, so
 *     they are immutable: raw-backed and edge-cached for a year.
 *   - Anything that doesn't match those two shapes is rejected with 400
 *     before any origin call.
 *
 * GITHUB_TOKEN (optional env/secret): lifts the API limit 60/hr → 5000/hr.
 */

const REPO = 'usserwout/JNbot-updater';
const BRANCH = 'jnbot-mods';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const MANIFEST_TTL = 15;

const JAR_RE = /^(\d+\.\d+(?:\.\d+)?)\/jnbot-fabric-\d+\.\d+\.\d+\+\1\.jar$/;

export async function onRequestGet({ params, env, request }) {
  const rel = (Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')).trim();
  const isManifest = rel === 'manifest.json';
  if (!isManifest && !JAR_RE.test(rel)) {
    return json({ error: 'expected /mods/manifest.json or /mods/<mc>/<jar>' }, 400, 'no-store');
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const headers = { 'User-Agent': 'jnbot-jndata-proxy', Accept: 'application/vnd.github.raw' };
  if (env && env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const raw = { url: `${RAW}/${REPO}/refs/heads/${BRANCH}/${rel}` };
  const sources = isManifest
    ? [{ url: `${API}/repos/${REPO}/contents/${rel}?ref=${BRANCH}`, headers }, raw]
    : [raw];

  for (const src of sources) {
    let upstream;
    try {
      upstream = await fetch(src.url, { headers: src.headers });
    } catch {
      continue;
    }
    if (!upstream.ok) continue;

    const res = new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        'content-type': isManifest ? 'application/json; charset=utf-8' : 'application/java-archive',
        'cache-control': isManifest
          ? `public, max-age=${MANIFEST_TTL}`
          : 'public, max-age=31536000, immutable',
        'access-control-allow-origin': '*',
      },
    });
    await cache.put(cacheKey, res.clone());
    return res;
  }

  // Short negative cache — a racing publish may not have landed yet.
  return json({ error: `${rel} not found` }, 404, 'public, max-age=10');
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
