/** Cloudflare Pages proxy in front of the JNbot-updater repo (scripts/cloudflare-jndata). */
export const JNDATA_PROXY_BASE = 'https://jnbot-jndata.pages.dev';

/** raw.githubusercontent fallback for when the proxy is unreachable. */
export const UPDATER_RAW_BASE =
  'https://raw.githubusercontent.com/usserwout/JNbot-updater';
