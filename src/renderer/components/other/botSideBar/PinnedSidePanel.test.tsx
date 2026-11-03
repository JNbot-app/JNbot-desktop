import { act, render } from '@testing-library/react';
import PinnedSidePanel from './PinnedSidePanel';

jest.mock('./SidePanel', () => () => <div>Panel content</div>);

describe('PinnedSidePanel', () => {
  const disconnect = jest.fn();
  const cancel = jest.fn();
  let finish: () => void;
  const animate = jest.fn(() => ({
    finished: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel,
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    global.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      disconnect,
      unobserve: jest.fn(),
    }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
  });

  const props = {
    active: true,
    tab: 'logs',
    reduceMotion: false,
    onClose: jest.fn(),
    onTabChange: jest.fn(),
    onExited: jest.fn(),
  };

  it('animates only transform/opacity and waits for the exit before unmounting', async () => {
    const view = render(<PinnedSidePanel {...props} />);
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: 'translateX(24px)', opacity: 0 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      expect.objectContaining({ duration: 200 }),
    );
    view.rerender(<PinnedSidePanel {...props} active={false} />);
    expect(props.onExited).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(props.onExited).toHaveBeenCalledTimes(1);
  });

  it('ignores a cancelled close when reopened and cleans up on unmount', async () => {
    const view = render(<PinnedSidePanel {...props} />);
    view.rerender(<PinnedSidePanel {...props} active={false} />);
    const finishClose = finish;
    view.rerender(<PinnedSidePanel {...props} />);
    await act(async () => finishClose());
    expect(props.onExited).not.toHaveBeenCalled();
    view.unmount();
    expect(cancel).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('closes immediately with reduced motion', () => {
    render(<PinnedSidePanel {...props} active={false} reduceMotion />);
    expect(animate).not.toHaveBeenCalled();
    expect(props.onExited).toHaveBeenCalledTimes(1);
  });
});
