import {
  OAuthProvider,
  type AuthRequest,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { InstallationRelay } from './InstallationRelay';
import { secureJson, sha256, validInstallationId } from './security';
import type { RelayProps } from './types';

const SCOPES = [
  'bot_status',
  'chat_players',
  'inventory_windows',
  'world_entities',
  'bot_controls',
  'bot_scripting',
  'account_joining',
  'plugin_source_reading',
  'plugin_draft_creation',
  'plugin_execution',
  'plugin_network_access',
];

type HandlerEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const INSTALLATION_MCP_PATH = /^\/i\/([a-f0-9]{32})\/mcp$/i;
const INSTALLATION_RESOURCE_METADATA_PATH =
  /^\/\.well-known\/oauth-protected-resource\/i\/([a-f0-9]{32})\/mcp$/i;

function installationStub(env: Env, installationId: string): DurableObjectStub {
  if (!validInstallationId(installationId))
    throw new Error('Invalid installation id');
  return env.INSTALLATIONS.get(env.INSTALLATIONS.idFromName(installationId));
}

function installationFromResource(
  resource: AuthRequest['resource'],
): string | undefined {
  const resources = Array.isArray(resource)
    ? resource
    : resource
      ? [resource]
      : [];
  for (const value of resources) {
    try {
      const match = new URL(value).pathname.match(INSTALLATION_MCP_PATH);
      if (match) return match[1];
    } catch {}
  }
  return undefined;
}

class RelayApi extends WorkerEntrypoint<Env, RelayProps> {
  async fetch(request: Request): Promise<Response> {
    const match = new URL(request.url).pathname.match(INSTALLATION_MCP_PATH);
    if (!match || match[1] !== this.ctx.props.installationId)
      return secureJson({ error: 'installation_scope_mismatch' }, 403);
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.delete('cookie');
    headers.set('x-jnbot-installation', match[1]);
    headers.set('x-jnbot-local-client', this.ctx.props.localClientId);
    headers.set('x-jnbot-scopes', JSON.stringify(this.ctx.props.scopes));
    return installationStub(this.env, match[1]).fetch(
      new Request('https://installation/mcp', {
        method: request.method,
        headers,
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : request.body,
      }),
    );
  }
}

const defaultHandler = {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const env = rawEnv as HandlerEnv;
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return beginAuthorization(request, env);
    if (url.pathname === '/authorize/complete')
      return completeAuthorization(request, env);

    const desktop = url.pathname.match(
      /^\/desktop\/i\/([a-f0-9]{32})\/(register|socket)$/i,
    );
    if (desktop) {
      const suffix =
        desktop[2] === 'register' ? '/desktop/register' : '/desktop/socket';
      if (desktop[2] === 'socket') {
        if (request.headers.get('x-jnbot-installation') !== desktop[1])
          return secureJson({ error: 'installation_identity_mismatch' }, 403);
      } else {
        const body = await request.text();
        if (new TextEncoder().encode(body).byteLength > 16_384)
          return secureJson({ error: 'payload_too_large' }, 413);
        try {
          if (
            (JSON.parse(body) as { installationId?: string }).installationId !==
            desktop[1]
          )
            return secureJson({ error: 'installation_identity_mismatch' }, 403);
        } catch {
          return secureJson({ error: 'invalid_json' }, 400);
        }
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body,
        });
      }
      return installationStub(env, desktop[1]).fetch(
        new Request(`https://installation${suffix}`, request),
      );
    }
    const pairing = url.pathname.match(/^\/pair\/i\/([a-f0-9]{32})\/status$/i);
    if (pairing) {
      return installationStub(env, pairing[1]).fetch(
        new Request(`https://installation/pair/status${url.search}`),
      );
    }
    return secureJson({ error: 'not_found' }, 404);
  },
};

async function beginAuthorization(
  request: Request,
  env: HandlerEnv,
): Promise<Response> {
  const oauth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const installationId = installationFromResource(oauth.resource);
  if (!installationId)
    return secureJson({ error: 'installation_resource_required' }, 400);
  const client = await env.OAUTH_PROVIDER.lookupClient(oauth.clientId);
  if (!client || !strictRedirect(client.redirectUris, oauth.redirectUri))
    return secureJson({ error: 'invalid_redirect_uri' }, 400);
  const requestedScopes = oauth.scope.filter((scope) => SCOPES.includes(scope));
  const requestHash = await sha256(
    JSON.stringify({
      clientId: oauth.clientId,
      redirectUri: oauth.redirectUri,
      scopes: requestedScopes.slice().sort(),
    }),
  );
  const pairingResponse = await installationStub(env, installationId).fetch(
    new Request('https://installation/pair/start', {
      method: 'POST',
      body: JSON.stringify({
        clientName: client.clientName ?? 'MCP client',
        requestHash,
        requestedScopes,
      }),
    }),
  );
  if (!pairingResponse.ok) return pairingResponse;
  const pairing = (await pairingResponse.json()) as {
    pairingId: string;
    code: string;
    expiresAt: number;
    desktopOnline: boolean;
  };
  return new Response(
    pairingHtml(
      installationId,
      pairing,
      urlWithPairing(request.url, pairing.pairingId),
    ),
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

async function completeAuthorization(
  request: Request,
  env: HandlerEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const pairingId = url.searchParams.get('pairing_id');
  if (!pairingId) return secureJson({ error: 'pairing_required' }, 400);
  url.pathname = '/authorize';
  url.searchParams.delete('pairing_id');
  const oauth = await env.OAUTH_PROVIDER.parseAuthRequest(
    new Request(url.toString()),
  );
  const installationId = installationFromResource(oauth.resource);
  if (!installationId)
    return secureJson({ error: 'installation_resource_required' }, 400);
  const statusResponse = await installationStub(env, installationId).fetch(
    `https://installation/pair/status?pairingId=${encodeURIComponent(pairingId)}`,
  );
  if (!statusResponse.ok) return statusResponse;
  const status = (await statusResponse.json()) as {
    status: string;
    approvedScopes?: string[];
    localClientId?: string;
    requestHash: string;
  };
  const expectedHash = await sha256(
    JSON.stringify({
      clientId: oauth.clientId,
      redirectUri: oauth.redirectUri,
      scopes: oauth.scope.filter((scope) => SCOPES.includes(scope)).sort(),
    }),
  );
  if (
    status.status !== 'approved' ||
    !status.localClientId ||
    status.requestHash !== expectedHash
  )
    return secureJson({ error: 'pairing_not_approved' }, 403);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauth,
    userId: installationId,
    metadata: { installationId },
    scope: status.approvedScopes ?? [],
    props: {
      installationId,
      localClientId: status.localClientId,
      scopes: status.approvedScopes ?? [],
    } satisfies RelayProps,
  });
  return Response.redirect(redirectTo, 302);
}

