import pg from 'pg';
import type { Hash } from 'viem';

const { Client } = pg;
type PgClient = InstanceType<typeof Client>;
const ARC_MAINNET_CHAIN_ID = 5042;
const STRATEGY_AUTOMATION_LOCK = 'arc-mainnet:velox-steakhouse-surplus-deployment';

export type StrategyAutomationTriggerResult<T> =
  | { readonly status: 'completed'; readonly result: T }
  | { readonly status: 'duplicate'; readonly previousStatus: 'STARTED' | 'COMPLETED' | 'FAILED' }
  | { readonly status: 'busy' };

export interface StrategyAutomationTriggerStore {
  runOnce<T>(depositTransactionHash: Hash, operation: () => Promise<T>): Promise<StrategyAutomationTriggerResult<T>>;
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl?.trim()) {
    throw new Error('POSTGRES_URL is required to serialize automatic strategy deployment.');
  }
  return databaseUrl;
}

async function updateTriggerStatus(
  client: PgClient,
  depositTransactionHash: Hash,
  status: 'COMPLETED' | 'FAILED',
): Promise<void> {
  await client.query(
    `UPDATE strategy_automation_triggers
     SET status = $3, updated_at = now()
     WHERE chain_id = $1 AND deposit_transaction_hash = $2`,
    [ARC_MAINNET_CHAIN_ID, depositTransactionHash.toLowerCase(), status],
  );
}

export const postgresStrategyAutomationTriggerStore: StrategyAutomationTriggerStore = {
  async runOnce<T>(
    depositTransactionHash: Hash,
    operation: () => Promise<T>,
  ): Promise<StrategyAutomationTriggerResult<T>> {
    const client = new Client({ connectionString: requireDatabaseUrl() });
    await client.connect();
    let hasLock = false;
    let triggerClaimed = false;
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [STRATEGY_AUTOMATION_LOCK],
      );
      hasLock = lockResult.rows[0]?.locked === true;
      if (!hasLock) return { status: 'busy' };

      const claimResult = await client.query(
        `INSERT INTO strategy_automation_triggers
           (chain_id, deposit_transaction_hash, status, created_at, updated_at)
         VALUES ($1, $2, 'STARTED', now(), now())
         ON CONFLICT (chain_id, deposit_transaction_hash) DO NOTHING
         RETURNING deposit_transaction_hash`,
        [ARC_MAINNET_CHAIN_ID, depositTransactionHash.toLowerCase()],
      );
      triggerClaimed = claimResult.rowCount === 1;
      if (!triggerClaimed) {
        const existing = await client.query<{ status: string }>(
          `SELECT status FROM strategy_automation_triggers
           WHERE chain_id = $1 AND deposit_transaction_hash = $2`,
          [ARC_MAINNET_CHAIN_ID, depositTransactionHash.toLowerCase()],
        );
        const previous = existing.rows[0]?.status;
        // Unknown or missing state is treated as interrupted so it is never reported as success.
        return {
          status: 'duplicate',
          previousStatus: previous === 'COMPLETED' || previous === 'FAILED' ? previous : 'STARTED',
        };
      }

      try {
        const result = await operation();
        await updateTriggerStatus(client, depositTransactionHash, 'COMPLETED');
        return { status: 'completed', result };
      } catch (error) {
        await updateTriggerStatus(client, depositTransactionHash, 'FAILED');
        throw error;
      }
    } finally {
      try {
        if (hasLock) {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
            STRATEGY_AUTOMATION_LOCK,
          ]);
        }
      } finally {
        await client.end();
      }
    }
  },
};
