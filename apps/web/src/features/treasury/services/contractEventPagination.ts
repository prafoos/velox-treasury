export const MAX_LOG_QUERY_BLOCK_RANGE = 100_000;
const DEFAULT_LOG_QUERY_BLOCK_RANGE = 10_000;

export type ScheduledOperationEvidence = {
  readonly operationId: string;
  readonly kind: number;
  readonly eta: bigint;
};

export function deduplicateScheduledOperationEvidence(
  evidence: readonly ScheduledOperationEvidence[],
): ScheduledOperationEvidence[] {
  const unique = new Map<string, ScheduledOperationEvidence>();
  for (const operation of evidence) {
    const key = operation.operationId.toLowerCase();
    const existing = unique.get(key);
    if (existing && (existing.kind !== operation.kind || existing.eta !== operation.eta)) {
      throw new Error('Core returned conflicting TimelockScheduled evidence for one operation ID.');
    }
    if (!existing) unique.set(key, operation);
  }
  return [...unique.values()];
}

export function resolveLogQueryChunkSize(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_LOG_QUERY_BLOCK_RANGE;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error('VITE_ARC_MAINNET_LOG_CHUNK_SIZE must be a positive integer no greater than 100000.');
  }

  const chunkSize = Number(value.trim());
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_LOG_QUERY_BLOCK_RANGE) {
    throw new Error('VITE_ARC_MAINNET_LOG_CHUNK_SIZE must be a positive integer no greater than 100000.');
  }
  return chunkSize;
}

export async function readLogsInBlockChunks<T>(
  fromBlock: bigint,
  toBlock: bigint,
  readChunk: (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>,
  chunkSize = DEFAULT_LOG_QUERY_BLOCK_RANGE,
): Promise<T[]> {
  if (fromBlock < 0n || toBlock < 0n || !Number.isSafeInteger(chunkSize)
    || chunkSize < 1 || chunkSize > MAX_LOG_QUERY_BLOCK_RANGE) {
    throw new Error('Invalid block range or log query chunk size.');
  }
  if (fromBlock > toBlock) return [];

  const events: T[] = [];
  const blockRange = BigInt(chunkSize);
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock;) {
    const chunkTo = chunkFrom + blockRange - 1n < toBlock
      ? chunkFrom + blockRange - 1n
      : toBlock;
    events.push(...await readChunk(chunkFrom, chunkTo));
    chunkFrom = chunkTo + 1n;
  }
  return events;
}
