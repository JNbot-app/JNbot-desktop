/** A thin typed wrapper over Node's EventEmitter. */
import EventEmitter from 'events';

export class TypedEventEmitter<TEvents extends Record<string, any[]>> {
  private emitter = new EventEmitter();

  emit<E extends keyof TEvents & string>(event: E, ...args: TEvents[E]): boolean {
    return this.emitter.emit(event, ...args);
  }

  on<E extends keyof TEvents & string>(event: E, handler: (...args: TEvents[E]) => void): this {
    this.emitter.on(event, handler as any);
    return this;
  }

  once<E extends keyof TEvents & string>(event: E, handler: (...args: TEvents[E]) => void): this {
    this.emitter.once(event, handler as any);
    return this;
  }

  off<E extends keyof TEvents & string>(event: E, handler: (...args: TEvents[E]) => void): this {
    this.emitter.off(event, handler as any);
    return this;
  }

  removeAllListeners<E extends keyof TEvents & string>(event?: E): this {
    this.emitter.removeAllListeners(event);
    return this;
  }
}
