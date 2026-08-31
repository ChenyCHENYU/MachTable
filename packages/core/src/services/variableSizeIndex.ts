/** Fenwick-tree index for incremental variable-size row offsets. */
export class VariableSizeIndex<TKey extends object> {
  private sizes = new Float64Array(0);
  private tree = new Float64Array(1);
  private indexes = new WeakMap<TKey, number>();
  private sizeCounts = new Map<number, number>();
  private minimum = 0;

  reset(keys: readonly TKey[], getSize: (key: TKey, index: number) => number): void {
    this.sizes = new Float64Array(keys.length);
    this.tree = new Float64Array(keys.length + 1);
    this.indexes = new WeakMap();
    this.sizeCounts = new Map();
    this.minimum = 0;
    for (let index = 0; index < keys.length; index++) {
      this.indexes.set(keys[index], index);
      const size = Math.max(1, getSize(keys[index], index));
      this.sizes[index] = size;
      this.changeSizeCount(size, 1);
      this.add(index, size);
    }
  }

  get length(): number { return this.sizes.length; }

  indexOf(key: TKey): number {
    return this.indexes.get(key) ?? -1;
  }

  sizeAt(index: number): number {
    return this.sizes[index] ?? 0;
  }

  update(index: number, size: number): boolean {
    if (index < 0 || index >= this.sizes.length) return false;
    const next = Math.max(1, size);
    const delta = next - this.sizes[index];
    if (Math.abs(delta) < 0.01) return false;
    this.changeSizeCount(this.sizes[index], -1);
    this.sizes[index] = next;
    this.changeSizeCount(next, 1);
    this.add(index, delta);
    return true;
  }

  offsetAt(index: number): number {
    let cursor = Math.max(0, Math.min(Math.trunc(index), this.sizes.length));
    let sum = 0;
    while (cursor > 0) {
      sum += this.tree[cursor];
      cursor -= cursor & -cursor;
    }
    return sum;
  }

  totalSize(): number { return this.offsetAt(this.sizes.length); }

  minimumSize(): number { return this.minimum; }

  findIndex(offset: number): number {
    if (this.sizes.length === 0) return 0;
    const target = Math.max(0, offset);
    let index = 0;
    let accumulated = 0;
    let bit = 1;
    while ((bit << 1) <= this.sizes.length) bit <<= 1;
    while (bit > 0) {
      const next = index + bit;
      if (next <= this.sizes.length && accumulated + this.tree[next] <= target) {
        index = next;
        accumulated += this.tree[next];
      }
      bit >>= 1;
    }
    return Math.min(index, this.sizes.length - 1);
  }

  private add(index: number, delta: number): void {
    for (let cursor = index + 1; cursor < this.tree.length; cursor += cursor & -cursor) {
      this.tree[cursor] += delta;
    }
  }

  private changeSizeCount(size: number, delta: number): void {
    const count = (this.sizeCounts.get(size) ?? 0) + delta;
    if (count <= 0) this.sizeCounts.delete(size);
    else this.sizeCounts.set(size, count);
    if (this.sizeCounts.size === 0) this.minimum = 0;
    else if (delta > 0 && (this.minimum === 0 || size < this.minimum)) this.minimum = size;
    else if (delta < 0 && size === this.minimum && !this.sizeCounts.has(size)) {
      let minimum = Number.POSITIVE_INFINITY;
      for (const candidate of this.sizeCounts.keys()) minimum = Math.min(minimum, candidate);
      this.minimum = Number.isFinite(minimum) ? minimum : 0;
    }
  }
}
