import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import http from 'node:http';
import axios, { fetch as mobileFetch } from '../../src/mobile-backend/mobileHttp';

describe('mobile HTTP adapter', () => {
  let requestSpy: jest.SpiedFunction<typeof http.request>;
  let written = '';

  beforeEach(() => {
    written = '';
    requestSpy = jest.spyOn(http, 'request').mockImplementation(((input: URL) => {
      const request = new EventEmitter() as any;
      request.write = (chunk: unknown) => { written += Buffer.from(chunk as any).toString('utf8'); };
      request.setTimeout = jest.fn();
      request.destroy = (error: Error) => request.emit('error', error);
      request.end = () => {
        const redirect = input.pathname === '/redirect';
        const body = input.pathname === '/echo' ? written : JSON.stringify({ ok: true });
        const response = Readable.from([Buffer.from(body)]) as any;
        response.statusCode = redirect ? 302 : 200;
        response.statusMessage = redirect ? 'Found' : 'OK';
        response.headers = redirect
          ? { location: '/json' }
          : { 'content-type': input.pathname === '/echo' ? 'text/plain' : 'application/json', 'x-test': 'yes' };
        request.emit('response', response);
      };
      return request;
    }) as typeof http.request);
  });

  afterEach(() => requestSpy.mockRestore());

  it('implements the response methods prismarine-auth uses and follows redirects', async () => {
    const response = await mobileFetch('http://mobile.test/redirect');
    expect(response.ok).toBe(true);
    expect(response.headers.get('x-test')).toBe('yes');
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it('preserves raw Axios transformResponse semantics', async () => {
    const response = await axios.get('http://mobile.test/json', {
      transformResponse: [(value: string) => value],
    });
    expect(response.data).toBe('{"ok":true}');
  });

  it('passes form bodies through unchanged', async () => {
    const response = await mobileFetch('http://mobile.test/echo', {
      method: 'POST',
      body: new URLSearchParams({ code: 'ABC' }).toString(),
    });
    await expect(response.text()).resolves.toBe('code=ABC');
  });

  it('encodes object bodies as JSON with the matching content type', async () => {
    const response = await axios.post('http://mobile.test/echo', { username: 'Steve' });
    expect(written).toBe('{"username":"Steve"}');
    expect(requestSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
      'content-type': 'application/json',
      'content-length': '20',
    });
    expect(response.data).toEqual({ username: 'Steve' });
  });
});
