import EventEmitter from "node:events";



class TypedEventEmitter<T extends Record<string, (...args: any) => any>> extends EventEmitter {
  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): boolean;
  emit(event: string | symbol, ...args: any[]): boolean;
  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof T>(event: K, listener: T[K]): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  once<K extends keyof T>(event: K, listener: T[K]): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }
}


export { TypedEventEmitter };