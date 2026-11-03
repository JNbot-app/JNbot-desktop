import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('JNbot MCP relay', () => {
  it('publishes OAuth discovery with PKCE and dynamic registration', async () => {
    const response = await SELF.fetch(
      'https://mcp.test-account.workers.dev/.well-known/oauth-authorization-server',
    );
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as Record<string, unknown>;
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.registration_endpoint).toContain('/register');
  });

  it('rejects invalid installation routes without creating a Durable Object', async () => {
    const response = await SELF.fetch(
      'https://mcp.test-account.workers.dev/desktop/i/not-an-id/register',
      {
        method: 'POST',
        body: '{}',
      },
    );
    expect(response.status).toBe(404);
    expect(env.INSTALLATIONS).toBeTruthy();
  });

  it('requires OAuth on installation MCP endpoints', async () => {
    const installationId = '0123456789abcdef0123456789abcdef';
    const response = await SELF.fetch(
      `https://mcp.test-account.workers.dev/i/${installationId}/mcp`,
      { method: 'POST', body: '{}' },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="https://mcp.test-account.workers.dev/.well-known/oauth-protected-resource/i/${installationId}/mcp"`,
    );
  });

  it('publishes installation-specific protected resource metadata', async () => {
    const installationId = '0123456789abcdef0123456789abcdef';
    const response = await SELF.fetch(
      `https://mcp.test-account.workers.dev/.well-known/oauth-protected-resource/i/${installationId}/mcp`,
      { headers: { origin: 'https://claude.ai' } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://claude.ai',
    );
    await expect(response.json()).resolves.toMatchObject({
      resource: `https://mcp.test-account.workers.dev/i/${installationId}/mcp`,
      authorization_servers: [
        'https://mcp.test-account.workers.dev',
      ],
      bearer_methods_supported: ['header'],
    });
  });

  it('accepts a full installation URL as the OAuth resource', async () => {
    const installationId = '0123456789abcdef0123456789abcdef';
    const redirectUri = 'https://client.example/callback';
    const registration = await SELF.fetch(
      'https://mcp.test-account.workers.dev/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test MCP client',
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
        }),
      },
    );
    expect(registration.status).toBe(201);
    const { client_id: clientId } = (await registration.json()) as {
      client_id: string;
    };
    const authorize = new URL(
      'https://mcp.test-account.workers.dev/authorize',
    );
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: 'test-code-challenge',
      code_challenge_method: 'S256',
      state: 'test-state',
      scope: 'bot_status',
      resource: `https://mcp.test-account.workers.dev/i/${installationId}/mcp`,
    }).toString();

    const response = await SELF.fetch(authorize);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Approve this connection in JNbot');
  });

  it('replays pending pairing requests when the desktop connects', async () => {
    const installationId = 'abcdef0123456789abcdef0123456789';
    const relay = env.INSTALLATIONS.getByName(installationId);
    const pairing = await relay.fetch('https://installation/pair/start', {
      method: 'POST',
      body: JSON.stringify({
        clientName: 'ChatGPT',
        requestHash: 'request-hash',
        requestedScopes: ['bot_status'],
      }),
    });
    const pairingData = (await pairing.json()) as { pairingId: string };
    expect(pairing.status).toBe(200);
    expect(pairingData.pairingId).toBeTruthy();
    const frame = await runInDurableObject(relay, (instance) => {
      const messages: string[] = [];
      const replay = instance as unknown as {
        sendPendingPairings(socket: Pick<WebSocket, 'send'>): void;
      };
      replay.sendPendingPairings({
        send(message) {
          messages.push(String(message));
        },
      });
      return JSON.parse(messages[0]) as Record<string, unknown>;
    });

    expect(frame).toMatchObject({
      type: 'pairing_request',
      pairingId: pairingData.pairingId,
      clientName: 'ChatGPT',
      requestedScopes: ['bot_status'],
    });
  });
});
