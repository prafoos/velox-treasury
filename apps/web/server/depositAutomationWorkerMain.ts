import pg from 'pg';
import { createPublicClient, defineChain, http, type Address } from 'viem';
import { createArcMainnetExecutionConfig } from '../../api/src/config/arc-mainnet.js';
import { createArcMainnetIndexer } from '../../api/src/indexer/index.js';
import {
  createProductionDependencies,
  runTriggeredStrategySurplusDeployment,
} from '../api/strategy-automation';
import {
  createDepositWorkerState,
  runDepositWorkerLoop,
  runDepositWorkerTick,
} from './depositAutomationWorker';
import {
  createPostgresIndexerDatabase,
  listUntriggeredDeposits,
} from './depositAutomationWorkerPostgres';
import {
  DepositWorkerStatusTracker,
  evaluateWorkerHealth,
  isWorkerHung,
  readStatusFile,
  sanitizeErrorMessage,
  statusFilePath,
  writeStatusFile,
} from './depositAutomationWorkerStatus';

const DEFAULT_INTERVAL_MS = 15_000;
const MAX_CONSECUTIVE_TICK_FAILURES = 10;
const HEARTBEAT_EVERY_TICKS = 20;
const WATCHDOG_INTERVAL_MS = 30_000;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the deposit automation worker.`);
  return value;
}

function readIntervalMs(): number {
  const intervalMs = Number(process.env.DEPOSIT_AUTOMATION_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
    throw new Error('DEPOSIT_AUTOMATION_WORKER_INTERVAL_MS must be a number of at least 1000.');
  }
  return intervalMs;
}

/** Local status check (no network port): `node worker.mjs --health` exits 0 when healthy, 1 otherwise. */
function runHealthCheck(): void {
  const health = evaluateWorkerHealth(readStatusFile(statusFilePath()), readIntervalMs());
  console.log(JSON.stringify(health));
  process.exitCode = health.healthy ? 0 : 1;
}

async function main(): Promise<void> {
  if (process.argv.includes('--health')) {
    runHealthCheck();
    return;
  }
  // The worker can submit real Arc Mainnet transactions and writes to the configured database,
  // so it never starts implicitly.
  if (process.env.DEPOSIT_AUTOMATION_WORKER_ENABLED !== 'true') {
    console.error('Deposit automation worker is disabled. Set DEPOSIT_AUTOMATION_WORKER_ENABLED=true to run it.');
    process.exitCode = 1;
    return;
  }

  const config = createArcMainnetExecutionConfig();
  const rpcUrl = requireEnv('ARC_MAINNET_RPC_URL');
  requireEnv('POSTGRES_URL');
  // Validates the signer key, executor address and deployment config (no network call, no transaction),
  // so a misconfigured service fails at startup instead of on the first deposit.
  createProductionDependencies();
  const intervalMs = readIntervalMs();
  const chain = defineChain({
    id: config.chainId,
    name: 'Arc Mainnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const coreAddress: Address = config.coreAddress;
  const state = createDepositWorkerState();
  const log = (message: string) => console.log(`[deposit-worker] ${message}`);

  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  process.once('SIGTERM', () => abort.abort());

  const statusPath = statusFilePath();
  const tracker = new DepositWorkerStatusTracker((status) => writeStatusFile(statusPath, status));
  // A stalled RPC/database call would otherwise block the loop silently. Exiting lets the platform restart
  // the process from the persisted cursor; an interrupted automation stays STARTED and is never auto-retried.
  const watchdog = setInterval(() => {
    if (isWorkerHung(tracker.snapshot, intervalMs)) {
      log('Watchdog: no tick has completed within the allowed time; exiting for a supervised restart.');
      process.exit(1);
    }
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref();

  let tickCount = 0;
  const tick = async () => {
    tickCount += 1;
    tracker.tickStarted();
    const client = new pg.Client({ connectionString: requireEnv('POSTGRES_URL') });
    await client.connect();
    try {
      const db = createPostgresIndexerDatabase(client);
      // Arc finalizes deterministically, so the latest block is used rather than the unsupported 'safe' tag.
      const indexer = createArcMainnetIndexer({
        db,
        client: {
          getBlockNumber: () => publicClient.getBlockNumber(),
          getLogs: ({ address, fromBlock, toBlock }) =>
            publicClient.getLogs({ address, fromBlock, toBlock }) as never,
          getBlock: ({ blockNumber }) => publicClient.getBlock({ blockNumber }),
        },
        config: { chainId: config.chainId, coreAddress, finality: { mode: 'latest', offset: 0n } },
      });
      const result = await runDepositWorkerTick({
        getHead: () => publicClient.getBlockNumber(),
        getCursor: async () => {
          const row = await db.getIndexerState(config.chainId, coreAddress);
          return row ? BigInt(String(row.last_processed_block)) : null;
        },
        initializeCursor: (block) => db.updateIndexerState({
          chain_id: BigInt(config.chainId),
          contract_address: coreAddress,
          last_processed_block: block,
          finalized_block: block,
        }),
        indexRange: (startBlock, endBlock) => indexer.runRange({ startBlock, endBlock }),
        listUntriggeredDeposits: (minBlock) =>
          listUntriggeredDeposits(client, config.chainId, coreAddress, minBlock),
        runAutomation: (hash, depositor) => runTriggeredStrategySurplusDeployment(hash, depositor),
        log,
      }, state);
      tracker.tickSucceeded(result.head);
      if (result.indexedEvents > 0 || result.outcomes.length > 0 || tickCount % HEARTBEAT_EVERY_TICKS === 1) {
        log(`Tick ok: head=${result.head} indexedEvents=${result.indexedEvents} outcomes=${result.outcomes.length} halted=${result.halted}`);
      }
    } finally {
      await client.end();
    }
  };

  log(`Starting; polling every ${intervalMs}ms.`);
  await runDepositWorkerLoop({
    intervalMs,
    tick,
    onError: (error) => {
      const consecutiveFailures = tracker.tickFailed(error);
      log(`Tick failed (${consecutiveFailures}/${MAX_CONSECUTIVE_TICK_FAILURES}): ${sanitizeErrorMessage(error)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_TICK_FAILURES) {
        // Exit non-zero so the platform restart policy restarts the process from the persisted cursor.
        log('Too many consecutive failures; exiting for a supervised restart.');
        process.exitCode = 1;
        abort.abort();
      }
    },
    signal: abort.signal,
  });
  log('Stopped.');
}

main().catch((error: unknown) => {
  console.error(`[deposit-worker] Startup failed: ${sanitizeErrorMessage(error)}`);
  process.exitCode = 1;
});
