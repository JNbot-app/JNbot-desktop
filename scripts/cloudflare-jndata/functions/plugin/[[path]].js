/**
 * Cloudflare Pages Function — serves plugin `.jnp` bundles.
 *
 * Route:  GET /plugin/<branch>/<server>/<hash>.jnp
 *   e.g.  /plugin/jndata-3.0.3/jartexnetwork/a1b2c3d4e5f6.jnp
 *
 * Plugins are content-hashed, so a given URL is IMMUTABLE — its bytes never
 * change. That flips the caching story versus JNdata.json: caching is exactly
 * what we want, and it's why this route is abuse-proof.
 *
 *   - Served `public, max-age=1y, immutable` and stored in the edge cache, so
 *     after the first hit Cloudflare answers from the edge and GitHub is never
 *     touched again for that URL. A flood of repeat requests costs zero origin
 *     traffic.
 *   - Backed by raw.githubusercontent, which (unlike the Contents API) has no
 *     hourly quota to exhaust — so even cold-miss spam across many distinct
 *     URLs can't lock anyone out.
 *   - Strict path validation: anything that isn't `<branch>/<server>/<hash>.jnp`
 *     is rejected with 400 before any origin call.
 */

const REPO = 'usserwout/JNbot-updater';
const RAW = 'https://raw.githubusercontent.com';

// <branch>/<server>/<12-hex-hash>.jnp — branch is `main` or `jndata-N.N.N`.
const PATH_RE = /^(?:main|jndata-\d+\.\d+\.\d+)\/[A-Za-z0-9_.-]+\/[a-f0-9]{12}\.jnp$/;

export async function onRequestGet({ params, request }) {
  const rel = (Array.isArray(params.path) ? params.path.join('/') : String(params.path || '')).trim();

  if (!PATH_RE.test(rel)) {
    return new Response(JSON.stringify({ error: 'invalid plugin path' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  // Serve from the edge cache when warm — immutable, so a hit is always valid.
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), request);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // rel is `<branch>/<server>/<hash>.jnp`; repo stores it under plugins/.
  const slash = rel.indexOf('/');
  const branch = rel.slice(0, slash);
  const rest = rel.slice(slash + 1); // <server>/<hash>.jnp
  const url = `${RAW}/${REPO}/refs/heads/${branch}/plugins/${rest}`;

  let upstream;
  try {
    upstream = await fetch(url);
  } catch {
    return new Response(JSON.stringify({ error: 'plugin fetch failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  if (!upstream.ok) {
    // Don't cache a 404 long — a racing publish may not have landed yet.
    return new Response(JSON.stringify({ error: 'plugin not found' }), {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=10' },
    });
  }

  const body = await upstream.arrayBuffer();
  const res = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Immutable: content-hashed URL never changes, cache it as long as possible.
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
  await cache.put(cacheKey, res.clone());
  return res;
}
