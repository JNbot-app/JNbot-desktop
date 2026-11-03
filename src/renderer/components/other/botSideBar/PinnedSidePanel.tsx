import { useEffect, useLayoutEffect, useRef } from 'react';
import SidePanel from './SidePanel';

interface PinnedSidePanelProps {
  active: boolean;
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  onExited: () => void;
  reduceMotion: boolean;
}

export default function PinnedSidePanel({
  active,
  tab,
  onTabChange,
  onClose,
  onExited,
  reduceMotion,
}: PinnedSidePanelProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const fixedRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const fixed = fixedRef.current;
    if (!slot || !fixed) return;
    const update = () => {
      const rect = slot.getBoundingClientRect();
      fixed.style.left = `${rect.left}px`;
      fixed.style.width = `${rect.width}px`;
      fixed.style.visibility = 'visible';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(slot);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    const node = fixedRef.current;
    if (!node) return;
    node.inert = !active;
    if (reduceMotion || !node.animate) {
      if (!active) onExited();
      return;
    }
    let current = true;
    const frames = [
      { transform: 'translateX(24px)', opacity: 0 },
      { transform: 'translateX(0)', opacity: 1 },
    ];
    const animation = node.animate(active ? frames : frames.slice().reverse(), {
      duration: 200,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    });
    void animation.finished
      .then(() => {
        if (!current) return;
        if (!active) onExited();
        else animation.cancel();
      })
      .catch(() => {}); // Cancellation is expected on rapid toggles/unmount.
    return () => {
      current = false;
      animation.cancel();
    };
  }, [active, reduceMotion, onExited]);

  return (
    <div ref={slotRef} style={{ width: '100%', height: '100%', zIndex: 99 }}>
      <div
        ref={fixedRef}
        aria-hidden={!active}
        style={{
          position: 'fixed',
          height: 'calc(100vh - 5rem)',
          zIndex: 99,
          overflow: 'hidden',
          visibility: 'hidden',
          pointerEvents: active ? undefined : 'none',
        }}
      >
        <SidePanel
          activeTab={tab}
          onTabChange={onTabChange}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
