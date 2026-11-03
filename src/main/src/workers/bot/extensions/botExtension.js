/** Run the profile's action after the built-in bot plugins are installed. */
function createBotExtension(extension) {
  if (!extension?.code?.trim()) return null;

  return function profileBotAction(bot) {
    // Load the runner after join.js has initialized to avoid an import cycle.
    const { runJS } = require('../../compiler/jsRuntime');
    const { resolvePluginOptions } = require('../plugin/resolvePluginOptions');
    const settings = resolvePluginOptions(extension.info);
    void runJS({
      code: extension.code,
      scriptInfo: extension.info,
      scriptOptions: settings,
      args: [bot, settings, []],
      runAsAction: true,
      allowExportedMain: true,
      useWorkerRealm: true,
      extraGlobals: { __dirname, __filename },
    }).catch((error) => {
      global.log(
        `[botExtension] ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    });
  };
}

module.exports = { createBotExtension };
