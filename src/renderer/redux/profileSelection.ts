const STORAGE_KEY = 'selectedProfileKey';
const CLEARED_STORAGE_KEY = 'selectedProfileKeyCleared';

const readStorage = (storage: Storage, key: string = STORAGE_KEY): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (
  storage: Storage,
  value: string,
  key: string = STORAGE_KEY,
): void => {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
};

const removeStorage = (storage: Storage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
};

/**
 * Resolve this client's profile without turning the backend's startup default
 * into shared runtime state. Session storage keeps concurrent tabs isolated;
 * local storage restores the last selection in a new session.
 */
export const getSelectedProfileKey = (fallback?: string): string | null =>
  readStorage(window.sessionStorage, CLEARED_STORAGE_KEY) === 'true'
    ? null
    : readStorage(window.sessionStorage) ??
      readStorage(window.localStorage) ??
      fallback ??
      null;

export const persistSelectedProfileKey = (profileKey: string): void => {
  removeStorage(window.sessionStorage, CLEARED_STORAGE_KEY);
  writeStorage(window.sessionStorage, profileKey);
  writeStorage(window.localStorage, profileKey);
};

/**
 * Keep a failed profile from being restored from the backend fallback for the
 * rest of this session. The next start tries the fallback again, because the
 * failure may have been temporary.
 */
export const clearSelectedProfileKey = (): void => {
  removeStorage(window.sessionStorage, STORAGE_KEY);
  removeStorage(window.localStorage, STORAGE_KEY);
  writeStorage(window.sessionStorage, 'true', CLEARED_STORAGE_KEY);
};
