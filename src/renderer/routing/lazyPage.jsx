import { lazy } from 'react';

const preloaders = [];

// React.lazy suspends on its first render even when the chunk is already
// loaded. Once preloaded we render the module directly, so no fallback shows.
export default function lazyPage(factory, { preload = true } = {}) {
  let Loaded;
  let promise;
  const load = () => {
    promise ??= factory().then((m) => {
      Loaded = m.default;
      return m;
    });
    return promise;
  };
  const Lazy = lazy(load);
  const Page = (props) => (Loaded ? <Loaded {...props} /> : <Lazy {...props} />);
  if (preload) preloaders.push(load);
  return Page;
}

const idle = (cb) =>
  window.requestIdleCallback ? window.requestIdleCallback(cb) : setTimeout(cb, 50);

// Loads page chunks one at a time while the app is idle, so it doesn't compete with startup work.
export function preloadPages() {
  const next = () => {
    const load = preloaders.shift();
    if (load) idle(() => load().catch(() => {}).finally(next));
  };
  next();
}
