/**
 * Creates array with fixed size and pushes items to it until it's full, then it will start overwriting the oldest items
 */
class CircularBuffer<T> {
  private buffer: T[];
  private readIndex: number = 0;
  private writeIndex: number = 0;
  private isFull: boolean = false; 

  constructor(private maxSize: number) {
    this.buffer = new Array(maxSize);
  }

  private itemCount: number = 0;

  static fromArray<U>(arr: U[], maxSize: number): CircularBuffer<U> {
    const buffer = new CircularBuffer<U>(maxSize);
    buffer.pushAll(arr);
    return buffer;
  }

  push(item: T) {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.maxSize;
    if (this.isFull) {
      this.readIndex = (this.readIndex + 1) % this.maxSize;
    }
    this.itemCount = Math.min(this.itemCount + 1, this.maxSize);
    this.isFull = this.itemCount === this.maxSize;
  }

  pushAll(items: T[]) {
    for (const item of items) this.push(item);
  }

  get size () {
    return this.itemCount;
  }

  get(count: number): T[] {
    count = Math.min(count, this.itemCount);
    const result: T[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.buffer[(this.readIndex + i) % this.maxSize]);
    }
    return result;
  }


  toArray(): T[] {
    return [...this];
  }


  clear() {
    this.buffer = new Array(this.maxSize);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.itemCount = 0;
    this.isFull = false;
  }

  [Symbol.toStringTag] = "[LogBuffer<"+this.size+">]";

  *[Symbol.iterator]() {
    const readStop = this.isFull ? this.maxSize : this.writeIndex;
    for (let i = this.readIndex; i < readStop; i++) {
      yield this.buffer[i];
    }
    if (this.isFull) {
      for (let i = 0; i < this.readIndex; i++) {
        yield this.buffer[i];
      }
    }
  }


  map<U>(callback: (item: T, i:number) => U): U[] {
    const result: U[] = [];
    for (let i = 0; i < this.itemCount; i++) {
      const index = (this.readIndex + i) % this.maxSize;
      const item = this.buffer[index];
      result.push(callback(item, i));
    }
    return result;
  }

  filter(callback: (item: T, i?: number) => boolean): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.itemCount; i++) {
      const index = (this.readIndex + i) % this.maxSize;
      const item = this.buffer[index];
      if (callback(item, i)) {
        result.push(item);
      }
    }
    return result;
  }
}

export default CircularBuffer;
