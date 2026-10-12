import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hash, type Log } from 'viem';
import {
  runTriggeredStrategySurplusDeployment,
  StrategyAutomationError,
  type StrategyAutomationDependencies,
  type StrategyAutomationSnapshot,
} from '../../api/strategy-automation';
import { APPROVED_ARC_MAINNET_CORE_ADDRESS } from '../../../api/src/config/arc-mainnet.js';
import {
  createArcMainnetIndexer,
  type EventLogRow,
  type IndexerDatabase,
  type IndexerStateRow,
} from '../../../api/src/indexer/index.js';
import {
  createDepositWorkerState,
  runDepositWorkerLoop,
  runDepositWorkerTick,
  DEPOSIT_WORKER_MAX_LOG_RANGE,
  type DepositWorkerDependencies,
} from '../../server/depositAutomationWorker';
import type { StrategyAutomationTriggerStore } from '../../server/strategyAutomationTriggerStore';

const core = APPROVED_ARC_MAINNET_CORE_ADDRESS as Address;
const depositor = '0x0000000000000000000000000000000000000001' as Address;
const executor = '0x0000000000000000000000000000000000000002' as Address;
const strategy = '0x0000000000000000000000000000000000000004' as Address;
const hashA = `0x${'a'.repeat(64)}` as Hash;
const hashB = `0x${'b'.repeat(64)}` as Hash;
const syncHash = `0x${'c'.repeat(64)}` as Hash;
const allocationHash = `0x${'d'.repeat(64)}` as Hash;
const depositEvent = parseAbi([
  'event Deposit(address indexed user, uint256 amount, uint256 userBalance, uint256 totalLiabilities)',
]);

function depositLog(transactionHash: Hash, blockNumber: bigint, logIndex: number): Log {
  return {
    address: core,
    blockNumber,
    transactionHash,
    logIndex,
    topics: encodeEventTopics({ abi: depositEvent, eventName: 'Deposit', args: { user: depositor } }),
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [1_000_000n, 1_000_000n, 1_000_000n],
    ),
  } as unknown as Log;
}

/** In-memory stand-in for event_log, indexer_state and strategy_automation_triggers. */
function createWorld(logs: Log[] = [], head = 100n) {
  const events = new Map<string, EventLogRow>();
  const triggers = new Map<string, 'STARTED' | 'COMPLETED' | 'FAILED'>();
  let state: IndexerStateRow | null = null;
  const world = {
    logs,
    head,
    events,
    triggers,
    get state() { return state; },
    set state(value: IndexerStateRow | null) { state = value; },
  };
  const db: IndexerDatabase = {
    getIndexerState: async () => state,
    transaction: async (fn) => fn(db),
    insertEvent: async (row) => {
      const key = `${row.tx_hash}:${row.log_index}`;
      if (!events.has(key)) events.set(key, row);
    },
    updateIndexerState: async (row) => { state = row; },
  };
  const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
    world.logs.filter((log) => log.blockNumber! >= fromBlock && log.blockNumber! <= toBlock));
  const indexer = createArcMainnetIndexer({
    db,
    client: {
      getBlockNumber: async () => world.head,
      getLogs,
      getBlock: async ({ blockNumber }) => ({ number: blockNumber, timestamp: 1_700_000_000n }),
    },
    config: { coreAddress: core, finality: { mode: 'latest' } },
  });
  const indexRange = vi.fn((from: bigint, to: bigint) => indexer.runRange({ startBlock: from, endBlock: to }));
  return { world, db, getLogs, indexRange };
}

function workerDependencies(
  fixture: ReturnType<typeof createWorld>,
  runAutomation: DepositWorkerDependencies['runAutomation'],
): DepositWorkerDependencies {
  const { world, db, indexRange } = fixture;
  return {
    getHead: async () => world.head,
    getCursor: async () => world.state ? BigInt(String(world.state.last_processed_block)) : null,
    initializeCursor: (block) => db.updateIndexerState({ last_processed_block: block, finalized_block: block }),
    indexRange,
    listUntriggeredDeposits: async (minBlock) => [...world.events.values()]
      .filter((event) => event.event_name === 'Deposit'
        && event.block_number >= minBlock
        && !world.triggers.has(event.tx_hash.toLowerCase()))
      .sort((left, right) => Number(left.block_number - right.block_number))
      .map((event) => ({
        transactionHash: event.tx_hash.toLowerCase() as Hash,
        depositor: event.decoded_data.user as Address,
        blockNumber: event.block_number,
      })),
    runAutomation: vi.fn(runAutomation),
    log: vi.fn(),
  };
}

