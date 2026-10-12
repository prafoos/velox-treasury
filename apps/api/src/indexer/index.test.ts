import { encodeAbiParameters, getEventSelector, parseAbiItem } from 'viem';
import { describe, expect, it } from 'vitest';
import { ARC_MAINNET_RETIRED_ADDRESSES } from '@velox/domain';

import { ARC_MAINNET_CHAIN_ID, ARC_MAINNET_CORE_ADDRESS, ArcMainnetIndexer, type EventLogRow, type IndexerDatabase, type IndexerStateRow } from './index.js';

const depositEvent = parseAbiItem('event Deposit(address indexed user, uint256 amount, uint256 userBalance, uint256 totalLiabilities)');
const userFinancialEvent = parseAbiItem('event UserFinancialStateChanged(address indexed user, uint256 principal, uint256 currentValue, int256 unrealizedPnl, int256 realizedPnl, int256 totalPnl, uint256 immediatelyWithdrawableValue)');
const strategyAccountingEvent = parseAbiItem('event StrategyAccountingUpdated(address indexed strategy, uint256 principal, uint256 shares, uint256 currentValue, uint256 realizedYield, uint256 realizedLoss, uint256 withdrawalShortfall, uint256 totalDeployed, uint256 valuationBlock, uint8 status)');
const protocolExposureEvent = parseAbiItem('event ProtocolExposureChanged(bytes32 indexed protocol, uint256 exposure, uint256 absoluteCap, uint16 relativeCapBps)');
const protocolApprovalEvent = parseAbiItem('event ProtocolApprovalChanged(bytes32 indexed protocol, bool approved, bool enabled)');
const strategyApprovalEvent = parseAbiItem('event StrategyApprovalChanged(address indexed strategy, bytes32 indexed protocol, address indexed asset, bool approved, bool enabled)');
const unknownEvent = parseAbiItem('event Unknown(uint256 value)');
const CURRENT_PROTOCOL_ID = '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450' as const;

function makeDepositLog(overrides: Partial<Record<string, unknown>> = {}) {
  const address = ((overrides.address as string | undefined) ?? ARC_MAINNET_CORE_ADDRESS) as `0x${string}`;
  const user = ((overrides.user as string | undefined) ?? '0x1111111111111111111111111111111111111111') as `0x${string}`;
  const amount = BigInt((overrides.amount as number | bigint | undefined) ?? 1_000_000n);
  const userBalance = BigInt((overrides.userBalance as number | bigint | undefined) ?? 1_000_000n);
  const totalLiabilities = BigInt((overrides.totalLiabilities as number | bigint | undefined) ?? 2_000_000n);

  const topics = [getEventSelector(depositEvent), encodeAbiParameters([{ type: 'address' }], [user])] as const;
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [amount, userBalance, totalLiabilities],
  );

  return {
    address,
    topics: [...topics] as unknown as [string, ...string[]],
    data,
    blockNumber: BigInt((overrides.blockNumber as number | bigint | undefined) ?? 100n),
    blockHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    transactionHash: (overrides.transactionHash as string | undefined) ?? '0x2222222222222222222222222222222222222222222222222222222222222222',
    logIndex: Number((overrides.logIndex as number | bigint | undefined) ?? 0n),
    transactionIndex: 0,
    removed: false,
  };
}

function makeUnknownLog(overrides: Partial<Record<string, unknown>> = {}) {
  const address = (overrides.address as string | undefined) ?? ARC_MAINNET_CORE_ADDRESS;
  const value = BigInt((overrides.value as number | bigint | undefined) ?? 42n);
  const topics = [getEventSelector(unknownEvent)] as const;
  const data = encodeAbiParameters([{ type: 'uint256' }], [value]);

  return {
    address,
    topics: [...topics] as unknown as [string, ...string[]],
    data,
    blockNumber: BigInt((overrides.blockNumber as number | bigint | undefined) ?? 101n),
    blockHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
    transactionHash: (overrides.transactionHash as string | undefined) ?? '0x4444444444444444444444444444444444444444444444444444444444444444',
    logIndex: Number((overrides.logIndex as number | bigint | undefined) ?? 1n),
    transactionIndex: 1,
    removed: false,
  };
}

class MockDatabase implements IndexerDatabase {
  public events: Array<Record<string, unknown>> = [];
  public state: Array<Record<string, unknown>> = [{
    chain_id: BigInt(ARC_MAINNET_CHAIN_ID),
    contract_address: ARC_MAINNET_CORE_ADDRESS,
    last_processed_block: 99n,
    finalized_block: 99n,
    updated_at: new Date().toISOString(),
  }];

  public failOnInsert = false;
  public failOnCheckpoint = false;

