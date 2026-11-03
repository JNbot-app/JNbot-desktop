import path from 'path';

const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';
const isCLI = process.env.CLI_MODE === 'true';

/**
 * main.worker.js, run from its bundled location instead of a copy in userData.
 * CLI/dev resolve next to the transpiled sources; packaged builds resolve from
 * the app's resources directory.
 */
export function workerEntryPath() {
  if (process.env.JNBOT_WORKER_ROOT)
    return path.join(process.env.JNBOT_WORKER_ROOT, 'main.worker.js');
  if (isCLI) return path.join(__dirname, '../src/workers/main.worker.js');
  if (isDevelopment)
    return path.join(__dirname, './src/workers/main.worker.js');
  return path.join(process.resourcesPath, './src/workers/main.worker.js');
}

/** the workers' `MC_DATA_PATH` (minecraft-data next to the worker bundle) */
export function workerDataPath() {
  if (process.env.JNBOT_WORKER_ROOT) return process.env.JNBOT_WORKER_ROOT;
  if (isCLI) return path.join(__dirname, '../main/src/workers');
  if (isDevelopment) return path.join(__dirname, './src/workers');
  return path.join(process.resourcesPath, './src/workers');
}
