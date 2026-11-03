import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { MacroLanguage } from '../types';

/**
 * TypeScript -> JavaScript type-stripping for plugin code.
 *
 * We use the WASM build of esbuild (not the native binary) so there is no
 * per-platform binary to ship in the packaged Electron app — just a single
 * `esbuild.wasm`. Transpilation runs in the main process and the resulting
 * plain JS is handed to the worker, so workers never need a transpiler.
 *
 * Two important details:
 *
 *  1. We load the *browser* build (`browser.js`), not the package's node entry.
 *     The node entry doesn't run the wasm in-process — it shells out to a
 *     `node` child process running `bin/esbuild`, which doesn't exist in a
 *     packaged app. The browser build instantiates the wasm directly here, and
 *     we hand it the compiled module ourselves.
 *
 *  2. The packaged app ships `release/app/node_modules` (native deps only), not
 *     the root `node_modules`, so `esbuild-wasm` is never packaged. The build
 *     copies the two files we need (`browser.js` + `esbuild.wasm`) into
 *     `dist/main/src/esbuild-wasm/`, which electron-builder ships through
 *     `extraResources` (see esbuild/copyEsbuildWasm.js). We resolve them from
 *     `__dirname` (dev) / `process.resourcesPath` (packed) — the same scheme
 *     used for `main.worker.js`.
 */

// Minimal shape of the esbuild-wasm browser API we actually use.
type EsbuildWasm = {
  initialize(opts: {
    worker?: boolean;
    wasmModule?: WebAssembly.Module;
    wasmURL?: string;
  }): Promise<void>;
  transform(
    code: string,
    opts: { loader: 'ts'; format?: 'cjs' | 'esm' | 'iife' },
  ): Promise<{ code: string }>;
};

const isDev = process.env.NODE_ENV === 'development';

let esbuild: EsbuildWasm | null = null;
let ready: Promise<void> | null = null;

/** Directory holding the copied `browser.js` + `esbuild.wasm`. */
function assetDir(): string {
  return isDev
    ? path.join(__dirname, 'src', 'esbuild-wasm')
    : path.join(process.resourcesPath, 'src', 'esbuild-wasm');
}

function init(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const dir = assetDir();

    // Load the in-process browser build by absolute file URL (the files live on
    // disk, never inside the asar, so this works in both dev and packed).
    const mod = (await import(
      pathToFileURL(path.join(dir, 'browser.js')).href
    )) as unknown as EsbuildWasm;

    // Hand esbuild the compiled wasm ourselves so it never has to discover the
    // file on disk. `worker: false` keeps everything on this thread (no web
    // Worker / worker thread whose script path would have to be resolved).
    const wasmBytes = await fs.promises.readFile(
      path.join(dir, 'esbuild.wasm'),
    );
    const wasmModule = await WebAssembly.compile(wasmBytes);
    await mod.initialize({ worker: false, wasmModule });
    esbuild = mod;
  })().catch((err) => {
    // Drop the cached promise so a later call can retry after a transient
    // failure instead of being stuck with a rejected singleton.
    ready = null;
    throw err;
  });
  return ready;
}

/**
 * Convert plugin source to runnable JavaScript. Only TypeScript is processed;
 * every other language is returned unchanged.
 *
 * TS is compiled with `format: 'cjs'`, which both strips the types AND rewrites
 * ES-module `import`/`export` into CommonJS `require`/`module.exports` (with the
 * imports hoisted to the top). The plugin runtime evaluates code as CommonJS, so
 * leaving `import` syntax in would throw "Cannot use import statement outside a
 * module". The trade-off is that CommonJS cannot express top-level `await`, so TS
 * plugins run without the implicit global-async wrapper JS plugins get — see the
 * friendly error below.
 */
export async function toRunnableJs(
  code: string,
  language: MacroLanguage | undefined,
): Promise<string> {
  if (language !== 'ts' || !code) return code;
  // The embedded mobile artifact is deliberately WASM-free. TypeScript's
  // compiler is bundled as JavaScript and only strips/transforms TS syntax.
  if (process.env.JNBOT_MOBILE_RUNTIME === 'true') {
    const { default: ts } = await import('typescript');
    return ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      reportDiagnostics: true,
    }).outputText;
  }
  await init();
  try {
    const result = await esbuild!.transform(code, {
      loader: 'ts',
      format: 'cjs',
    });
    return result.code;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/top-level await/i.test(message)) {
      throw new Error(
        'TypeScript plugins run as CommonJS modules and cannot use top-level ' +
          '`await`. Wrap your code in an async function — e.g. ' +
          '`(async () => { /* ... */ })()` — or use `.then()`.',
      );
    }
    throw err;
  }
}

export default toRunnableJs;