  async getIndexerState() {
    return this.state[0] ?? null;
  }

  async transaction<T>(callback: (db: IndexerDatabase) => Promise<T>): Promise<T> {
    return callback(this as unknown as IndexerDatabase);
  }

  async insertEvent(entry: EventLogRow) {
    if (this.failOnInsert) {
      throw new Error('db insert failed');
    }
    const exists = this.events.some((event) => event.chain_id === entry.chain_id && event.contract_address === entry.contract_address && event.tx_hash === entry.tx_hash && event.log_index === entry.log_index);
    if (!exists) {
      this.events.push(entry as unknown as Record<string, unknown>);
    }
  }

  async updateIndexerState(row: IndexerStateRow) {
    if (this.failOnCheckpoint) {
      throw new Error('checkpoint update failed');
    }
    this.state = [row as unknown as Record<string, unknown>];
  }
}

function makeClient(logs: Array<Record<string, unknown>>) {
  return {
    async getBlockNumber() {
      return 110n;
    },
    async getLogs() {
      return logs;
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return { number: blockNumber, timestamp: 1700000000n + blockNumber };
    },
  } as any;
}

describe('ArcMainnetIndexer', () => {
  it('uses the verified Core address and Arc Mainnet chain id', async () => {
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    expect(indexer.chainId).toBe(ARC_MAINNET_CHAIN_ID);
    expect(indexer.coreAddress).toBe(ARC_MAINNET_CORE_ADDRESS);
    expect(indexer.getSupportedEventNames()).toContain('Deposit');
  });

  it('rejects retired Core addresses as indexer targets', () => {
    const db = new MockDatabase();
    expect(() => new ArcMainnetIndexer({
      db: db as any,
      client: makeClient([]),
      config: {
        chainId: ARC_MAINNET_CHAIN_ID,
        coreAddress: ARC_MAINNET_RETIRED_ADDRESSES.core as `0x${string}`,
      },
    })).toThrow('Retired Core address');
  });

  it('decodes supported events and persists them to event_log', async () => {
    const log = makeDepositLog({ blockNumber: 100n, logIndex: 0n, transactionHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([log]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    await indexer.runRange({ startBlock: 100n, endBlock: 105n });

    expect(db.events).toHaveLength(1);
    expect(db.events[0].event_name).toBe('Deposit');
    expect((db.events[0] as Record<string, unknown>).decoded_data).toMatchObject({
      user: '0x1111111111111111111111111111111111111111',
      amount: '1000000',
    });
    expect(db.state[0].last_processed_block).toBe(105n);
  });

  it('decodes authoritative strategy accounting snapshots', () => {
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });
    const strategy = '0x7777777777777777777777777777777777777777' as `0x${string}`;
    const topics = [getEventSelector(strategyAccountingEvent), encodeAbiParameters([{ type: 'address' }], [strategy])] as const;
    const data = encodeAbiParameters(
      [
        { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' },
        { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint8' },
      ],
      [1_000n, 900n, 1_200n, 250n, 50n, 10n, 1_200n, 300n, 1],
    );

    const decoded = indexer.decodeSupportedLog({
      address: ARC_MAINNET_CORE_ADDRESS,
      topics: [...topics] as unknown as [string, ...string[]],
      data,
    } as any);

    expect(decoded?.eventName).toBe('StrategyAccountingUpdated');
    expect(decoded?.decodedData).toMatchObject({ strategy, principal: '1000', shares: '900', currentValue: '1200', realizedYield: '250', realizedLoss: '50', status: 1 });
  });

  it('decodes authoritative user financial snapshots', () => {
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });
    const user = '0x1111111111111111111111111111111111111111' as `0x${string}`;
    const topics = [getEventSelector(userFinancialEvent), encodeAbiParameters([{ type: 'address' }], [user])] as const;
    const data = encodeAbiParameters(
      [
        { type: 'uint256' }, { type: 'uint256' }, { type: 'int256' },
        { type: 'int256' }, { type: 'int256' }, { type: 'uint256' },
      ],
      [1_000n, 1_200n, 200n, -50n, 150n, 1_200n],
    );

    const decoded = indexer.decodeSupportedLog({
      address: ARC_MAINNET_CORE_ADDRESS,
      topics: [...topics] as unknown as [string, ...string[]],
      data,
    } as any);

    expect(decoded?.eventName).toBe('UserFinancialStateChanged');
    expect(decoded?.decodedData).toMatchObject({ user, principal: '1000', currentValue: '1200', unrealizedPnl: '200', realizedPnl: '-50', totalPnl: '150', immediatelyWithdrawableValue: '1200' });
  });

  it('preserves bytes32 protocol IDs across current approval and exposure events', () => {
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });
    const strategy = '0x7777777777777777777777777777777777777777' as `0x${string}`;
    const asset = '0x3600000000000000000000000000000000000000' as `0x${string}`;
    const protocolTopics = (event: typeof protocolExposureEvent | typeof protocolApprovalEvent) => [
      getEventSelector(event),
      encodeAbiParameters([{ type: 'bytes32' }], [CURRENT_PROTOCOL_ID]),
    ] as const;

    const exposure = indexer.decodeSupportedLog({
      address: ARC_MAINNET_CORE_ADDRESS,
      topics: [...protocolTopics(protocolExposureEvent)] as unknown as [string, ...string[]],
      data: encodeAbiParameters([
        { type: 'uint256' }, { type: 'uint256' }, { type: 'uint16' },
      ], [600n, 1_000n, 5_000]),
    } as any);
    expect(exposure?.decodedData.protocol).toBe(CURRENT_PROTOCOL_ID);

    const approval = indexer.decodeSupportedLog({
      address: ARC_MAINNET_CORE_ADDRESS,
      topics: [...protocolTopics(protocolApprovalEvent)] as unknown as [string, ...string[]],
      data: encodeAbiParameters([{ type: 'bool' }, { type: 'bool' }], [true, true]),
    } as any);
    expect(approval?.decodedData.protocol).toBe(CURRENT_PROTOCOL_ID);

    const strategyApprovalTopics = [
      getEventSelector(strategyApprovalEvent),
      encodeAbiParameters([{ type: 'address' }], [strategy]),
      encodeAbiParameters([{ type: 'bytes32' }], [CURRENT_PROTOCOL_ID]),
      encodeAbiParameters([{ type: 'address' }], [asset]),
    ] as const;
    const strategyApproval = indexer.decodeSupportedLog({
      address: ARC_MAINNET_CORE_ADDRESS,
      topics: [...strategyApprovalTopics] as unknown as [string, ...string[]],
      data: encodeAbiParameters([{ type: 'bool' }, { type: 'bool' }], [true, true]),
    } as any);
    expect(strategyApproval?.decodedData.protocol).toBe(CURRENT_PROTOCOL_ID);
  });

  it('protects against duplicate log reprocessing', async () => {
    const log = makeDepositLog({ blockNumber: 100n, logIndex: 0n });
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([log]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    await indexer.runRange({ startBlock: 100n, endBlock: 105n });
    await indexer.runRange({ startBlock: 100n, endBlock: 105n });

    expect(db.events).toHaveLength(1);
    expect(db.state[0].last_processed_block).toBe(105n);
  });

  it('does not advance the checkpoint when persistence fails', async () => {
    const log = makeDepositLog({ blockNumber: 100n, logIndex: 0n });
    const db = new MockDatabase();
    db.failOnInsert = true;
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([log]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    await expect(indexer.runRange({ startBlock: 100n, endBlock: 105n })).rejects.toThrow('db insert failed');
    expect(db.state[0].last_processed_block).toBe(99n);
  });

  it('ignores unsupported events without corrupting the index', async () => {
    const log = makeUnknownLog({ blockNumber: 100n, logIndex: 1n });
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([log]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    await indexer.runRange({ startBlock: 100n, endBlock: 105n });

    expect(db.events).toHaveLength(0);
    expect(db.state[0].last_processed_block).toBe(105n);
  });

  it('replay is idempotent when the same range is run again', async () => {
    const log = makeDepositLog({ blockNumber: 100n, logIndex: 0n });
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([log]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    await indexer.runRange({ startBlock: 100n, endBlock: 105n });
    await indexer.runRange({ startBlock: 100n, endBlock: 105n });

    expect(db.events).toHaveLength(1);
    expect(db.state[0].last_processed_block).toBe(105n);
  });

  it('supports a dry-run replay without advancing the checkpoint', async () => {
    const log = makeDepositLog({ blockNumber: 100n, logIndex: 0n });
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([log]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    const result = await indexer.runRange({ startBlock: 100n, endBlock: 105n, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(db.events).toHaveLength(0);
    expect(db.state[0].last_processed_block).toBe(99n);
  });

  it('rejects invalid block ranges and handles decode failures safely', async () => {
    const db = new MockDatabase();
    const indexer = new ArcMainnetIndexer({ db: db as any, client: makeClient([]), config: { chainId: ARC_MAINNET_CHAIN_ID, coreAddress: ARC_MAINNET_CORE_ADDRESS } });

    await expect(indexer.runRange({ startBlock: 110n, endBlock: 100n })).rejects.toThrow('Invalid block range');
  });
});
