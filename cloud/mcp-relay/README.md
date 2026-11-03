# JNbot MCP relay

The official relay runs at:

```text
https://mcp.jnbot.workers.dev
```

It uses Cloudflare's free `workers.dev` hostname, so no purchased domain is
required. The JNbot operator deploys this service. Desktop users do not deploy
the Worker or enter a relay URL; JNbot includes the official origin and creates
the installation-specific MCP endpoint automatically.

## Deploy on the Cloudflare free plan

Requirements:

- A free Cloudflare account with Workers enabled.
- Node.js 22 or newer.

```bash
cd cloud/mcp-relay
npm ci
npx wrangler login
npx wrangler whoami
npm run check
npm test
npx wrangler deploy --dry-run
npm run deploy
```

The first deployment automatically provisions the `OAUTH_KV` namespace and the
SQLite-backed `InstallationRelay` Durable Object. The deployment updates the
official Worker above. After a user selects **MCP → Remote** and enables
MCP, JNbot displays the full installation endpoint to copy into their
MCP client.

## Validate

```bash
curl -i https://mcp.jnbot.workers.dev/.well-known/oauth-authorization-server
curl -i https://mcp.jnbot.workers.dev/.well-known/oauth-protected-resource
```

Both discovery endpoints should return `200`. A direct unauthenticated request
to an installation `/mcp` endpoint should return `401`, which confirms that
OAuth protection is active.

The Cloudflare free plan has daily limits. When a free limit is reached,
additional operations fail until the limit resets; this project does not need a
Workers Paid subscription. Review current limits before operating the relay for
a large public user base.
