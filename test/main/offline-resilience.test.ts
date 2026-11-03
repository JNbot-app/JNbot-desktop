import https from 'https';
import EventEmitter from 'events';
import uuid from '../../src/main/src/functions/actions/uuid';
import pingServer from '../../src/main/src/functions/minecraft/pingServer';
import { normalizeModrinthError, ModrinthApiError } from '../../src/main/src/functions/minecraft/launcher/ModrinthApiClient';

describe('Offline and Network Failure Resilience', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Mojang UUID fetcher (uuid.ts) when offline', () => {
    it('returns null on DNS resolution failure (ENOTFOUND)', async () => {
      jest.spyOn(https, 'get').mockImplementation((options: any, cb: any): any => {
        const req: any = new EventEmitter();
        setImmediate(() => {
          const err: any = new Error('getaddrinfo ENOTFOUND api.mojang.com');
          err.code = 'ENOTFOUND';
          req.emit('error', err);
        });
        return req;
      });

      const result = await uuid('Steve');
      expect(result).toBeNull();
    });

    it('returns null on connection refused or socket timeout (ECONNREFUSED / ETIMEDOUT)', async () => {
      jest.spyOn(https, 'get').mockImplementation((options: any, cb: any): any => {
        const req: any = new EventEmitter();
        setImmediate(() => {
          const err: any = new Error('connect ECONNREFUSED 127.0.0.1:443');
          err.code = 'ECONNREFUSED';
          req.emit('error', err);
        });
        return req;
      });

      const result = await uuid('Alex');
      expect(result).toBeNull();
    });

    it('returns null if https.get throws synchronously (e.g. network interface down)', async () => {
      jest.spyOn(https, 'get').mockImplementation(() => {
        throw new Error('Network is down');
      });

      const result = await uuid('Steve');
      expect(result).toBeNull();
    });

    it('returns null when receiving captive portal or HTML 502/503 error page', async () => {
      jest.spyOn(https, 'get').mockImplementation((options: any, cb: any): any => {
        const req: any = new EventEmitter();
        const res: any = new EventEmitter();
        res.setEncoding = jest.fn();

        setImmediate(() => {
          cb(res);
          res.emit('data', '<html><body>503 Service Unavailable / Offline</body></html>');
          res.emit('end');
        });
        return req;
      });

      const result = await uuid('Steve');
      expect(result).toBeNull();
    });

    it('returns null when response body is empty', async () => {
      jest.spyOn(https, 'get').mockImplementation((options: any, cb: any): any => {
        const req: any = new EventEmitter();
        const res: any = new EventEmitter();
        res.setEncoding = jest.fn();

        setImmediate(() => {
          cb(res);
          res.emit('end');
        });
        return req;
      });

      const result = await uuid('NonExistentUser');
      expect(result).toBeNull();
    });

    it('returns id when response is valid JSON from Mojang', async () => {
      jest.spyOn(https, 'get').mockImplementation((options: any, cb: any): any => {
        const req: any = new EventEmitter();
        const res: any = new EventEmitter();
        res.setEncoding = jest.fn();

        setImmediate(() => {
          cb(res);
          res.emit('data', JSON.stringify({ id: '8667ba71b85a3004af544b3459c75342', name: 'Steve' }));
          res.emit('end');
        });
        return req;
      });

      const result = await uuid('Steve');
      expect(result).toBe('8667ba71b85a3004af544b3459c75342');
    });
  });

  describe('Modrinth client error normalization when offline', () => {
    it('normalizes network disconnect / ENOTFOUND into user-friendly message', () => {
      const axiosError: any = new Error('getaddrinfo ENOTFOUND api.modrinth.com');
      axiosError.isAxiosError = true;
      axiosError.code = 'ENOTFOUND';

      const normalized = normalizeModrinthError(axiosError);
      expect(normalized).toBeInstanceOf(ModrinthApiError);
      expect(normalized.message).toBe('Unable to reach Modrinth');
    });

    it('normalizes timeout into user-friendly message', () => {
      const axiosError: any = new Error('timeout of 30000ms exceeded');
      axiosError.isAxiosError = true;
      axiosError.code = 'ECONNABORTED';

      const normalized = normalizeModrinthError(axiosError);
      expect(normalized).toBeInstanceOf(ModrinthApiError);
      expect(normalized.message).toBe('The Modrinth request timed out');
    });
  });

  describe('Server Ping (pingServer) when offline / unreachable', () => {
    it('rejects with error when server refuses connection', async () => {
      await expect(pingServer('127.0.0.1', 59998, 300)).rejects.toThrow();
    });
  });
});
