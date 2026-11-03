/**
 * Cloudflare Pages Function — serves JNdata.json *fresh*, abuse-resistant.
 *
 * Route:  GET /jndata/<appVersion>      e.g. /jndata/3.0.3
 *
 * Freshness — why the GitHub *API*, not raw.githubusercontent:
 *   raw is Fastly-cached ~5 min and (verified) ignores the query string, so a
 *   `?t=` cache-buster does NOT defeat it — a raw-backed proxy stays 5 min stale.
 *   The Contents API serves `Cache-Control: max-age=60`, bounding staleness at
 *   ~60s. So we read the API first, and fall back to raw only if it's down.
 *
 * Abuse resistance — "one attacker can't lock everyone out":
 *   - Strict version validation: anything but `N.N.N` is rejected with 400 and
 *     never touches an origin (a spammer can't burn quota with junk paths).
 *   - Short edge cache (caches.default): repeated requests for the same version
 *     are served from Cloudflare without re-calling GitHub, so a flood collapses
 *     into ~one origin call per version per window.
 *   - raw fallback has NO hourly quota, unlike the API's 60/hr (5000/hr with a
 *     token). So even if an attacker exhausts the API quota by spamming many
 *     *distinct* versions, real users still get served from raw — degraded to
 *     ~5 min freshness, never rejected.
 *   - Per-IP flooding of the Worker itself is handled by a Cloudflare
 *     Rate-Limiting Rule on the custom domain (see README), which blocks the
 *     abuser at the edge before they consume the Pages request quota.
 *
 * GITHUB_TOKEN (optional env/secret): lifts the API limit 60/hr → 5000/hr.
 */

const REPO = 'usserwout/JNbot-updater';
const FILE = 'data/v1/JNdata.json';
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const EDGE_TTL = 15; // seconds a JNdata response may be served from the edge

export async function onRequestGet({ params, env, request }) {
  const version = String(params.version || '').trim();

  // Cheap rejection of anything that isn't a real version — no origin call.
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return json({ error: 'invalid version' }, 400, 'no-store');
  }

  // 1. Serve from the edge cache when warm — protects GitHub from floods.
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 2. Cache miss — fetch from origin. API first (fresh), raw as no-quota
  //    fallback so quota exhaustion can never become a lockout.
  const headers = { 'User-Agent': 'jnbot-jndata-proxy', Accept: 'application/vnd.github.raw' };
  if (env && env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const sources = [
    { url: `${API}/repos/${REPO}/contents/${FILE}?ref=jndata-${version}`, headers, tag: 'api' },
    { url: `${API}/repos/${REPO}/contents/${FILE}?ref=main`, headers, tag: 'api' },
    { url: `${RAW}/${REPO}/refs/heads/jndata-${version}/${FILE}`, tag: 'raw' },
    { url: `${RAW}/${REPO}/refs/heads/main/${FILE}`, tag: 'raw' },
  ];

  for (const src of sources) {
    let upstream;
    try {
      upstream = await fetch(src.url, { headers: src.headers });
    } catch {
      continue;
    }
    if (!upstream.ok) continue;

    const body = await upstream.text();
    const res = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Public + short max-age lets Cloudflare's edge absorb repeat traffic;
        // 15s is well under the API's own 60s window, so freshness is unchanged.
        'cache-control': `public, max-age=${EDGE_TTL}`,
        'access-control-allow-origin': '*',
        'x-jndata-source': src.tag,
      },
    });
    // Populate the edge cache so the next request skips the origin entirely.
    await cache.put(cacheKey, res.clone());
    return res;
  }

  return json({ error: 'JNdata unavailable for this version' }, 502, 'no-store');
}

function json(obj, status, cacheControl) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl },
  });
}
