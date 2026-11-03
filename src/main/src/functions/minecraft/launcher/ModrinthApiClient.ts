import axios, { type AxiosInstance } from 'axios';

const CACHE_TTL_MS = 5 * 60_000;

export class ModrinthApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModrinthApiError';
  }
}

export const normalizeModrinthError = (error: unknown) => {
  if (error instanceof ModrinthApiError) return error;
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { description?: unknown; error?: unknown }
      | undefined;
    const message =
      typeof data?.description === 'string'
        ? data.description
        : typeof data?.error === 'string'
          ? data.error
          : error.code === 'ECONNABORTED'
            ? 'The Modrinth request timed out'
            : 'Unable to reach Modrinth';
    return new ModrinthApiError(message, error.response?.status);
  }
  return error instanceof Error
    ? error
    : new ModrinthApiError('An unknown Modrinth error occurred');
};

class ModrinthApiClient {
  private readonly client: AxiosInstance = axios.create({
    baseURL: 'https://api.modrinth.com/v2',
    timeout: 30_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'JNbot/1.0.0 (https://jnbot.netlify.app/)',
    },
  });

  private readonly cache = new Map<
    string,
    { expiresAt: number; value: Promise<unknown> }
  >();

  get<T>(endpoint: string, params?: object): Promise<T> {
    const key = `${endpoint}:${JSON.stringify(params ?? {})}`;
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > Date.now())
      return existing.value as Promise<T>;
    const value = this.client
      .get<T>(endpoint, { params })
      .then((response) => response.data)
      .catch((error) => {
        this.cache.delete(key);
        throw normalizeModrinthError(error);
      });
    this.cache.set(key, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    });
    return value;
  }
}

export default new ModrinthApiClient();
