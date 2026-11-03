import { act, render, screen } from '@testing-library/react';
import PageLoading from './PageLoading';

describe('PageLoading', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('keeps quick loads quiet and reveals the skeleton after the delay', () => {
    const { container } = render(<PageLoading layout="rows" />);

    act(() => jest.advanceTimersByTime(179));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('.ant-skeleton')).toBeNull();

    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    expect(container.querySelector('.ant-skeleton')).not.toBeNull();
    expect(container.querySelector('.ant-skeleton-active')).toBeNull();
  });

  test('cleans up the delay when the page finishes loading', () => {
    const { unmount } = render(<PageLoading />);
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('starts a fresh delay when navigating to another pending page', () => {
    const { rerender } = render(<PageLoading key="accounts" layout="rows" />);
    act(() => jest.advanceTimersByTime(180));
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<PageLoading key="editor" layout="editor" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(180));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
