// Debounced work such as Storage saves would otherwise fire after a test file
// finished and removed its temp dirs, logging into a torn-down environment.
const pending = new Set<ReturnType<typeof setTimeout>>();
const { setTimeout: set, clearTimeout: clear } = global;

global.setTimeout = ((callback: (...args: unknown[]) => void, ...rest: any[]) => {
  const timer = set((...args: unknown[]) => {
    pending.delete(timer);
    callback(...args);
  }, ...rest);
  pending.add(timer);
  return timer;
}) as typeof setTimeout;

afterAll(() => {
  for (const timer of pending) clear(timer);
  pending.clear();
});
