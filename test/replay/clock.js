/**
 * Virtual clock: replaces the timer globals, Date.now and performance.now so a
 * replay advances game time deterministically instead of in real time.
 * setImmediate / nextTick stay real, so promises and streams keep working.
 */
const { performance } = require('perf_hooks');

class VirtualClock {
  now = 0;
  /** Receives errors thrown by timer callbacks; they rethrow when unset. */
  onError = null;
  #timers = new Map();
  #nextId = 1;
  #saved = null;
  #epoch = 0;

  install() {
    if (this.#saved) return this;
    const g = globalThis;
    this.#saved = {
      setTimeout: g.setTimeout,
      clearTimeout: g.clearTimeout,
      setInterval: g.setInterval,
      clearInterval: g.clearInterval,
      dateNow: Date.now,
    };
    this.#epoch = Date.now();
    g.setTimeout = (fn, ms, ...args) => this.#add(fn, ms, args, false);
    g.setInterval = (fn, ms, ...args) => this.#add(fn, ms, args, true);
    g.clearTimeout = g.clearInterval = (timer) => {
      this.#timers.delete(typeof timer === 'object' && timer ? timer.id : timer);
    };
    Date.now = () => this.#epoch + this.now;
    performance.now = () => this.now;
    return this;
  }

  uninstall() {
    if (!this.#saved) return;
    const g = globalThis;
    g.setTimeout = this.#saved.setTimeout;
    g.clearTimeout = this.#saved.clearTimeout;
    g.setInterval = this.#saved.setInterval;
    g.clearInterval = this.#saved.clearInterval;
    Date.now = this.#saved.dateNow;
    delete performance.now; // falls back to the prototype method
    this.#saved = null;
    this.#timers.clear();
  }

  /** Due time of the earliest interval with this period, if any. */
  nextIntervalDue(period) {
    let due = Infinity;
    for (const timer of this.#timers.values())
      if (timer.interval && timer.ms === period) due = Math.min(due, timer.at);
    return due === Infinity ? undefined : due;
  }

  /** Run every timer due up to and including `time`, in order. */
  advanceTo(time) {
    for (;;) {
      let next;
      for (const timer of this.#timers.values())
        if (timer.at <= time && (!next || timer.at < next.at)) next = timer;
      if (!next) break;
      this.now = Math.max(this.now, next.at);
      if (next.interval) next.at += next.ms;
      else this.#timers.delete(next.id);
      try {
        next.fn(...next.args);
      } catch (error) {
        if (!this.onError) throw error;
        this.onError(error);
      }
    }
    this.now = Math.max(this.now, time);
  }

  advance(ms) {
    this.advanceTo(this.now + ms);
  }

  #add(fn, ms, args, interval) {
    const id = this.#nextId++;
    const delay = Math.max(interval ? 1 : 0, Number(ms) || 0);
    // Insertion order breaks ties between timers due at the same time.
    this.#timers.set(id, { id, fn, args, interval, ms: delay, at: this.now + delay });
    const handle = {
      id,
      ref: () => handle,
      unref: () => handle,
      hasRef: () => true,
      refresh: () => {
        const timer = this.#timers.get(id);
        if (timer) timer.at = this.now + timer.ms;
        return handle;
      },
      [Symbol.toPrimitive]: () => id,
    };
    return handle;
  }
}

module.exports = { VirtualClock };
