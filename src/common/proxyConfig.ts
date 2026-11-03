import type { ProxyConfig } from '../main/src/types';

type LegacyProxyConfig = { enabled?: unknown; url?: unknown; urls?: unknown };

/** Normalize persisted single-proxy settings into the rotating-pool shape. */
export function normalizeProxyConfig(value: unknown): ProxyConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as LegacyProxyConfig;
  const candidates = Array.isArray(raw.urls)
    ? raw.urls
    : typeof raw.url === 'string'
      ? [raw.url]
      : [];
  const urls = candidates.filter((url): url is string => typeof url === 'string')
    .map((url) => url.trim())
    .filter(Boolean);
  return { enabled: raw.enabled === true, urls: [...new Set(urls)] };
}
