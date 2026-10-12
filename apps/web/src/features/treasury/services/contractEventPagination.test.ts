import { describe, expect, it, vi } from 'vitest';

import {
  deduplicateScheduledOperationEvidence,
  MAX_LOG_QUERY_BLOCK_RANGE,
  readLogsInBlockChunks,
  resolveLogQueryChunkSize,
} from './contractEventPagination';

describe('readLogsInBlockChunks', () => {
  it('reads a history shorter than one chunk in one bounded request', async () => {
    const readChunk = vi.fn(async (fromBlock: bigint, toBlock: bigint) => [{ fromBlock, toBlock }]);

    await expect(readLogsInBlockChunks(10n, 19n, readChunk, 100)).resolves.toEqual([
      { fromBlock: 10n, toBlock: 19n },
    ]);
    expect(readChunk).toHaveBeenCalledExactlyOnceWith(10n, 19n);
  });

  it('reads multiple contiguous chunks without gaps or overlaps', async () => {
    const readChunk = vi.fn(async (fromBlock: bigint, toBlock: bigint) => {
      const blocks: bigint[] = [];
      for (let block = fromBlock; block <= toBlock; block += 1n) blocks.push(block);
      return blocks;
    });

    const blocks = await readLogsInBlockChunks(0n, 10n, readChunk, 4);

    expect(readChunk.mock.calls).toEqual([
      [0n, 3n],
      [4n, 7n],
      [8n, 10n],
    ]);
    expect(blocks).toEqual(Array.from({ length: 11 }, (_, index) => BigInt(index)));
    expect(new Set(blocks).size).toBe(blocks.length);
  });

  it('uses inclusive chunk widths no larger than the provider maximum', async () => {
    const readChunk = vi.fn(async (fromBlock: bigint, toBlock: bigint) => [{ fromBlock, toBlock }]);

    await readLogsInBlockChunks(5n, 5n + BigInt(MAX_LOG_QUERY_BLOCK_RANGE) * 2n, readChunk, MAX_LOG_QUERY_BLOCK_RANGE);

    expect(readChunk).toHaveBeenCalledTimes(3);
    for (const [fromBlock, toBlock] of readChunk.mock.calls) {
      expect(toBlock - fromBlock + 1n).toBeLessThanOrEqual(BigInt(MAX_LOG_QUERY_BLOCK_RANGE));
    }
    expect(readChunk.mock.calls).toEqual([
      [5n, 100_004n],
      [100_005n, 200_004n],
      [200_005n, 200_005n],
    ]);
  });

  it('keeps the 100000-block inclusive limit at boundaries, transitions, partial tails, and single blocks', async () => {
    const cases = [
      {
        fromBlock: 100_000n,
        toBlock: 200_000n,
        expected: [[100_000n, 199_999n], [200_000n, 200_000n]],
      },
      {
        fromBlock: 0n,
        toBlock: 200_000n,
        expected: [[0n, 99_999n], [100_000n, 199_999n], [200_000n, 200_000n]],
      },
      {
        fromBlock: 12_345n,
        toBlock: 250_000n,
        expected: [[12_345n, 112_344n], [112_345n, 212_344n], [212_345n, 250_000n]],
      },
      {
        fromBlock: 100_000n,
        toBlock: 100_000n,
        expected: [[100_000n, 100_000n]],
      },
    ];

    for (const { fromBlock, toBlock, expected } of cases) {
      const readChunk = vi.fn(async (chunkFrom: bigint, chunkTo: bigint) => [{ fromBlock: chunkFrom, toBlock: chunkTo }]);

      await readLogsInBlockChunks(fromBlock, toBlock, readChunk, MAX_LOG_QUERY_BLOCK_RANGE);

      expect(readChunk.mock.calls).toEqual(expected);
      for (const [chunkFrom, chunkTo] of readChunk.mock.calls) {
        expect(chunkTo - chunkFrom + 1n).toBeLessThanOrEqual(BigInt(MAX_LOG_QUERY_BLOCK_RANGE));
      }
    }
  });

  it('uses a smaller default chunk size for Arc Mainnet RPC requests', async () => {
    const readChunk = vi.fn(async (fromBlock: bigint, toBlock: bigint) => [{ fromBlock, toBlock }]);

    await readLogsInBlockChunks(0n, 10_000n, readChunk);

    expect(resolveLogQueryChunkSize(undefined)).toBe(10_000);
    expect(readChunk.mock.calls).toEqual([[0n, 9_999n], [10_000n, 10_000n]]);
  });

  it('propagates a failed chunk instead of returning partial or empty history', async () => {
    const readChunk = vi.fn(async (fromBlock: bigint, toBlock: bigint) => {
      if (fromBlock === 4n) throw new Error('provider rejected historical range');
      return [{ fromBlock, toBlock }];
    });

    await expect(readLogsInBlockChunks(0n, 8n, readChunk, 4))
      .rejects.toThrow('provider rejected historical range');
    expect(readChunk).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an empty event history from an empty block range', async () => {
    const readChunk = vi.fn(async () => []);

    await expect(readLogsInBlockChunks(0n, 8n, readChunk, 4)).resolves.toEqual([]);
    expect(readChunk).toHaveBeenCalledTimes(3);

    readChunk.mockClear();
    await expect(readLogsInBlockChunks(4n, 3n, readChunk, 4)).resolves.toEqual([]);
    expect(readChunk).not.toHaveBeenCalled();
  });

  it('deduplicates repeated operation evidence at chunk boundaries and rejects conflicts', () => {
    const operation = { operationId: `0x${'12'.repeat(32)}`, kind: 4, eta: 123n };

    expect(deduplicateScheduledOperationEvidence([operation, operation])).toEqual([operation]);
    expect(() => deduplicateScheduledOperationEvidence([
      operation,
      { ...operation, eta: 124n },
    ])).toThrow('conflicting TimelockScheduled evidence');
  });

  it('rejects invalid or over-limit configured chunk sizes', () => {
    expect(resolveLogQueryChunkSize(undefined)).toBe(10_000);
    expect(resolveLogQueryChunkSize('25000')).toBe(25_000);
    expect(() => resolveLogQueryChunkSize('0')).toThrow('no greater than 100000');
    expect(() => resolveLogQueryChunkSize('100001')).toThrow('no greater than 100000');
    expect(() => resolveLogQueryChunkSize('1.5')).toThrow('no greater than 100000');
  });
});
