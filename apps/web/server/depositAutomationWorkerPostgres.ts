import pg from 'pg';
import type { Address, Hash } from 'viem';
import type {
  EventLogRow,
  IndexerDatabase,
  IndexerStateRow,
} from '../../api/src/indexer/index.js';
import type { PendingDeposit } from './depositAutomationWorker';

type Queryable = Pick<InstanceType<typeof pg.Client>, 'query'>;

export function createPostgresIndexerDatabase(client: InstanceType<typeof pg.Client>): IndexerDatabase {
  const build = (executor: Queryable, inTransaction: boolean): IndexerDatabase => ({
    async getIndexerState(chainId, contractAddress) {
      const result = await executor.query<{
        chain_id: string;
        contract_address: string;
        last_processed_block: string;
        finalized_block: string;
      }>(
        `SELECT chain_id, contract_address, last_processed_block, finalized_block
         FROM indexer_state
         WHERE chain_id = $1 AND lower(contract_address) = lower($2)
         ORDER BY id DESC LIMIT 1`,
        [chainId, contractAddress],
      );
      return result.rows[0] ?? null;
    },
    async transaction(fn) {
      if (inTransaction) return fn(build(executor, true));
      await client.query('BEGIN');
      try {
        const result = await fn(build(client, true));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
    async insertEvent(entry: EventLogRow) {
      await executor.query(
        `INSERT INTO event_log
           (chain_id, contract_address, tx_hash, block_number, block_timestamp, log_index, event_name, decoded_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (chain_id, contract_address, tx_hash, log_index) DO NOTHING`,
        [
          entry.chain_id.toString(),
          entry.contract_address,
          entry.tx_hash.toLowerCase(),
          entry.block_number.toString(),
          entry.block_timestamp.toString(),
          entry.log_index.toString(),
          entry.event_name,
          JSON.stringify(entry.decoded_data),
        ],
      );
    },
    async updateIndexerState(row: IndexerStateRow) {
      const parameters = [
        String(row.chain_id),
        row.contract_address,
        String(row.last_processed_block),
        String(row.finalized_block),
      ];
      const updated = await executor.query(
        `UPDATE indexer_state
         SET last_processed_block = $3, finalized_block = $4, updated_at = now()
         WHERE chain_id = $1 AND lower(contract_address) = lower($2)`,
        parameters,
      );
      if (updated.rowCount === 0) {
        await executor.query(
          `INSERT INTO indexer_state (chain_id, contract_address, last_processed_block, finalized_block)
           VALUES ($1, $2, $3, $4)`,
          parameters,
        );
      }
    },
  });
  return build(client, false);
}

export async function listUntriggeredDeposits(
  client: Queryable,
  chainId: number,
  coreAddress: Address,
  minBlock: bigint,
): Promise<PendingDeposit[]> {
  const result = await client.query<{ tx_hash: string; depositor: string; block_number: string }>(
    `SELECT e.tx_hash, e.decoded_data->>'user' AS depositor, e.block_number
     FROM event_log e
     WHERE e.chain_id = $1
       AND lower(e.contract_address) = lower($2)
       AND e.event_name = 'Deposit'
       AND e.block_number >= $3
       AND NOT EXISTS (
         SELECT 1 FROM strategy_automation_triggers t
         WHERE t.chain_id = e.chain_id AND t.deposit_transaction_hash = lower(e.tx_hash)
       )
     ORDER BY e.block_number, e.log_index`,
    [chainId, coreAddress, minBlock.toString()],
  );
  return result.rows.map((row) => ({
    transactionHash: row.tx_hash.toLowerCase() as Hash,
    depositor: row.depositor as Address,
    blockNumber: BigInt(row.block_number),
  }));
}