function strictRedirect(registered: string[], redirect: string): boolean {
  if (!registered.includes(redirect)) return false;
  try {
    const url = new URL(redirect);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

function urlWithPairing(urlValue: string, pairingId: string): string {
  const url = new URL(urlValue);
  url.pathname = '/authorize/complete';
  url.searchParams.set('pairing_id', pairingId);
  return url.toString();
}

function pairingHtml(
  installationId: string,
  pairing: {
    pairingId: string;
    code: string;
    expiresAt: number;
    desktopOnline: boolean;
  },
  completeUrl: string,
): string {
  const safe = (value: string) =>
    value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Approve in JNbot</title><style>body{font:16px system-ui;background:#101322;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:520px;background:#1c2035;padding:32px;border-radius:18px;box-shadow:0 20px 70px #0008}.code{font-size:36px;letter-spacing:8px;font-weight:700;margin:20px 0}.muted{color:#aab1cc}.bad{color:#ff8c8c}</style></head><body><main class="card"><h1>Approve this connection in JNbot</h1><p>Open <strong>MCP → Approvals</strong> and confirm this code:</p><div class="code">${safe(pairing.code)}</div><p id="status" class="muted">${pairing.desktopOnline ? 'Waiting for local approval…' : 'JNbot is offline. Enable MCP first.'}</p></main><script>const status=document.getElementById('status');const poll=async()=>{try{const r=await fetch('/pair/i/${safe(installationId)}/status?pairingId=${safe(pairing.pairingId)}',{cache:'no-store'});const x=await r.json();if(x.status==='approved'){status.textContent='Approved. Returning to your AI client…';location.replace(${JSON.stringify(completeUrl)});return}if(x.status==='denied'||x.status==='expired'){status.className='bad';status.textContent='Connection '+x.status+'.';return}}catch{}setTimeout(poll,1000)};poll();</script></body></html>`;
}

const provider = new OAuthProvider<Env>({
  apiRoute: '/i/',
  apiHandler: RelayApi,
  defaultHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: SCOPES,
  allowImplicitFlow: false,
  allowPlainPKCE: false,
  disallowPublicClientRegistration: false,
  refreshTokenTTL: 30 * 24 * 60 * 60,
  accessTokenTTL: 15 * 60,
});

function cors(response: Response, request: Request): Response {
  const origin = request.headers.get('origin');
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', '*');
  headers.set('access-control-allow-headers', 'Authorization, *');
  headers.set('access-control-max-age', '86400');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function installationResourceMetadata(
  request: Request,
  installationId: string,
): Response {
  if (request.method === 'OPTIONS')
    return cors(new Response(null, { status: 204 }), request);
  const origin = new URL(request.url).origin;
  return cors(
    secureJson({
      resource: `${origin}/i/${installationId}/mcp`,
      authorization_servers: [origin],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'JNbot MCP relay',
    }),
    request,
  );
}

function installationChallenge(
  response: Response,
  request: Request,
  installationId: string,
): Response {
  if (response.status !== 401) return response;
  const challenge = response.headers.get('www-authenticate');
  if (!challenge || !/\bresource_metadata="[^"]*"/i.test(challenge))
    return response;
  const url = new URL(request.url);
  const resourceMetadata = `${url.origin}/.well-known/oauth-protected-resource/i/${installationId}/mcp`;
  const headers = new Headers(response.headers);
  headers.set(
    'www-authenticate',
    challenge.replace(
      /\bresource_metadata="[^"]*"/i,
      `resource_metadata="${resourceMetadata}"`,
    ),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const metadata = url.pathname.match(INSTALLATION_RESOURCE_METADATA_PATH);
    if (metadata) return installationResourceMetadata(request, metadata[1]);

    const response = await provider.fetch(request, env, ctx);
    const installation = url.pathname.match(INSTALLATION_MCP_PATH);
    return installation
      ? installationChallenge(response, request, installation[1])
      : response;
  },
} satisfies ExportedHandler<Env>;

export default worker;
export { InstallationRelay };
