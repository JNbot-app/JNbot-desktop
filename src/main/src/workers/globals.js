const { workerData } = require('worker_threads');
const workerScript = require('./lib/workerScript').default;
const { LogStatus } = require('../../../common/CommonEnums');
const serializer = require('./compiler/serializer');

//process.env.DEBUG = 'minecraft-protocol';


const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  if (
    (typeof warning === 'string' && warning.includes('DeprecationWarning')) ||
    (typeof warning === 'object' && (warning?.name === 'DeprecationWarning' || warning?.code?.startsWith?.('DEP'))) ||
    args[0] === 'DeprecationWarning' ||
    (typeof args[1] === 'string' && args[1].startsWith('DEP'))
  ) {
    return;
  }
  return originalEmitWarning.apply(process, [warning, ...args]);
};


const logToEnum = {
  info: LogStatus.INFO,
  warn: LogStatus.WARN,
  warning: LogStatus.WARN,
  error: LogStatus.ERROR,
  success: LogStatus.SUCCESS,
};

let consoleMessages = [];
let droppedMessages = 0;
let flushTimer;
const printLog = workerData.scriptOptions?.disableConsolePrints
  ? () => {}
  : (message) => console.log(serializer.logLine(message));
if (workerData.scriptOptions?.disableConsolePrints) {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
}

function logCall(args, type = 'info') {
  const preview = serializer.default(args);
  printLog(preview);

  if (consoleMessages.length >= 100) {
    consoleMessages.splice(0, 50);
    droppedMessages += 50;
  }
  consoleMessages.push([preview, logToEnum[type] ?? LogStatus.INFO]);
  if (!flushTimer) flushTimer = setTimeout(flushConsole, 30);
}
function log(message, type = 'info') {
  logCall([message], type);
}
function flushConsole() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (droppedMessages) {
    consoleMessages.unshift([
      `[${droppedMessages} log entries omitted]`,
      LogStatus.WARN,
    ]);
    droppedMessages = 0;
  }
  if (consoleMessages.length > 0) {
    workerScript.send('LOG', consoleMessages);
    consoleMessages = [];
  }
}

workerScript.onMessage('TERMINATE', flushConsole);
process.on('exit', flushConsole);

workerScript.onMessage('STOP_BOT', () => {
  process.exit(0);
});

global.client = workerScript;
global.messenger = workerScript.messenger;
global.send = workerScript.send.bind(workerScript);
global.sendToClients = workerScript.sendToClients.bind(workerScript);
global.log = log;
global.logCall = logCall;
global.IS_MACRO = workerData.scriptName === 'macro';
