import { SHARE_ID_PATTERN, SHARE_REVISION_PATTERN } from '../../../src/common/share';
import { getRecord, getRow } from './db';
import { error, readLimited } from './http';
import { notFoundPage, sharePage } from './page';
import { countInstall, getBanner, getContent, getMarket, getRevisions, getShare } from './routes/read';
import { reviewQueue, reviewShare } from './routes/review';
import { createShare, deleteShare, reportShare, unlistShare, updateShare } from './routes/write';

// /api/s/<id>[/<action>[/<revision>]]
const API_ROUTE = /^\/api\/s\/([A-Za-z0-9]+)(?:\/(content|banner|unlist|report|review|install)(?:\/([a-f0-9]+))?)?$/;

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const { method } = request;

  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type, if-none-match',
      },
    });
  }
  if (method === 'GET' || pathname === '/api/revisions' || pathname.endsWith('/install')) {
    const limited = await readLimited(request, env);
    if (limited) return limited;
  }
  if (pathname === '/api/s' && method === 'PUT') return createShare(request, env);
  if (pathname === '/api/market' && method === 'GET') return getMarket(request, env);
  if (pathname === '/api/revisions' && method === 'POST') return getRevisions(request, env);
  if (pathname === '/api/review' && method === 'GET') return reviewQueue(request, env);

  const page = /^\/s\/([^/]+)\/?$/.exec(pathname);
  if (page && method === 'GET') {
    const record = SHARE_ID_PATTERN.test(page[1]) ? await getRecord(env, page[1]) : null;
    return record ? sharePage(record, new URL(request.url).origin) : notFoundPage();
  }

  const api = API_ROUTE.exec(pathname);
  if (!api || !SHARE_ID_PATTERN.test(api[1])) return error(404, 'Not found');
  const [, id, action, revision] = api;
  if (action === 'content' || action === 'banner') {
    if (method !== 'GET' || !revision || !SHARE_REVISION_PATTERN.test(revision)) return error(404, 'Not found');
    return action === 'content' ? getContent(env, id, revision) : getBanner(env, id, revision);
  }
  if (!action && method === 'GET') return getShare(env, id);
  if (action === 'install' && method === 'POST') return countInstall(env, id);

  const row = await getRow(env, id);
  if (!row) return error(404, 'Share not found');
  if (!action && method === 'PUT') return updateShare(request, env, row, pathname);
  if (!action && method === 'DELETE') return deleteShare(request, env, row, pathname);
  if (action === 'unlist' && method === 'POST') return unlistShare(request, env, row, pathname);
  if (action === 'report' && method === 'POST') return reportShare(request, env, row, pathname);
  if (action === 'review' && method === 'POST') return reviewShare(request, env, row, pathname);
  return error(405, 'Method not allowed');
}

export default { fetch: route } satisfies ExportedHandler<Env>;
