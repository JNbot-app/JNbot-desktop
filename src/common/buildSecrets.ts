// Service credentials injected at build time (see esbuild/buildSecrets.js).
// Empty when running from source without a `.env`, e.g. in tests.
type BuildSecrets = {
  b2KeyId: string;
  b2Secret: string;
  turnUsername: string;
  turnCredential: string;
};

declare const __JNBOT_SECRETS__: BuildSecrets | undefined;

export const buildSecrets: Partial<BuildSecrets> =
  typeof __JNBOT_SECRETS__ === 'undefined' ? {} : __JNBOT_SECRETS__;

export const turnServers = (urls: string[]) => {
  const { turnUsername: username, turnCredential: credential } = buildSecrets;
  if (!username || !credential) return [];
  return urls.map((url) => ({ urls: url, username, credential }));
};
