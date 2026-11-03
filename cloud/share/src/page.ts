import {
  SHARE_KIND_LABELS,
  shareBannerUrl,
  shareDeepLink,
  type ShareItemSummary,
  type ShareListing,
  type ShareRecord,
} from '../../../src/common/share';

const DOWNLOAD_URL = 'https://jnbot.netlify.app/';

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=60',
  'content-security-policy':
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

/** Same fingerprint the app shows: sha256 of the SPKI key, base64url. */
async function fingerprint(publicKey: string): Promise<string> {
  const der = Uint8Array.from(
    atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
    (character) => character.charCodeAt(0),
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
  const base64Url = btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return base64Url.slice(0, 16).match(/.{1,4}/g)!.join(' ');
}

function itemList(items: ShareItemSummary[]): string {
  if (!items.length) return '';
  const rows = items
    .map(
      (item) => `<li><div class="item-name">${escapeHtml(item.name)}${
        item.type ? ` <span class="tag">${escapeHtml(item.type)}</span>` : ''
      }</div>${
        item.description
          ? `<div class="muted">${escapeHtml(item.description)}</div>`
          : ''
      }</li>`,
    )
    .join('');
  return `<h2>Contents (${items.length})</h2><ul class="items">${rows}</ul>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · JNbot</title>
<style>
:root{--bg:#f5f5f5;--card:#fff;--text:#1f1f1f;--muted:#6b6b6b;--border:#e5e5e5;--accent:#1677ff;--tag:#f0f0f0}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1f1f1f;--text:#f0f0f0;--muted:#a0a0a0;--border:#303030;--accent:#4096ff;--tag:#2a2a2a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:48px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px}
.kind{color:var(--accent);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.04em}
h1{margin:4px 0 8px;font-size:24px;overflow-wrap:anywhere}
h2{font-size:15px;margin:24px 0 8px}
.muted{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.description{white-space:pre-wrap;overflow-wrap:anywhere}
.publisher{margin:16px 0;padding:12px;border:1px solid var(--border);border-radius:8px}
.fingerprint{font-family:ui-monospace,monospace;font-size:12px}
.items{list-style:none;padding:0;margin:0;border:1px solid var(--border);border-radius:8px}
.items li{padding:8px 12px;border-top:1px solid var(--border)}
.items li:first-child{border-top:0}
.item-name{font-weight:500;overflow-wrap:anywhere}
.tag{font-size:12px;font-weight:400;background:var(--tag);border-radius:4px;padding:1px 6px}
.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:24px}
.button{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px}
a{color:var(--accent)}
.note{margin-top:16px}
.banner{display:block;width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:16px}
.badge{display:inline-block;margin-left:8px;font-size:12px;font-weight:600;color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:0 6px;text-transform:none;letter-spacing:0}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export async function sharePage(record: ShareRecord, origin: string): Promise<Response> {
  const listing = JSON.parse(record.listing) as ShareListing;
  const listed = record.visibility === 'public' && !!record.approval;
  const banner = record.hasBanner ? shareBannerUrl(record.id, record.revision, origin) : listing.bannerUrl;
  const body = `<div class="card">
${banner ? `<img class="banner" alt="" src="${escapeHtml(banner)}">` : ''}
<div class="kind">${SHARE_KIND_LABELS[record.kind]}${listed ? '<span class="badge">Reviewed · Marketplace</span>' : ''}</div>
<h1>${escapeHtml(listing.title)}</h1>
${listing.description ? `<div class="description">${escapeHtml(listing.description)}</div>` : ''}
<div class="publisher">
<div>Shared by <strong>${escapeHtml(record.ownerName)}</strong></div>
<div class="muted">Publisher fingerprint <span class="fingerprint">${await fingerprint(record.ownerKey)}</span></div>
<div class="muted">Updated ${new Date(record.updatedAt).toUTCString()} · Needs JNbot ${escapeHtml(listing.minAppVersion)} or newer</div>
</div>
${itemList(listing.items)}
<div class="actions">
<a class="button" href="${shareDeepLink(record.id)}">Open in JNbot</a>
<a href="${DOWNLOAD_URL}">Don't have JNbot?</a>
</div>
<p class="muted note">JNbot shows everything inside this share before installing. Only install plugins from people you trust: plugins can run code on your computer.</p>
</div>`;
  return new Response(layout(listing.title, body), { headers: PAGE_HEADERS });
}

export function notFoundPage(): Response {
  return new Response(
    layout(
      'Link not found',
      `<div class="card"><h1>Link not found</h1><p class="muted">This share link does not exist or was removed by its owner.</p></div>`,
    ),
    { status: 404, headers: PAGE_HEADERS },
  );
}
