import fs from 'fs';
import path from 'path';
import { freshUserData, cleanupUserData, readJson, writeRaw } from './helpers';
import StorageModule from '../../src/main/src/functions/storage/Storage';

type Doc = { version: number; items: string[] };
const makeDefault = (): Doc => ({ version: 1, items: [] });

afterAll(cleanupUserData);

// Storage debounces saves with a 5s setTimeout; fake timers keep that off the
// real event loop so the suite exits cleanly (see set+close test).
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('StorageModule', () => {
  test('cold start: creates file + dirs and flags isNewUser', () => {
    const file = path.join(freshUserData(), 'nested', 'store.json');
    const store = new StorageModule<Doc>(file, makeDefault);

    expect(store.isNewUser).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(store.get()).toEqual(makeDefault());
    store.close();
  });

  test('existing valid file is read, not overwritten, isNewUser=false', () => {
    const file = path.join(freshUserData(), 'store.json');
    writeRaw(file, JSON.stringify({ version: 1, items: ['a'] }));

    const store = new StorageModule<Doc>(file, makeDefault);
    expect(store.isNewUser).toBe(false);
    expect(store.get().items).toEqual(['a']);
    store.close();
  });

  test('corrupt JSON falls back to default instead of throwing', () => {
    const file = path.join(freshUserData(), 'store.json');
    writeRaw(file, '{ this is : not json ]');

    let store!: StorageModule<Doc>;
    expect(() => {
      store = new StorageModule<Doc>(file, makeDefault);
    }).not.toThrow();
    expect(store.get()).toEqual(makeDefault());
    store.close();
  });

  test('validate=false replaces loaded data with default', () => {
    const file = path.join(freshUserData(), 'store.json');
    writeRaw(file, JSON.stringify({ version: 1, items: 'not-an-array' }));

    const store = new StorageModule<Doc>(file, makeDefault, {
      validate: (d) => Array.isArray(d.items),
    });
    expect(store.get().items).toEqual([]);
    store.close();
  });

  test('set + close persists to disk and is re-readable', () => {
    const file = path.join(freshUserData(), 'store.json');
    const store = new StorageModule<Doc>(file, makeDefault);
    store.set({ version: 2, items: ['x', 'y'] });
    store.close(); // flushes pending save

    expect(readJson(file)).toEqual({ version: 2, items: ['x', 'y'] });
  });

  test('close is idempotent', () => {
    const file = path.join(freshUserData(), 'store.json');
    const store = new StorageModule<Doc>(file, makeDefault);
    store.set({ version: 2, items: ['saved'] });

    expect(() => {
      store.close();
      store.close();
    }).not.toThrow();
    expect(readJson(file)).toEqual({ version: 2, items: ['saved'] });
  });

  test('afterRead transforms data on load', () => {
    const file = path.join(freshUserData(), 'store.json');
    writeRaw(file, JSON.stringify({ version: 1, items: ['a'] }));
    const store = new StorageModule<Doc>(file, makeDefault, {
      afterRead: (d) => ({ ...d, items: [...d.items, 'injected'] }),
    });
    expect(store.get().items).toEqual(['a', 'injected']);
    store.close();
  });
});
