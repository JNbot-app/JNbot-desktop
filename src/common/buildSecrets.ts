// Service credentials injected at build time (see esbuild/buildSecrets.js).
// Empty when running from source without a `.env`, e.g. in tests.
type BuildSecrets = {
  b2KeyId: string;
  b2Secret: string;
  turnUsername: string;
  turnCredential: string;
};

declare const JNBOT_BUILD_SECRETS: BuildSecrets | undefined;

export const buildSecrets: Partial<BuildSecrets> =
  typeof JNBOT_BUILD_SECRETS === 'undefined' ? {} : JNBOT_BUILD_SECRETS;

export const turnServers = (urls: string[]) => {
  const { turnUsername: username, turnCredential: credential } = buildSecrets;
  if (!username || !credential) return [];
  return urls.map((url) => ({ urls: url, username, credential }));
};
