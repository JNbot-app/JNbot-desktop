import { workerData } from 'worker_threads';
import _eval from 'eval';
import assert from 'assert';
import type { MacroInfo } from '../../types';
import type { ConsoleAPI } from 'common/types/pluginApi';
import { buildScriptRuntime, type RunContext } from './scriptRuntime';
import join from '../bot/join';
import BotStatemachine from '../bot/statemachines/BotStatemachine';
import Statemachine from '../bot/statemachines/Statemachine';

/* ---------- types ---------- */

export type RunJSOptions = {
  code: string;
  scriptInfo: MacroInfo;

  /** Options specific for this script, set by the user */
  scriptOptions?: Record<string, any>; 
  /** Arguments passed to `main(...args)` when runAsAction is true. */
  args?: any[];
  /** If true, runs the user code, then calls `main(...args)` and resolves with its return value. */
  runAsAction?: boolean;
  /** Accept legacy CommonJS extension entry points as well as main. */
  allowExportedMain?: boolean;
  /** Profile bot actions run beside the bot plugins, including their built-in prototype helpers. */
  useWorkerRealm?: boolean;
  /** Extra values exposed as top-level globals inside the user code (e.g. EXEC's `exit`, `context`). */
  extraGlobals?: Record<string, any>;
  /** The chain this run belongs to and patches for the machines it creates. */
  context?: RunContext;
};

/* ---------- console / log helpers ---------- */

function makeTerminalOutput() {
  return (args: any[], type: 'info' | 'error' | 'warning' | 'success' = 'info') => {
    global.logCall(args, type);
  };
}

/* ---------- main entry point ---------- */

export function runJS(options: RunJSOptions): Promise<any> {
  const {
    code,
    scriptInfo,
    args = [],
    runAsAction = false,
    allowExportedMain = false,
    useWorkerRealm = false,
    extraGlobals = {},
    scriptOptions = {},
    context,
  } = options;

  assert(typeof code === 'string', 'runJS: code must be a string');
  assert(Array.isArray(args), 'runJS: args must be an array');

  return new Promise((resolve, reject) => {
    const terminalOutput = makeTerminalOutput();

    // Typed against the public ConsoleAPI so the sandbox console can't drift
    // from the plugin-facing contract (single-sourced in common/pluginApi.d.ts).
    const consoleApi: ConsoleAPI = {
      log: (...data: any[]) => terminalOutput(data, 'info'),
      error: (...data: any[]) => terminalOutput(data, 'error'),
      warn: (...data: any[]) => terminalOutput(data, 'warning'),
      success: (...data: any[]) => terminalOutput(data, 'success'),
      clear: () => global.send('SIMULATE', ['CLEAR_CONSOLE', scriptInfo?.name]),
    };

    // The jnbot-specific helpers now live in the importable `JNbot` package
    // (require('JNbot')). The same values are still exposed as top-level
    // globals below for backwards compatibility, but are marked @deprecated in
    // the plugin types so new scripts move to the import.
    const { script, require: sandboxRequire } = buildScriptRuntime(scriptInfo, scriptOptions, context);

    const sandbox = {
      // Node globals
      setTimeout,
      setInterval,
      setImmediate,
      clearTimeout,
      clearInterval,
      clearImmediate,
      require: sandboxRequire,
      Math,

      // Deprecated jnbot globals — kept for backwards compatibility.
      // Prefer `require('JNbot')` (e.g. `const { Bot, BotMachine } = require('JNbot')`).
      /** @deprecated use the `Bot` class from require('JNbot') */
      join,
      /** @deprecated use BotMachine instead */
      Statemachine,
      /** @deprecated use BotMachine instead */
      BotStatemachine,
      // Script API (also available as require('JNbot').script)
      /** @deprecated import { script } from 'JNbot' */
      script,

      // Console
      log: terminalOutput,
      console: consoleApi,

      // Action plumbing (only present when runAsAction)
      ...(runAsAction ? { __args__: args, __exit__: resolve, __error__: reject } : {}),

      // Per-call extras
      ...extraGlobals,
    };

    // TS plugins are compiled to CommonJS in the main process (ESM `import`
    // becomes `require`, hoisted to the top), so they run as a plain module with
    // no implicit global-async wrapper — TS has no top-level `await`. JS plugins
    // keep the legacy async wrapper that gives their top-level code `await`.
    // Actions always need the wrapper to `await main()`.
    const isTs = scriptInfo?.language === 'ts';
    let wrappedCode: string;
    if (runAsAction) {
      const entryPoint = allowExportedMain
        ? `(typeof main === 'function' ? main : typeof module.exports === 'function' ? module.exports : module.exports.default || module.exports.inject || module.exports.main)`
        : 'main';
      // User code starts on line 1 so stack-trace lines match the editor.
      wrappedCode = `(async () => { try { ${code}
          const result = await ${entryPoint}(...__args__);
          __exit__(result);
        } catch (error) {
          __error__(error);
        }
      })()`;
    } else if (isTs) {
      wrappedCode = code;
    } else {
      wrappedCode = `(async () => {${code}\n})();`;
    }

    try {
      if (useWorkerRealm) {
        const module = { exports: {} };
        const scope = { ...sandbox, module, exports: module.exports };
        // Profile bot actions historically ran in the worker realm. VM
        // contexts have separate built-in prototypes, so helpers installed
        // by bot plugins (for example String#toAlpha) disappear there.
        // eslint-disable-next-line no-new-func
        const evaluate = new Function(...Object.keys(scope), wrappedCode);
        evaluate(...Object.values(scope));
      } else {
        _eval(wrappedCode, workerData.script, sandbox, false);
      }
    } catch (error) {
      reject(error);
    }

    if (!runAsAction) resolve(undefined);
  });
}

export default runJS;
