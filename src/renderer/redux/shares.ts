import { create } from 'zustand';
import { shareUpdateAvailable, type MarketEntry, type ShareKind, type ShareState } from '../../common/share';

export const useShares = create<ShareState>(() => ({
  owned: {},
  installed: {},
  appVersion: '',
  reviewer: false,
}));

let initialized = false;
/**
 * Loads the shares and keeps them in sync; safe to call repeatedly.
 * The backend refreshes update info at most once a day on this call.
 */
export function initShares(): void {
  // Also reloads on every call: the backend drops installs whose local copy was deleted.
  void window.ipcRenderer
    .get<ShareState>('SHARE_STATE')
    .then((state) => useShares.setState(state))
    .catch(() => {});
  if (initialized) return;
  initialized = true;
  window.ipcRenderer.on('shares', (state: ShareState) => useShares.setState(state));
}

/** Refresh review status and updates now (the backend throttles this). */
export const refreshShares = () => {
  initShares();
  void window.ipcRenderer.get('SHARE_CHECK_UPDATES').catch(() => {});
};

export const useOwnedShare = (kind: ShareKind, ref: string, profileKey?: string) =>
  useShares((state) =>
    Object.values(state.owned).find(
      (share) => share.kind === kind && share.ref === ref && share.profileKey === profileKey,
    ),
  );

/** The share an item was installed from, when it has an update this app can install. */
export const useShareUpdate = (kind: ShareKind, localRef: string) =>
  useShares((state) =>
    Object.values(state.installed).find(
      (share) =>
        share.kind === kind && share.localRef === localRef && shareUpdateAvailable(share, state.appVersion),
    ),
  );

/** The share an item was installed from, if any. */
export const useInstalledShare = (kind: ShareKind, localRef: string) =>
  useShares((state) =>
    Object.values(state.installed).find((share) => share.kind === kind && share.localRef === localRef),
  );

type Result<T> = { status: 'success'; data: T } | { status: 'error'; message: string };

/** Asks the server for the latest revision of one install now; resolves to whether it has an update. */
export async function checkShareUpdate(id: string): Promise<boolean> {
  const result = await window.ipcRenderer.get<Result<ShareState>>('SHARE_CHECK_UPDATES', id);
  if (result.status === 'error') throw new Error(result.message);
  useShares.setState(result.data);
  const share = result.data.installed[id];
  return !!share && shareUpdateAvailable(share, result.data.appVersion);
}

interface MarketState {
  /** null until the first load. */
  entries: MarketEntry[] | null;
  loading: boolean;
  error?: string;
}

/** The marketplace catalog; the backend caches it and revalidates with an ETag. */
export const useMarket = create<MarketState>(() => ({ entries: null, loading: false }));

export async function loadMarket(force = false): Promise<void> {
  if (useMarket.getState().loading) return;
  useMarket.setState({ loading: true });
  const result = await window.ipcRenderer.get<Result<MarketEntry[]>>('SHARE_MARKET', force).catch(() => null);
  useMarket.setState(
    result?.status === 'success'
      ? { entries: result.data, loading: false, error: undefined }
      : {
          loading: false,
          error: result?.status === 'error' ? result.message : 'Could not load the marketplace.',
        },
  );
}