function memoryTriggerStore(world: ReturnType<typeof createWorld>['world']): StrategyAutomationTriggerStore {
  let busy = false;
  return {
    async runOnce(hash, operation) {
      if (busy) return { status: 'busy' };
      const key = hash.toLowerCase();
      const previous = world.triggers.get(key);
      if (previous) return { status: 'duplicate', previousStatus: previous };
      busy = true;
      world.triggers.set(key, 'STARTED');
      try {
        const result = await operation();
        world.triggers.set(key, 'COMPLETED');
        return { status: 'completed', result };
      } catch (error) {
        world.triggers.set(key, 'FAILED');
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}

function snapshot(overrides: Partial<StrategyAutomationSnapshot> = {}): StrategyAutomationSnapshot {
  return {
    approved: true,
    enabled: true,
    freshnessBlocks: 1_200n,
    principal: 1_000n,
    shares: 900n,
    position: 800n,
    feesAccrued: 2n,
    valuationBlock: 40n,
    valuationSource: strategy,
    valuationStatus: 1,
    totalDeployed: 1_000n,
    liquidUSDC: 5_000n,
    ...overrides,
  };
}

function orchestrationDependencies(
  overrides: Partial<StrategyAutomationDependencies> = {},
  stale = true,
): StrategyAutomationDependencies {
  const before = snapshot(stale ? { valuationBlock: 1n, freshnessBlocks: 2n } : {});
  const fresh = snapshot({ valuationBlock: 50n });
  const allocated = snapshot({
    principal: fresh.principal + 200n,
    shares: fresh.shares + 100n,
    position: fresh.position + 200n,
    valuationBlock: 60n,
    totalDeployed: fresh.totalDeployed + 200n,
    liquidUSDC: fresh.liquidUSDC - 200n,
  });
  let blockCall = 0;
  return {
    coreAddress: core,
    strategyAddress: strategy,
    executorAddress: executor,
    configuredAutomationAddress: executor,
    getChainId: vi.fn(async () => 5042),
    getCoreBytecode: vi.fn(async () => '0x6000' as `0x${string}`),
    getAdapterBytecode: vi.fn(async () => '0x6000' as `0x${string}`),
    verifyDeploymentIdentity: vi.fn(async () => true),
    hasRole: vi.fn(async () => true),
    getBlockNumber: vi.fn(async () => [40n, 40n, 51n][blockCall++] ?? 51n),
    readSnapshot: vi.fn(async (blockNumber) => {
      if (blockNumber === 40n) return before;
      if (blockNumber === 50n || blockNumber === 51n) return fresh;
      if (blockNumber === 60n) return allocated;
      throw new Error('Unexpected test snapshot block.');
    }),
    readAdapterValuation: vi.fn(async () => ({
      shares: fresh.shares,
      currentValue: fresh.position,
      feesAccrued: fresh.feesAccrued,
    })),
    simulate: vi.fn(async () => undefined),
    submit: vi.fn(async (operation) => operation.operation === 'sync-valuation' ? syncHash : allocationHash),
    waitForReceipt: vi.fn(async (hash) => ({
      status: 'success' as const,
      blockNumber: hash === syncHash ? 50n : 60n,
    })),
    verifyDepositTransaction: vi.fn(async () => true),
    getEligibleAllocationAmount: vi.fn(async () => 200n),
    ...overrides,
  };
}

function orchestrate(
  world: ReturnType<typeof createWorld>['world'],
  dependencies: () => StrategyAutomationDependencies,
  store = memoryTriggerStore(world),
) {
  return (hash: Hash, user: Address) => runTriggeredStrategySurplusDeployment(
    hash,
    user,
    () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: dependencies() }),
    store,
  );
}

describe('deposit automation worker', () => {
  it('detects a confirmed Core Deposit through the existing indexer and runs automation once', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const dependencies = workerDependencies(fixture, async () => ({
      status: 'skipped', reason: 'NO_ELIGIBLE_SURPLUS', valuation: null,
    }));

    const result = await runDepositWorkerTick(dependencies);

    expect(result.indexedEvents).toBe(1);
    expect(fixture.world.events.size).toBe(1);
    expect(dependencies.runAutomation).toHaveBeenCalledExactlyOnceWith(hashA, depositor);
    expect(fixture.world.state?.last_processed_block).toBe(110n);
  });

  it('ignores logs that are not Core Deposit events', async () => {
    const other = { ...depositLog(hashA, 105n, 0), address: strategy } as Log;
    const fixture = createWorld([other], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const dependencies = workerDependencies(fixture, async () => { throw new Error('must not run'); });

    await runDepositWorkerTick(dependencies);

    expect(dependencies.runAutomation).not.toHaveBeenCalled();
  });

  it('does not backfill history on first start', async () => {
    const fixture = createWorld([depositLog(hashA, 5n, 0)], 100n);
    const dependencies = workerDependencies(fixture, async () => { throw new Error('must not run'); });

    await runDepositWorkerTick(dependencies);

    expect(fixture.world.state?.last_processed_block).toBe(100n);
    expect(fixture.indexRange).not.toHaveBeenCalled();
    expect(dependencies.runAutomation).not.toHaveBeenCalled();
  });

  it('splits long catch-up ranges to the RPC log limit', async () => {
    const fixture = createWorld([], 100n + DEPOSIT_WORKER_MAX_LOG_RANGE + 10n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const dependencies = workerDependencies(fixture, async () => { throw new Error('must not run'); });

    await runDepositWorkerTick(dependencies);

    expect(fixture.indexRange.mock.calls).toEqual([
      [101n, 100n + DEPOSIT_WORKER_MAX_LOG_RANGE],
      [101n + DEPOSIT_WORKER_MAX_LOG_RANGE, 100n + DEPOSIT_WORKER_MAX_LOG_RANGE + 10n],
    ]);
  });

  it('treats duplicate events and several logs in one transaction as a single trigger', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0), depositLog(hashA, 105n, 1)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const store = memoryTriggerStore(fixture.world);
    const dependencies = workerDependencies(
      fixture,
      orchestrate(fixture.world, () => orchestrationDependencies(), store),
    );

    await runDepositWorkerTick(dependencies);
    await fixture.indexRange(101n, 110n);
    await runDepositWorkerTick(dependencies);

    expect(fixture.world.events.size).toBe(2);
    expect(dependencies.runAutomation).toHaveBeenCalledTimes(1);
    expect(fixture.world.triggers.get(hashA)).toBe('COMPLETED');
  });

  it('resumes from the persisted cursor after a restart without losing the pending deposit', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    let crash = true;
    const run = orchestrate(fixture.world, () => orchestrationDependencies());
    const firstProcess = workerDependencies(fixture, async (hash, user) => {
      if (crash) throw new Error('process interrupted before claim');
      return run(hash, user);
    });

    const first = await runDepositWorkerTick(firstProcess);
    expect(first.halted).toBe(true);
    expect(fixture.world.state?.last_processed_block).toBe(110n);

    crash = false;
    fixture.world.head = 120n;
    fixture.indexRange.mockClear();
    const restarted = await runDepositWorkerTick(workerDependencies(fixture, run), createDepositWorkerState());

    expect(fixture.indexRange).toHaveBeenCalledExactlyOnceWith(111n, 120n);
    expect(restarted.outcomes).toMatchObject([{ transactionHash: hashA, status: 'deployed', amount: 200n }]);
  });

  it('refreshes stale valuation, allocates the eligible amount and verifies post-state', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const deps = orchestrationDependencies();
    const dependencies = workerDependencies(fixture, orchestrate(fixture.world, () => deps));

    const result = await runDepositWorkerTick(dependencies);

    expect(result.outcomes).toMatchObject([{ status: 'deployed', amount: 200n }]);
    expect(vi.mocked(deps.submit).mock.calls.map(([operation]) => operation.operation)).toEqual([
      'sync-valuation',
      'allocate',
    ]);
    expect(deps.readSnapshot).toHaveBeenCalledWith(60n);
    expect(fixture.world.triggers.get(hashA)).toBe('COMPLETED');
  });

  it('does not execute a deposit twice when the frontend trigger and worker race', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const store = memoryTriggerStore(fixture.world);
    const submissions = vi.fn();
    const make = () => orchestrationDependencies({
      submit: vi.fn(async (operation) => {
        submissions(operation.operation);
        return operation.operation === 'sync-valuation' ? syncHash : allocationHash;
      }),
    });
    const run = orchestrate(fixture.world, make, store);

    const [frontend, worker] = await Promise.all([
      run(hashA, depositor),
      runDepositWorkerTick(workerDependencies(fixture, run)),
    ]);

    expect(frontend.status).toBe('deployed');
    // Depending on timing the worker either skips the claimed deposit or never lists it; neither executes it again.
    expect(worker.outcomes.every((outcome) => outcome.status === 'skipped')).toBe(true);
    expect(submissions.mock.calls.map(([operation]) => operation)).toEqual(['sync-valuation', 'allocate']);
  });

  it('skips a deposit the frontend already completed', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    fixture.world.triggers.set(hashA, 'COMPLETED');
    const dependencies = workerDependencies(fixture, async () => { throw new Error('must not run'); });

    await runDepositWorkerTick(dependencies);

    expect(dependencies.runAutomation).not.toHaveBeenCalled();
  });

  it('halts on a transaction failure and never retries the FAILED deposit', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0), depositLog(hashB, 106n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const failing = orchestrationDependencies({
      waitForReceipt: vi.fn(async () => ({ status: 'reverted' as const, blockNumber: 50n })),
    });
    const run = orchestrate(fixture.world, () => failing);
    const dependencies = workerDependencies(fixture, run);

    const first = await runDepositWorkerTick(dependencies);
    const second = await runDepositWorkerTick(dependencies, createDepositWorkerState());

    expect(first.halted).toBe(true);
    expect(first.outcomes).toHaveLength(1);
    expect(fixture.world.triggers.get(hashA)).toBe('FAILED');
    expect(vi.mocked(dependencies.runAutomation).mock.calls.filter(([hash]) => hash === hashA)).toHaveLength(1);
    // The next tick moves on to the next deposit and leaves the FAILED one blocked.
    expect(second.outcomes.map((outcome) => outcome.transactionHash)).toEqual([hashB]);
  });

  it('reports an interrupted prior attempt as blocked instead of retrying', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    fixture.world.triggers.set(hashA, 'STARTED');
    const submit = vi.fn();
    const dependencies = workerDependencies(fixture, async (hash, user) => {
      const store = memoryTriggerStore(fixture.world);
      return orchestrate(fixture.world, () => orchestrationDependencies({ submit }), store)(hash, user);
    });

    const result = await runDepositWorkerTick(dependencies);

    expect(result.outcomes).toEqual([]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('reports a store-level interrupted duplicate as skipped without submitting', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const submit = vi.fn();
    const store: StrategyAutomationTriggerStore = {
      runOnce: async () => ({ status: 'duplicate', previousStatus: 'STARTED' }),
    };
    const dependencies = workerDependencies(
      fixture,
      orchestrate(fixture.world, () => orchestrationDependencies({ submit }), store),
    );

    const result = await runDepositWorkerTick(dependencies);

    expect(result.outcomes).toMatchObject([{ status: 'skipped', reason: 'PREVIOUS_ATTEMPT_INTERRUPTED' }]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('marks stale or invalid deposits rejected and does not resubmit them', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const submit = vi.fn();
    const state = createDepositWorkerState();
    const dependencies = workerDependencies(
      fixture,
      orchestrate(fixture.world, () => orchestrationDependencies({
        submit,
        verifyDepositTransaction: vi.fn(async () => {
          throw new StrategyAutomationError('INVALID_REQUEST', 'Deposit is too old.');
        }),
      })),
    );

    const first = await runDepositWorkerTick(dependencies, state);
    const second = await runDepositWorkerTick(dependencies, state);

    expect(first.outcomes).toMatchObject([{ status: 'rejected' }]);
    expect(second.outcomes).toEqual([]);
    expect(dependencies.runAutomation).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(fixture.world.triggers.size).toBe(0);
  });

  it('records an uncertain readback failure as FAILED and does not repeat the allocation', async () => {
    const fixture = createWorld([depositLog(hashA, 105n, 0)], 110n);
    fixture.world.state = { last_processed_block: 100n, finalized_block: 100n };
    const deps = orchestrationDependencies({
      readSnapshot: vi.fn(async (blockNumber) => {
        if (blockNumber === 60n) throw new Error('RPC unavailable');
        return snapshot({ valuationBlock: 50n });
      }),
    });
    const dependencies = workerDependencies(fixture, orchestrate(fixture.world, () => deps));

    const first = await runDepositWorkerTick(dependencies);
    const second = await runDepositWorkerTick(dependencies, createDepositWorkerState());

    expect(first.halted).toBe(true);
    expect(fixture.world.triggers.get(hashA)).toBe('FAILED');
    expect(second.outcomes).toEqual([]);
    expect(vi.mocked(deps.submit).mock.calls.filter(([operation]) => operation.operation === 'allocate')).toHaveLength(1);
  });
});

describe('deposit automation worker loop', () => {
  it('keeps running after a tick error and stops on abort', async () => {
    const abort = new AbortController();
    const tick = vi.fn(async () => {
      if (tick.mock.calls.length === 1) throw new Error('rpc down');
      if (tick.mock.calls.length === 3) abort.abort();
    });
    const onError = vi.fn();

    await runDepositWorkerLoop({
      intervalMs: 1,
      tick,
      onError,
      signal: abort.signal,
      sleep: async () => undefined,
    });

    expect(tick).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
