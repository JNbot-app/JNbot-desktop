const { workerData, parentPort, threadId } = require('worker_threads');
const v8 = require('v8');
const fs = require('fs/promises');
const path = require('path');

if (workerData.appSettings?.worker_optimize_for_size) {
  v8.setFlagsFromString('--optimize_for_size');
}

workerData.id = workerData.script + '-' + threadId;
global.appSettings = workerData.appSettings;
global.isMobileRuntime = Boolean(workerData.isMobileRuntime);

global.settings = workerData.settings;
global.sharedSettings = workerData.sharedSettings;

require('./globals');

process.on('uncaughtException', (err) => {
  handleError(err);
});

process.on('unhandledRejection', handleError);

async function handleError(err) {
  if (!workerData.scriptOptions?.disableConsolePrints) console.log(err);

  if (err instanceof Error || typeof err?.message === 'string') {
    send('ERROR', {
      message: err.message || ' unknown Error',
      stack: err.stack || '',
      name: err.name || 'Unknown Error',
    });
  } else {
    let nonErrorMessage;
    try {
      nonErrorMessage = JSON.stringify(await err);
    } catch (e) {
      nonErrorMessage = 'Cannot convert non-Error value to JSON string';
    }
    send('ERROR', {
      message: nonErrorMessage,
      stack: err.stack || '',
      name: 'NonError',
    });
  }

  if (err.message?.includes('ECONNRESET')) {
    global.log(
      'received a ECONNRESET error, this means that the connection to the server was lost. If this error persists, please report it to the usserwout .',
      'error',
    );
    global.log(err, 'error');
    return;
  }

  global.log(err.toString() + '\n' + (err.stack || ''), 'error');
  if (workerData.scriptName === 'macro' && !workerData.data?.devMode) {
    if (err.message?.includes('ECONNRESET')) return;
    global.sendToClients('notification', {
      title: workerData.script + ' error',
      message:
        'An error has occurred in the ' +
        workerData.script +
        ' plugin. Open the logs to see the error.',
      type: 'error',
    });
  }
  if (
    err.message?.includes(
      'The value of "offset" is out of range. It must be >= 0 and <= 10239. Received ',
    )
  ) {
    /**
     * This error is most likely caused by a bugged sign
     */
    global.log(
      'This error is likely caused by a bugged sign. Try to move your alt to another position away from the current place. If the error persists, please report it to the usserwout.',
      'error',
    );
    global.sendToClients('notification', {
      title: workerData.script + ' error',
      message:
        'An error occurred, please check logs for information and possible fix.',
      type: 'error',
    });
  } else if (err.message?.includes('EPERM: operation not permitted, open')) {
    global.log(
      'This error is caused because JNbot does not have permission to read a file. Please check the permissions of JNbot and try again.',
      'error',
    );
  } else if (err.message?.includes('client timed out after ')) {
    global.log(
      'Client timed out, likely due to connection issues. Attempting to continue...',
      'warning',
    );
    return;
  } else if (err.message?.includes('write ECONNABORTED')) {
    global.log(
      '[write ECONNABORTED] Your own host (local) aborted the connection while there was still data in the pipeline. If this happens too often, please report it to the usserwout (via discord) .',
      'warning',
    );
    return;
  }

  setTimeout(() => {
    process.exit(1);
  }, 2);
}

parentPort.on('close', () => {
  process.exit(0);
});

// Check if the MC_DATA_PATH is valid for some reason it's missing for some people, perhaps make it auto install it.
async function verifyMcData(_data) {
  if (!process.env.MC_DATA_PATH) console.error('MC_DATA_PATH is not set');
  const mcDataPath = process.env.MC_DATA_PATH;
  const versionPath = path.join(mcDataPath, 'data/pc');
  if (!(await fs.stat(versionPath).catch(() => false))) {
    console.error(
      `mcData path is invalid: ${versionPath} does not exist. Try to reinstall jnbot. If this error persists, contact usserwout (on discord).`,
    );
  }
}
verifyMcData();
//log(`Starting ${workerData.script} (${workerData.id})`);

const { ALL_SCRIPT_NAMES } = require('./scriptList');

const SCRIPTS = {
  macro: () => require('./bot/plugin/runner').default,
  chat: () => require('./scripts/chat'),
  // 'gkit collector': () => require('./scripts/gkitCollectorV3'),
  // 'gkit upgrader': () => require('./scripts/gkitUpgraderV2'),
  // afk: () => require('./scripts/afkV2'),
  // altScanner: () => require('./scripts/altScannerV2'),
  // 'kit collector': () => require('./scripts/kitCollectorV2'),
  // 'book sorter': () => require('./scripts/bookSorter'),
  discordBot: () => require('./scripts/discord/discordBot').default,
  chain: () => require('./scripts/chains/runChain').default,
  jnbotproxy: () => require('./scripts/JNbotProxy/startProxy').default,
  mcpSession: () => require('./scripts/mcpSession').default,
  brainTask: () => require('./brain/task').default,
};

const missingFromScripts = ALL_SCRIPT_NAMES.filter(
  (name) => !(name in SCRIPTS),
);
if (missingFromScripts.length > 0) {
  console.error(
    'scriptList.js lists scripts not present in SCRIPTS map:',
    missingFromScripts,
  );
}

if (workerData.scriptName in SCRIPTS) {
  // Load script
  const script = SCRIPTS[workerData.scriptName]();
  send('READY');
  /**
   * data: script arguments
   * scriptOptions: script options : ```
              startTime: Date.now(),
                ips: this.scriptHandler.workingIps || [],
                disableConsolePrints: process.env.CLI_MODE === 'true',
                ```
   * 
   */
  script(workerData.data, workerData.scriptOptions);
} else {
  console.log('UNKNOWN SCRIPT: ', workerData.scriptName);
  send('READY');
  process.exit(0);
}
