import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import {
  createPostgresIndexerDatabase,
  listUntriggeredDeposits,
} from '../../server/depositAutomationWorkerPostgres';

const migrations = resolve(__dirname, '../../../api/src/db/migrations');
const initialMigration = readFileSync(resolve(migrations, '0000_groovy_typhoid_mary.sql'), 'utf8');
const triggerMigration = readFileSync(resolve(migrations, '0005_strategy_automation_triggers.sql'), 'utf8');
const triggerStoreSource = readFileSync(resolve(__dirname, '../../server/strategyAutomationTriggerStore.ts'), 'utf8');
const core = '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7' as Address;

type Call = { sql: string; params: unknown[] };

function recordingClient(respond: (call: Call) => { rows?: unknown[]; rowCount?: number } = () => ({})) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      const call = { sql: sql.replace(/\s+/g, ' ').trim(), params };
      calls.push(call);
      const result = respond(call);
      return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
    },
  };
  return { calls, client: client as never };
}

describe('deposit worker PostgreSQL schema compatibility', () => {
  it('uses the event_log unique key declared in migration 0000 for deduplication', () => {
    expect(initialMigration).toContain('UNIQUE("chain_id","contract_address","tx_hash","log_index")');
    const { calls, client } = recordingClient();
    return createPostgresIndexerDatabase(client).insertEvent({
      chain_id: 5042n,
      contract_address: core,
      tx_hash: `0x${'A'.repeat(64)}`,
      block_number: 10n,
      block_timestamp: 1n,
      log_index: 2n,
      event_name: 'Deposit',
      decoded_data: { user: core },
    }).then(() => {
      expect(calls[0].sql).toContain('ON CONFLICT (chain_id, contract_address, tx_hash, log_index) DO NOTHING');
      expect(calls[0].params[2]).toBe(`0x${'a'.repeat(64)}`);
    });
  });

  it('persists cursor updates inside the same transaction as the events and rolls back on failure', async () => {
    const { calls, client } = recordingClient((call) => {
      if (call.sql.startsWith('INSERT INTO event_log')) throw new Error('insert failed');
      return {};
    });
    const db = createPostgresIndexerDatabase(client);

    await expect(db.transaction(async (tx) => {
      await tx.insertEvent({
        chain_id: 5042n, contract_address: core, tx_hash: `0x${'a'.repeat(64)}`, block_number: 1n,
        block_timestamp: 1n, log_index: 0n, event_name: 'Deposit', decoded_data: {},
      });
      await tx.updateIndexerState({ chain_id: 5042n, contract_address: core, last_processed_block: 1n, finalized_block: 1n });
    })).rejects.toThrow('insert failed');

    expect(calls.map((call) => call.sql.split(' ')[0])).toEqual(['BEGIN', 'INSERT', 'ROLLBACK']);
  });

  it('updates the existing indexer_state row and only inserts when none exists', async () => {
    const row = { chain_id: 5042n, contract_address: core, last_processed_block: 9n, finalized_block: 9n };
    const existing = recordingClient(() => ({ rowCount: 1 }));
    await createPostgresIndexerDatabase(existing.client).updateIndexerState(row);
    expect(existing.calls.map((call) => call.sql.split(' ')[0])).toEqual(['UPDATE']);

    const first = recordingClient(() => ({ rowCount: 0 }));
    await createPostgresIndexerDatabase(first.client).updateIndexerState(row);
    expect(first.calls.map((call) => call.sql.split(' ')[0])).toEqual(['UPDATE', 'INSERT']);
    expect(first.calls[1].params).toEqual(['5042', core, '9', '9']);
  });

  it('matches trigger rows by chain and lower-cased hash with the statuses the trigger store writes', async () => {
    expect(triggerMigration).toContain('UNIQUE("chain_id","deposit_transaction_hash")');
    for (const status of ['STARTED', 'COMPLETED', 'FAILED']) {
      expect(triggerMigration).toContain(`'${status}'`);
    }
    expect(triggerStoreSource).toContain('deposit_transaction_hash.toLowerCase()'.replace('deposit_transaction_hash', 'depositTransactionHash'));

    const { calls, client } = recordingClient(() => ({
      rows: [{ tx_hash: `0x${'A'.repeat(64)}`, depositor: core, block_number: '12' }],
    }));
    const deposits = await listUntriggeredDeposits(client, 5042, core, 5n);

    expect(calls[0].sql).toContain("e.event_name = 'Deposit'");
    expect(calls[0].sql).toContain('t.deposit_transaction_hash = lower(e.tx_hash)');
    expect(calls[0].sql).toContain('t.chain_id = e.chain_id');
    expect(calls[0].params).toEqual([5042, core, '5']);
    expect(deposits).toEqual([{ transactionHash: `0x${'a'.repeat(64)}`, depositor: core, blockNumber: 12n }]);
  });
});
