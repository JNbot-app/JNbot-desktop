class Queue<T> {
  head: number
  tail: number
  elements: { [num: number]: T | null }

  constructor() {
    this.elements = {};
    this.head = 0;
    this.tail = 0;
  }
  enqueue(element: T) {
    this.elements[this.tail] = element;
    this.tail++;
  }
  dequeue(): T {
    const item = this.elements[this.head];
    this.elements[this.head] = null
    delete this.elements[this.head];
    this.head++;
    return item as T;
  }

  peek(): T {
    return this.elements[this.head] as T;
  }
  get length() {
    return this.tail - this.head;
  }
  get isEmpty() {
    return this.length === 0;
  }

  clear() {
    this.head = 0;
    this.tail = 0;
    for (let i in this.elements) {
      this.elements[i] = null
    }
    this.elements = {};
  }

  toList(): T[] {
    const list: T[] = [];
    for (let i = this.head; i < this.tail; i++) {
      list.push(this.elements[i] as T);
    }
    return list;
  }
}

export default Queue;