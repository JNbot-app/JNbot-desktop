/** Run a resolved profile action's `main(bot, settings, args)` and resolve with its result. */
function runProfileAction(action, bot, args = []) {
  // Load the runner after join.js has initialized to avoid an import cycle.
  const { runJS } = require('../../compiler/jsRuntime');
  const { resolvePluginOptions } = require('../plugin/resolvePluginOptions');
  const settings = resolvePluginOptions(action.info);
  return runJS({
    code: action.code,
    scriptInfo: action.info,
    scriptOptions: settings,
    args: [bot, settings, args],
    runAsAction: true,
    allowExportedMain: true,
    useWorkerRealm: true,
    extraGlobals: { __dirname, __filename },
  });
}

/** Run the profile's action after the built-in bot plugins are installed. */
function createBotExtension(extension) {
  if (!extension?.code?.trim()) return null;

  return function profileBotAction(bot) {
    void runProfileAction(extension, bot).catch((error) => {
      global.log(
        `[botExtension] ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    });
  };
}

module.exports = { createBotExtension, runProfileAction };
