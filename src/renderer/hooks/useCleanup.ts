/**
 * Component cleanup utility to prevent memory leaks
 * Helps manage intervals, timeouts, and event listeners in React components
 */

import { useEffect, useRef } from 'react';

export interface CleanupManager {
  addInterval: (callback: () => void, delay: number) => void;
  addTimeout: (callback: () => void, delay: number) => void;
  addEventListener: (element: EventTarget, event: string, handler: EventListenerOrEventListenerObject) => void;
  addIPCListener: (event: string, handler: (...args: any[]) => void) => void;
  cleanup: () => void;
}

/**
 * Custom hook for managing component cleanup
 * Automatically cleans up all registered resources on component unmount
 */
export const useCleanupManager = (): CleanupManager => {
  const cleanupFunctions = useRef<(() => void)[]>([]);

  const addInterval = (callback: () => void, delay: number) => {
    const intervalId = setInterval(callback, delay);
    cleanupFunctions.current.push(() => clearInterval(intervalId));
  };

  const addTimeout = (callback: () => void, delay: number) => {
    const timeoutId = setTimeout(callback, delay);
    cleanupFunctions.current.push(() => clearTimeout(timeoutId));
  };

  const addEventListener = (
    element: EventTarget, 
    event: string, 
    handler: EventListenerOrEventListenerObject
  ) => {
    element.addEventListener(event, handler);
    cleanupFunctions.current.push(() => element.removeEventListener(event, handler));
  };

  const addIPCListener = (event: string, handler: (...args: any[]) => void) => {
    if (typeof window !== 'undefined' && window.ipcRenderer) {
      const removeListener = window.ipcRenderer.on(event, handler);
      cleanupFunctions.current.push(removeListener);
    }
  };

  const cleanup = () => {
    cleanupFunctions.current.forEach(cleanupFn => {
      try {
        cleanupFn();
      } catch (error) {
        console.warn('Error during cleanup:', error);
      }
    });
    cleanupFunctions.current = [];
  };

  useEffect(() => {
    return cleanup;
  }, []);

  return {
    addInterval,
    addTimeout,
    addEventListener,
    addIPCListener,
    cleanup
  };
};

/**
 * Safe interval hook that automatically cleans up
 */
export const useSafeInterval = (callback: () => void, delay: number | null, deps: any[] = []) => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback reference up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay !== null) {
      intervalRef.current = setInterval(() => callbackRef.current(), delay);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
};

/**
 * Safe timeout hook that automatically cleans up
 */
export const useSafeTimeout = (callback: () => void, delay: number | null, deps: any[] = []) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay !== null) {
      timeoutRef.current = setTimeout(() => callbackRef.current(), delay);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
};

/**
 * Safe IPC listener hook that automatically cleans up
 */
export const useSafeIPCListener = (event: string, handler: (...args: any[]) => void, deps: any[] = []) => {
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ipcRenderer) {
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      const removeListener = window.ipcRenderer.on(event, handler);
      return removeListener;
    }
    return () => {}; // Return empty cleanup function if no IPC
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
};

/**
 * Component-level memory leak detector
 */
export const useMemoryLeakDetector = (componentName: string) => {
  const renderCount = useRef(0);
  const startTime = useRef(Date.now());
  
  useEffect(() => {
    renderCount.current++;
    
    const checkMemoryLeak = () => {
      const runtime = Date.now() - startTime.current;
      const renderRate = renderCount.current / (runtime / 1000);
      
      if (renderRate > 10) { // More than 10 renders per second for extended time
        console.warn(`🚨 Potential memory leak in ${componentName}: High render rate (${renderRate.toFixed(2)} renders/sec)`);
      }
      
      if (renderCount.current > 1000) { // More than 1000 renders
        console.warn(`🚨 Potential memory leak in ${componentName}: Excessive renders (${renderCount.current})`);
      }
    };

    const timeoutId = setTimeout(checkMemoryLeak, 5000); // Check after 5 seconds
    return () => clearTimeout(timeoutId);
  });

  return {
    renderCount: renderCount.current,
    runtime: Date.now() - startTime.current
  };
};
