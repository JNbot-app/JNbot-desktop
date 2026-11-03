const { EventEmitter } = require('events');
const workerScript = require('../../lib/workerScript').default;

class BotControlBus {
  constructor() {
    this._queue = [];
    this._emitter = new EventEmitter();
    this._attached = false;
    this._handler = null;
    this._attachGlobalListeners();
  }

  _attachGlobalListeners() {
    if (this._attached) return;
    const MAX_QUEUE_SIZE = 100; // Prevent unbounded queue growth

    const push = (type) => (payload) => {
      if (this._handler) {
        this._handler(type, payload);
      } else {
        this._queue.push({ type, payload, ts: Date.now() });
        // Prevent memory leak from unbounded queue growth
        if (this._queue.length > MAX_QUEUE_SIZE) {
          this._queue.shift(); // Remove oldest command
        }
        this._emitter.emit('new');
      }
    };

    workerScript.onMessage('NEXT_BOT', push('next'));
    workerScript.onMessage('RELOG_BOT', push('relog'));
    workerScript.onMessage('PREV_BOT', push('prev'));
    workerScript.onMessage('PAUSE_BOT', push('pause'));
    workerScript.onMessage('RESUME_BOT', push('resume'));
  

    this._attached = true;
  }

  startHandling(resolve, botStatemachine) {
    this._handler = (type, payload) => {
      let status;
      let botId = payload?.botId;
      if (type === 'next') status = 1;
      else if (type === 'relog') status = 2;
      else if (type === 'prev') status = 3;
      else if (type === 'pause') {
        botStatemachine.pause(botId);
        return;
      } else if (type === 'resume') {
        botStatemachine.resume(botId);
        botStatemachine.start();
        return;
      }
      resolve(status);
      botStatemachine.resume(botId);
      botStatemachine.stop();
    };
  }

  stopHandling() {
    this._handler = null;
  }

  async waitForCommand({ filter, timeoutMs } = {}) {
    const idx = this._queue.findIndex((c) => (filter ? filter(c) : true));
    if (idx !== -1) {
      const [cmd] = this._queue.splice(idx, 1);
      return cmd;
    }

    return new Promise((resolve) => {
      let timeout;
      const onNew = () => {
        const i = this._queue.findIndex((c) => (filter ? filter(c) : true));
        if (i !== -1) {
          const [cmd] = this._queue.splice(i, 1);
          cleanup();
          resolve(cmd);
        }
      };

      const cleanup = () => {
        this._emitter.removeListener('new', onNew);
        if (timeout) clearTimeout(timeout);
      };

      this._emitter.on('new', onNew);
      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          cleanup();
          resolve(null);
        }, timeoutMs);
      }
    });
  }
}

let _bus;
function getBotControlBus() {
  if (!_bus) _bus = new BotControlBus();
  return _bus;
}

module.exports = { getBotControlBus };
