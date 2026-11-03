import { EventEmitter } from 'node:events';

const installProxyKeepAlive = require('../../src/main/src/workers/bot/proxyKeepAlive');

test('proxy-routed client replies to keep-alives without starting a watchdog', () => {
  jest.useFakeTimers();
  const client = new EventEmitter() as EventEmitter & { write: jest.Mock };
  client.write = jest.fn();
  installProxyKeepAlive(client);

  client.emit('keep_alive', { keepAliveId: [0, 123] });

  expect(client.write).toHaveBeenCalledWith('keep_alive', {
    keepAliveId: [0, 123],
  });
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
