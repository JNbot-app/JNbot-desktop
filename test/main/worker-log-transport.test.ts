import { LogStatus } from '../../src/common/CommonEnums';
import { workerData } from 'worker_threads';

const send = jest.fn();
jest.mock('worker_threads', () => ({
  workerData: { scriptOptions: { disableConsolePrints: false }, scriptName: 'test' },
}));
jest.mock('../../src/main/src/workers/lib/workerScript', () => ({
  default: {
    send: (...args: unknown[]) => send(...args),
    onMessage: jest.fn(),
    sendToClients: jest.fn(),
    messenger: {},
  },
}));

test('a console call prints and transports one bounded snapshot', () => {
  jest.useFakeTimers();
  const print = jest.spyOn(console, 'log').mockImplementation(() => {});
  const previousLog = global.log;
  const previousLogCall = global.logCall;
  const previousEmitWarning = process.emitWarning;
  const exitListeners = new Set(process.listeners('exit'));

  try {
    jest.isolateModules(() => require('../../src/main/src/workers/globals'));
    global.logCall(['ready', { items: Array.from({ length: 50_000 }, (_, id) => id) }]);
    expect(print).toHaveBeenCalledTimes(1);
    expect(Buffer.byteLength(print.mock.calls[0][0])).toBeLessThanOrEqual(8 * 1024);
    jest.advanceTimersByTime(30);
    expect(send).toHaveBeenCalledTimes(1);
    const [event, logs] = send.mock.calls[0];
    expect(event).toBe('LOG');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toBe(LogStatus.INFO);
    expect(logs[0][0]).toEqual(['ready', expect.anything()]);
    expect(JSON.stringify(logs[0][0])).toContain('truncated');
    expect(Buffer.byteLength(JSON.stringify(logs[0][0]))).toBeLessThanOrEqual(8 * 1024);
  } finally {
    for (const listener of process.listeners('exit')) {
      if (!exitListeners.has(listener)) process.removeListener('exit', listener);
    }
    process.emitWarning = previousEmitWarning;
    global.log = previousLog;
    global.logCall = previousLogCall;
    print.mockRestore();
    jest.useRealTimers();
  }
});

test('disabled terminal printing still transports bounded logs', () => {
  jest.useFakeTimers();
  send.mockClear();
  workerData.scriptOptions.disableConsolePrints = true;
  const previousConsoleLog = console.log;
  const previousConsoleError = console.error;
  const previousConsoleWarn = console.warn;
  const previousLog = global.log;
  const previousLogCall = global.logCall;
  const previousEmitWarning = process.emitWarning;
  const exitListeners = new Set(process.listeners('exit'));

  try {
    jest.isolateModules(() => require('../../src/main/src/workers/globals'));
    global.logCall([{ items: Array.from({ length: 50_000 }, (_, id) => id) }]);
    jest.advanceTimersByTime(30);
    expect(send).toHaveBeenCalledTimes(1);
    expect(Buffer.byteLength(JSON.stringify(send.mock.calls[0][1]))).toBeLessThanOrEqual(8 * 1024);
  } finally {
    for (const listener of process.listeners('exit')) {
      if (!exitListeners.has(listener)) process.removeListener('exit', listener);
    }
    workerData.scriptOptions.disableConsolePrints = false;
    console.log = previousConsoleLog;
    console.error = previousConsoleError;
    console.warn = previousConsoleWarn;
    process.emitWarning = previousEmitWarning;
    global.log = previousLog;
    global.logCall = previousLogCall;
    jest.useRealTimers();
  }
});
