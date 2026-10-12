import type { Address, Hash } from 'viem';
import type { AutomaticStrategyDeploymentResult } from '../api/strategy-automation';

// Mirrors DEPOSIT_TRIGGER_MAX_AGE_BLOCKS in api/strategy-automation.ts; the orchestration enforces it authoritatively.
export const DEPOSIT_WORKER_MAX_AGE_BLOCKS = 2_400n;
// Arc RPC eth_getLogs is limited to 5,000 blocks per request.
export const DEPOSIT_WORKER_MAX_LOG_RANGE = 5_000n;
const MAX_RANGES_PER_TICK = 20;

export interface PendingDeposit {
  readonly transactionHash: Hash;
  readonly depositor: Address;
  readonly blockNumber: bigint;
}

export interface DepositWorkerDependencies {
  getHead(): Promise<bigint>;
  /** Persisted indexer cursor (last processed block), or null when the indexer has never run. */
  getCursor(): Promise<bigint | null>;
  initializeCursor(block: bigint): Promise<void>;
  /** Reuses ArcMainnetIndexer.runRange, which persists events and the cursor atomically. */
  indexRange(fromBlock: bigint, toBlock: bigint): Promise<{ processed: number }>;
  /** Indexed Core Deposit events at or after minBlock that have no strategy_automation_triggers row. */
  listUntriggeredDeposits(minBlock: bigint): Promise<readonly PendingDeposit[]>;
  /** The existing orchestration (runTriggeredStrategySurplusDeployment); owns verification, claim and execution. */
  runAutomation(transactionHash: Hash, depositor: Address): Promise<AutomaticStrategyDeploymentResult>;
  log(message: string): void;
}

export type DepositWorkerOutcome =
  | { readonly transactionHash: Hash; readonly status: 'deployed'; readonly amount: bigint }
  | { readonly transactionHash: Hash; readonly status: 'skipped'; readonly reason: string }
  | { readonly transactionHash: Hash; readonly status: 'rejected'; readonly message: string }
  | { readonly transactionHash: Hash; readonly status: 'failed'; readonly message: string };

export interface DepositWorkerTickResult {
  readonly head: bigint;
  readonly indexedEvents: number;
  readonly outcomes: readonly DepositWorkerOutcome[];
  readonly halted: boolean;
}

export interface DepositWorkerState {
  /** Deposits the orchestration rejected as invalid/stale; not re-submitted while they stay in the age window. */
  readonly rejected: Set<string>;
}

export function createDepositWorkerState(): DepositWorkerState {
  return { rejected: new Set() };
}

function errorKind(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'kind' in error
    ? String((error as { kind: unknown }).kind)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown automation error.';
}

export async function runDepositWorkerTick(
  dependencies: DepositWorkerDependencies,
  state: DepositWorkerState = createDepositWorkerState(),
): Promise<DepositWorkerTickResult> {
  const head = await dependencies.getHead();
  const persistedCursor = await dependencies.getCursor();
  let cursor: bigint;
  if (persistedCursor === null) {
    // Never backfill history on first start; only deposits after this point are in scope.
    await dependencies.initializeCursor(head);
    dependencies.log(`Initialized deposit indexer cursor at block ${head}.`);
    cursor = head;
  } else {
    cursor = persistedCursor;
  }

  let indexedEvents = 0;
  for (let range = 0; range < MAX_RANGES_PER_TICK && cursor < head; range += 1) {
    const fromBlock: bigint = cursor + 1n;
    const rangeEnd: bigint = fromBlock + DEPOSIT_WORKER_MAX_LOG_RANGE - 1n;
    const toBlock: bigint = rangeEnd < head ? rangeEnd : head;
    const { processed } = await dependencies.indexRange(fromBlock, toBlock);
    indexedEvents += processed;
    cursor = toBlock;
  }

  // Pending work is derived from the database, not from this tick's range, so a crash between the
  // cursor commit and automation cannot lose a deposit.
  const minBlock = head > DEPOSIT_WORKER_MAX_AGE_BLOCKS ? head - DEPOSIT_WORKER_MAX_AGE_BLOCKS : 0n;
  const pending = await dependencies.listUntriggeredDeposits(minBlock);
  const seen = new Set<string>();
  const outcomes: DepositWorkerOutcome[] = [];
  let halted = false;

  for (const deposit of pending) {
    const key = deposit.transactionHash.toLowerCase();
    // One trigger exists per transaction, so several Deposit logs in one transaction are one unit of work.
    if (seen.has(key) || state.rejected.has(key)) continue;
    seen.add(key);

    try {
      const result = await dependencies.runAutomation(deposit.transactionHash, deposit.depositor);
      if (result.status === 'deployed') {
        outcomes.push({ transactionHash: deposit.transactionHash, status: 'deployed', amount: result.amount });
      } else {
        outcomes.push({ transactionHash: deposit.transactionHash, status: 'skipped', reason: result.reason });
      }
    } catch (error) {
      const message = errorMessage(error);
      if (errorKind(error) === 'INVALID_REQUEST') {
        state.rejected.add(key);
        outcomes.push({ transactionHash: deposit.transactionHash, status: 'rejected', message });
        continue;
      }
      // Any other error may follow a submitted transaction. Stop the tick; the trigger store keeps a
      // FAILED/STARTED deposit blocked, so it is never blindly retried.
      outcomes.push({ transactionHash: deposit.transactionHash, status: 'failed', message });
      halted = true;
      break;
    }
  }

  for (const outcome of outcomes) {
    dependencies.log(`Deposit ${outcome.transactionHash}: ${outcome.status}${
      'reason' in outcome ? ` (${outcome.reason})` : 'message' in outcome ? ` (${outcome.message})` : ''
    }`);
  }
  return { head, indexedEvents, outcomes, halted };
}

export async function runDepositWorkerLoop(options: {
  readonly intervalMs: number;
  readonly tick: () => Promise<unknown>;
  readonly onError: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const sleep = options.sleep ?? ((ms, signal) => new Promise<void>((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolveSleep();
    }, { once: true });
  }));
  while (!options.signal.aborted) {
    try {
      await options.tick();
    } catch (error) {
      options.onError(error);
    }
    if (options.signal.aborted) break;
    await sleep(options.intervalMs, options.signal);
  }
}
