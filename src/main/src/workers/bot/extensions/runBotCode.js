const _eval = require('eval');
const { default: snapshotLog, logLine, MAX_LOG_BYTES } = require('../../compiler/serializer');
const node_globals = {
  setTimeout,
  setInterval,
  setImmediate,
  clearTimeout,
  clearInterval,
  clearImmediate,
};

/**
 * runAsAction: (boolean): run script by calling the main function & stopping script after main function finished
 * args: argument passed to the main function (used if runAsAction = true)
 */

async function runJsBotCode({ code, bot, onLog, timeoutMs }) {
  const controller = new AbortController();
  let timeout;
  const execution = new Promise((resolve, reject) => {
    let settled = false;
    function terminalOutput(type, data) {
      const colors = {
        error: '\x1b[31m', // red
        warning: '\x1b[33m', // yellow
        success: '\x1b[32m', // green
        info: '\x1b[37m', // white
      };
      const color = colors[type] || '';
      const reset = '\x1b[0m';
      const serialized = logLine(snapshotLog(data), MAX_LOG_BYTES - color.length - reset.length);
      bot.messenger?.publish('codeLogs', color + serialized + reset);
      onLog?.({ type, message: serialized });
    }
    function exit(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }
    function error(err) {
      if (settled) return;
      terminalOutput('error', [err]);
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    let allCode =
      '(async () => { try { const __result__ = await (async () => { ' +
      code +
      '\n})(); __exit__(__result__) } catch (e) { __error__(e) } })();';

    try {
      _eval(
        allCode,
        'bot_code',
        {
          bot,
          console: {
            log: (...data) => terminalOutput('info', data),
            error: (...data) => terminalOutput('error', data),
            warn: (...data) => terminalOutput('warning', data),
            success: (...data) => terminalOutput('success', data),
            info: (...data) => terminalOutput('info', data),
          },
          __exit__: exit,
          __error__: error,
          signal: controller.signal,
          ...node_globals,
        },
        false,
      );
    } catch (err) {
      error(err);
    }
  });

  if (!timeoutMs) return execution;
  const timed = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      bot.clearControlStates?.();
      reject(new Error(`Bot script timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([execution, timed]);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = runJsBotCode;
