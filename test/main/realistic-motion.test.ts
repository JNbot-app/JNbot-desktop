import { EventEmitter } from 'events';

const realisticMotionExtension = require('../../src/main/src/workers/bot/extensions/realisticMotionExtension');

function createBot() {
  const bot = new EventEmitter() as any;
  bot._client = Object.assign(new EventEmitter(), { state: 'play', write: jest.fn() });
  bot.supportFeature = (feature: string) => feature === 'sendsClientTickEndPacket';
  bot.getControlState = () => false;
  realisticMotionExtension(bot);
  bot._client.emit('login');
  return bot;
}

const ticksSent = (bot: any) => bot._client.write.mock.calls.filter(([name]: [string]) => name === 'tick_end').length;

/** Mineflayer's physics loop: one tick per 50 ms, catching up after a late interval. */
function physics(bot: any) {
  let last = Date.now();
  let accumulator = 0;
  return setInterval(() => {
    accumulator += Date.now() - last;
    last = Date.now();
    for (let n = 0; accumulator >= 50 && n < 4; n++, accumulator -= 50) bot.emit('physicsTickEnd');
  }, 50);
}

describe('realistic motion tick_end', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends one tick_end per physics tick', () => {
    const bot = createBot();
    physics(bot);
    jest.advanceTimersByTime(1000);
    expect(ticksSent(bot)).toBe(20);
  });

  it('never gets ahead of real time after a stall', () => {
    const bot = createBot();
    physics(bot);
    jest.advanceTimersByTime(1000);
    // The event loop is blocked for 300 ms: no timer runs, then both the
    // fallback and physics' catch-up fire.
    jest.setSystemTime(Date.now() + 300);
    jest.advanceTimersByTime(1000);
    expect(ticksSent(bot)).toBeLessThanOrEqual(46); // 2300 ms of real time
    expect(ticksSent(bot)).toBeGreaterThanOrEqual(45);
  });

  it('keeps ticking from the fallback while physics is idle', () => {
    const bot = createBot();
    jest.advanceTimersByTime(1000);
    expect(ticksSent(bot)).toBeGreaterThanOrEqual(18);
    expect(ticksSent(bot)).toBeLessThanOrEqual(21);
  });

  it('drops a long backlog instead of bursting it', () => {
    const bot = createBot();
    physics(bot);
    jest.setSystemTime(Date.now() + 5000);
    jest.advanceTimersByTime(50);
    expect(ticksSent(bot)).toBeLessThanOrEqual(11);
  });
});
