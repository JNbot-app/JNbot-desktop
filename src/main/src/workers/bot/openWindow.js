const assert = require("assert")


/**
 * Open a minecraft window with command
 */

const inject = (bot) => {

  /**
   *
   * @param {*} command
   * @param {*} options
   * @returns window object | null if failed
   */
  bot.openWindow = function (command, options = {}) {
    const {
      timeout = 3000,         // Max time before timing out
      check = () => true,     // Check correct window is opened
      commandInverval = 2000, // Time between each command
      ticks = 0,                // Timeout in ticks
      signal = {aborted:false} // Abort signal
    } = options
    assert(typeof command === "string", "command must be a string")
    assert(typeof timeout === "number", "timeout must be a number")
    assert(command.startsWith("/"), "command must start with /")
    assert(check, "check option must be a function")

    if (!bot.isOnline() || signal.aborted) return

    if (bot.currentWindow) {
      console.log("Closing window");
      bot.closeWindow(bot.currentWindow);
    }

    return new Promise((resolve) => {
      let windowTimeout = setTimeout(cleanup, timeout)
      if (bot && ticks) bot.waitForTicks(ticks).then(cleanup)

      let cmdInterval = setInterval(() => {
        if (signal.aborted) return cleanup()
        bot.chat(command)

      }, commandInverval)

      bot.once("windowOpen", windowOpenHandler)
      bot.chat(command)


      function windowOpenHandler(win) {
        if (signal.aborted) return cleanup()
        if (check(win)) {
          cleanup(win)
        }
      }

      function cleanup(win = null) {
        clearTimeout(windowTimeout)
        bot.removeListener("windowOpen", windowOpenHandler)
        clearInterval(cmdInterval)
        resolve(win)
      }
    })
  }
}

module.exports = inject
