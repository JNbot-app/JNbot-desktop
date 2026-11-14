import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

type HeaderInput = Record<string, unknown> | Array<[string, unknown]> | undefined;
type RequestOptions = {
  method?: string;
  headers?: HeaderInput;
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;
  maxContentLength?: number;
  responseType?: string;
  transformResponse?: Array<(value: any) => any> | ((value: any) => any);
  params?: Record<string, unknown>;
  baseURL?: string;
  url?: string;
  data?: unknown;
};

class MobileHeaders {
  private readonly values = new Map<string, string>();

  constructor(headers: http.IncomingHttpHeaders = {}) {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined)
        this.values.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
    }
  }

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null;
  }

  entries() {
    return this.values.entries();
  }
}

export class MobileResponse {
  readonly ok: boolean;
  readonly headers: MobileHeaders;

  constructor(
    readonly status: number,
    readonly statusText: string,
    headers: http.IncomingHttpHeaders,
    private readonly payload: Buffer,
    readonly url: string,
  ) {
    this.ok = status >= 200 && status < 300;
    this.headers = new MobileHeaders(headers);
  }

  /** The whole payload as one chunk: enough for readers like the AI's event stream (the reply arrives at once). */
  get body() {
    let read = false;
    return {
      getReader: () => ({
        read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (read) return { done: true };
          read = true;
          return { done: false, value: new Uint8Array(this.payload) };
        },
      }),
    };
  }

  async text(): Promise<string> {
    return this.payload.toString('utf8');
  }

  async json(): Promise<any> {
    return JSON.parse(await this.text());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.payload.buffer.slice(
      this.payload.byteOffset,
      this.payload.byteOffset + this.payload.byteLength,
    ) as ArrayBuffer;
  }
}

function normalizedHeaders(input: HeaderInput): Record<string, string> {
  if (!input) return {};
  const entries = Array.isArray(input) ? input : Object.entries(input);
  return Object.fromEntries(
    entries
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [String(key), String(value)]),
  );
}

function requestBody(value: unknown): Buffer | undefined {
  if (value === undefined || value === null) return undefined;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof URLSearchParams) return Buffer.from(value.toString());
  return Buffer.from(JSON.stringify(value));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function isJsonBody(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Buffer.isBuffer(value) &&
    !(value instanceof Uint8Array) && !(value instanceof URLSearchParams);
}

async function request(
  input: string | URL,
  options: RequestOptions = {},
  redirects = 0,
): Promise<MobileResponse> {
  const target = input instanceof URL ? input : new URL(String(input));
  const body = requestBody(options.body);
  const headers = normalizedHeaders(options.headers);
  if (body && isJsonBody(options.body) && !hasHeader(headers, 'content-type'))
    headers['content-type'] = 'application/json';
  if (body && !hasHeader(headers, 'content-length'))
    headers['content-length'] = String(body.byteLength);
  const transport = target.protocol === 'https:' ? https : http;

  return new Promise<MobileResponse>((resolve, reject) => {
    const req = transport.request(target, {
      method: options.method?.toUpperCase() ?? (body ? 'POST' : 'GET'),
      headers,
    });
    const abort = () => req.destroy(new Error('Request aborted'));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    if (options.timeout)
      req.setTimeout(Number(options.timeout), () => req.destroy(new Error('Request timed out')));
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        options.signal?.removeEventListener('abort', abort);
        if (redirects >= 5) return reject(new Error('Too many redirects'));
        const nextOptions =
          status === 303
            ? { ...options, method: 'GET', body: undefined }
            : options;
        void request(new URL(location, target), nextOptions, redirects + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      res.on('data', (chunk) => {
        const buffer = Buffer.from(chunk);
        length += buffer.byteLength;
        if (options.maxContentLength && length > options.maxContentLength) {
          req.destroy(new Error('Response exceeded the configured size limit'));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        options.signal?.removeEventListener('abort', abort);
        resolve(new MobileResponse(
          status,
          res.statusMessage ?? '',
          res.headers,
          Buffer.concat(chunks),
          target.toString(),
        ));
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export function fetch(input: string | URL, options?: RequestOptions): Promise<MobileResponse> {
  return request(input, options);
}

function withParams(url: URL, params?: Record<string, unknown>): URL {
  if (!params) return url;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
    else url.searchParams.set(key, String(value));
  }
  return url;
}

function parseAxiosData(response: MobileResponse, options: RequestOptions): Promise<any> {
  if (options.responseType === 'arraybuffer') return response.arrayBuffer();
  return response.text().then((text) => {
    const transforms = Array.isArray(options.transformResponse)
      ? options.transformResponse
      : options.transformResponse
        ? [options.transformResponse]
        : [];
    if (transforms.length) return transforms.reduce((value, transform) => transform(value), text);
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}

function create(defaults: RequestOptions = {}) {
  const axiosRequest = async (options: RequestOptions) => {
    const merged = {
      ...defaults,
      ...options,
      headers: { ...normalizedHeaders(defaults.headers), ...normalizedHeaders(options.headers) },
    };
    if (!merged.url) throw new TypeError('A request URL is required');
    const target = withParams(
      new URL(String(merged.url), merged.baseURL ? String(merged.baseURL) : undefined),
      merged.params,
    );
    try {
      const response = await fetch(target, {
        ...merged,
        body: merged.data,
      });
      const data = await parseAxiosData(response, merged);
      const result = {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      };
      if (!response.ok) {
        const error = Object.assign(
          new Error(`Request failed with status code ${response.status}`),
          { response: result, isAxiosError: true },
        );
        throw error;
      }
      return result;
    } catch (error) {
      if (error && typeof error === 'object')
        (error as { isAxiosError?: boolean }).isAxiosError = true;
      throw error;
    }
  };
  return {
    get: (url: string, options: RequestOptions = {}) => axiosRequest({ ...options, method: 'GET', url }),
    post: (url: string, data?: unknown, options: RequestOptions = {}) =>
      axiosRequest({ ...options, method: 'POST', url, data }),
    request: axiosRequest,
  };
}

const axios = Object.assign(create(), {
  create,
  isAxiosError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && (error as { isAxiosError?: boolean }).isAxiosError),
});

export default axios;
