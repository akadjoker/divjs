// Minimal binary min-heap, keyed by a numeric `priority` field on each
// pushed item. Array-backed, 0-indexed, standard sift-up/sift-down.
//
// No decrease-key support on purpose: callers that need to "improve" an
// item already in the heap (A*'s classic case - a shorter path to an
// already-queued node) should just push a fresh entry for the new
// priority and let the stale one come out later; the caller is expected
// to detect and skip stale entries on pop (e.g. by comparing against a
// separate best-known-cost map), which is simpler and cheaper than
// maintaining an index map for true decrease-key.
export class MinHeap {
  constructor() {
    this._items = [];
  }

  get size() {
    return this._items.length;
  }

  push(item) {
    const items = this._items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      const tmp = items[parent];
      items[parent] = items[i];
      items[i] = tmp;
      i = parent;
    }
  }

  pop() {
    const items = this._items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < n && items[left].priority < items[smallest].priority) smallest = left;
        if (right < n && items[right].priority < items[smallest].priority) smallest = right;
        if (smallest === i) break;
        const tmp = items[smallest];
        items[smallest] = items[i];
        items[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}
