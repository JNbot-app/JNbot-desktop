export type Merge = {
  score: number;
  left: number;
  right: number;
  a: number;
  b: number;
};
export default class MergeHeap {
  private values: Merge[] = [];

  private static before(a: Merge, b: Merge): boolean {
    return a.score > b.score || (a.score === b.score && a.left < b.left);
  }

  push(value: Merge): void {
    let i = this.values.length;
    this.values.push(value);
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!MergeHeap.before(value, this.values[parent])) break;
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.values[i] = value;
  }

  pop(): Merge | undefined {
    const result = this.values[0];
    const last = this.values.pop();
    if (last && this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.values.length &&
          MergeHeap.before(this.values[child + 1], this.values[child])
        )
          child += 1;
        if (!MergeHeap.before(this.values[child], last)) break;
        this.values[i] = this.values[child];
        i = child;
      }
      this.values[i] = last;
    }
    return result;
  }
}
