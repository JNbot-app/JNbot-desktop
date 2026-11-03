const { workerData } = require('worker_threads');
const workerScript = require('../lib/workerScript').default;
global.appSettings.server ||= 'jartexnetwork';
function sleep(x) {
  return new Promise((resolve) => setTimeout(resolve, x));
}


const IPS = workerData?.scriptOptions?.ips || [
  'proxy001.jartexsys.net',
  'proxy002.jartexsys.net',
  'proxy003.jartexsys.net',
  'proxy004.jartexsys.net',
  'proxy005.jartexsys.net',
  'proxy006.jartexsys.net',
  'proxy007.jartexsys.net',
];
class AltCounter {
  count = 0;
  gotoNextAlt = false;

  increment() {
    this.count++;
    this.gotoNextAlt = false;
  }

  decrease(amount) {
    this.count -= amount;
  }
}

function updateProgress(current, total) {
  global.send('PROGRESS_UPDATE', {
    current: Math.floor(current),
    total,
  });
}

class BotController {
  constructor(altCount) {
    this.altCount = altCount;
    this.events();
  }

  events() {
    workerScript.onMessage('NEXT_BOT', () => {
      console.log('NEXT_BOT');
      this.altCount.gotoNextAlt = true;
      this.abort();
    });
    workerScript.onMessage('PREV_BOT', () => {
      console.log('PREV_BOT');
      this.altCount.decrease(2);
      this.altCount.gotoNextAlt = true;
      this.abort();
    });
    workerScript.onMessage('RELOG_BOT', () => {
      this.restart();
    });
  }

  restart() {
    console.log('RELOG_BOT');
    this.altCount.decrease(1);
    this.altCount.gotoNextAlt = true;
    this.abort();
  }

  abort() {
    if (this.abortController && !this.abortController?.signal?.aborted) {
      this.abortController.abort();
    }
  }

  setAbortController(abortController) {
    this.abortController = abortController;
  }
}

/**
 * 
 * @param {string} scriptName 
 * @return {Record<string, unknown>} script settings
 * @returns 
 */
function getScriptSettings(scriptName) {
  return (
    global.settings.scripts?.[scriptName] ?? {}
  );
}
function getScriptGamemode() {
  return (
    global.settings.scripts?.gamemode ??
    'skyblockdream'
  );
}

module.exports = {
  updateProgress,
  AltCounter,
  BotController,
  getScriptSettings,
  getScriptGamemode,
};
