import React, {
  CSSProperties,
  ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export type Breakpoint = 'sm' | 'md' | 'lg';

export type BreakpointThresholds = {
  // Container width below this is 'sm'
  sm: number;
  // Container width below this (and >= sm) is 'md'; otherwise 'lg'
  md: number;
};

const DEFAULT_THRESHOLDS: BreakpointThresholds = { sm: 760, md: 1080 };

let lastWidth: number | null = null;
let lastBreakpoint: Breakpoint =
  typeof window !== 'undefined'
    ? window.innerWidth < DEFAULT_THRESHOLDS.sm
      ? 'sm'
      : window.innerWidth < DEFAULT_THRESHOLDS.md
        ? 'md'
        : 'lg'
    : 'lg';

export const getBreakpoint = (
  width: number,
  thresholds: BreakpointThresholds = DEFAULT_THRESHOLDS,
): Breakpoint => {
  if (width <= 0) return lastBreakpoint;
  if (width < thresholds.sm) return 'sm';
  if (width < thresholds.md) return 'md';
  return 'lg';
};

export function useContainerBreakpoint<T extends HTMLElement = HTMLDivElement>(
  thresholds: BreakpointThresholds = DEFAULT_THRESHOLDS,
) {
  const ref = useRef<T | null>(null);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => {
    if (lastWidth !== null) {
      return getBreakpoint(lastWidth, thresholds);
    }
    return lastBreakpoint;
  });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = (width: number) => {
      if (width <= 0) return;
      lastWidth = width;
      const next = getBreakpoint(width, thresholds);
      lastBreakpoint = next;
      setBreakpoint((current) => (current === next ? current : next));
    };

    const rect = node.getBoundingClientRect();
    if (rect.width > 0) {
      update(rect.width);
    }

    const observer = new ResizeObserver((entries) => {
      if (!entries.length) return;
      const entryWidth = entries[0].contentRect.width;
      if (entryWidth > 0) {
        update(entryWidth);
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [thresholds.sm, thresholds.md]);

  return { ref, breakpoint };
}

type ContainerBreakpointProps = {
  children: (breakpoint: Breakpoint) => ReactNode;
  thresholds?: BreakpointThresholds;
  style?: CSSProperties;
  className?: string;
};

const ContainerBreakpoint: React.FC<ContainerBreakpointProps> = ({
  children,
  thresholds,
  style,
  className,
}) => {
  const { ref, breakpoint } = useContainerBreakpoint(thresholds);
  return (
    <div
      ref={ref}
      className={className}
      style={{ width: '100%', ...style }}
    >
      {children(breakpoint)}
    </div>
  );
};

export default ContainerBreakpoint;
