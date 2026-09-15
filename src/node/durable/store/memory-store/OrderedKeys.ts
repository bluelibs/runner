const BLOCK_SIZE = 256;

function lowerBound(values: readonly string[], key: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Blocked sorted index: bounded local shifts instead of shifting 100k rows on writes. */
export class OrderedKeys {
  private readonly blocks: string[][] = [];
  private readonly maxima: string[] = [];

  add(key: string): void {
    let blockIndex = lowerBound(this.maxima, key);
    if (blockIndex === this.blocks.length) {
      if (blockIndex === 0) {
        this.blocks.push([key]);
        this.maxima.push(key);
        return;
      }
      blockIndex--;
    }
    const block = this.blocks[blockIndex];
    const index = lowerBound(block, key);
    if (block[index] === key) return;
    block.splice(index, 0, key);
    if (block.length > BLOCK_SIZE * 2) {
      const right = block.splice(BLOCK_SIZE);
      this.blocks.splice(blockIndex + 1, 0, right);
      this.maxima.splice(blockIndex + 1, 0, right[right.length - 1]);
    }
    this.maxima[blockIndex] = block[block.length - 1];
  }

  delete(key: string): void {
    const blockIndex = lowerBound(this.maxima, key);
    const block = this.blocks[blockIndex];
    if (!block) return;
    const index = lowerBound(block, key);
    if (block[index] !== key) return;
    block.splice(index, 1);
    if (!block.length) {
      this.blocks.splice(blockIndex, 1);
      this.maxima.splice(blockIndex, 1);
    } else {
      this.maxima[blockIndex] = block[block.length - 1];
    }
  }

  page(after: string, limit: number): string[] {
    const result: string[] = [];
    for (
      let blockIndex = lowerBound(this.maxima, after);
      blockIndex < this.blocks.length;
      blockIndex++
    ) {
      const block = this.blocks[blockIndex];
      for (
        let index = lowerBound(block, after);
        index < block.length;
        index++
      ) {
        if (block[index] <= after) continue;
        result.push(block[index]);
        if (result.length === limit) return result;
      }
    }
    return result;
  }
}
