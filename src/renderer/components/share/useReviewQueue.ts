import { create } from 'zustand';
import type { MarketEntry } from '../../../common/share';

/** Reviewer queue: pending submissions and reported shares. */
export const useReviewQueue = create<{ entries: MarketEntry[] | null; loading: boolean }>(() => ({
  entries: null,
  loading: false,
}));

type Result<T> = { status: 'success'; data: T } | { status: 'error'; message: string };

export async function loadReviewQueue(): Promise<void> {
  useReviewQueue.setState({ loading: true });
  const result = await window.ipcRenderer.get<Result<MarketEntry[]>>('SHARE_REVIEW_QUEUE').catch(() => null);
  useReviewQueue.setState({ loading: false, ...(result?.status === 'success' ? { entries: result.data } : {}) });
}
