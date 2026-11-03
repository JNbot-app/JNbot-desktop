import { createHash, timingSafeEqual } from 'node:crypto';

const SECRET_KEY =
  /(password|passwd|token|secret|authorization|cookie|session|credential|private.?key|auth.?cache)/i;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashToolArguments(
  tool: string,
  args: Record<string, unknown>,
): string {
  return sha256(canonicalJson({ tool, args }));
}

export function safeHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function redactMcpValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactMcpValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([childKey, item]) => [childKey, redactMcpValue(item, childKey)],
      ),
    );
  }
  if (typeof value === 'string') {
    if (/^bearer\s+[a-z0-9._~-]+$/i.test(value)) return '[REDACTED]';
    if (value.length > 8_192) return `${value.slice(0, 8_192)}…`;
  }
  return value;
}

export function sanitizeError(error: unknown, maxLength = 500): string {
  const message = error instanceof Error ? error.message : String(error);
  return String(redactMcpValue(message)).slice(0, maxLength);
}

export function consumeRateLimit(
  windows: Map<string, number[]>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const recent = (windows.get(key) ?? []).filter(
    (timestamp) => timestamp > now - windowMs,
  );
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  return true;
}
