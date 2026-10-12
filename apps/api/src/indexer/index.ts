import { decodeEventLog, getAddress, isAddress, parseAbiItem, type Address, type Hex, type Log } from 'viem';
import { isRetiredArcMainnetAddress } from '@velox/domain';
import { ARC_MAINNET_EXECUTION_CONFIG } from '../config/arc-mainnet.js';

export const ARC_MAINNET_CHAIN_ID = 5042 as const;
export const ARC_MAINNET_CORE_ADDRESS = ARC_MAINNET_EXECUTION_CONFIG.coreAddress;

const EVENT_ABI = [
  parseAbiItem('event Deposit(address indexed user, uint256 amount, uint256 userBalance, uint256 totalLiabilities)'),
  parseAbiItem('event Withdrawal(address indexed user, address indexed recipient, uint256 amount, uint256 userBalance, uint256 totalLiabilities)'),
  parseAbiItem('event UserFinancialStateChanged(address indexed user, uint256 principal, uint256 currentValue, int256 unrealizedPnl, int256 realizedPnl, int256 totalPnl, uint256 immediatelyWithdrawableValue)'),
  parseAbiItem('event TreasuryNAVChanged(uint256 totalManagedAssets, uint256 totalUserLiabilities, uint256 totalDeployed, uint256 liquidUSDC)'),
  parseAbiItem('event AllocationChanged(address indexed strategy, uint256 amount, uint256 position, uint256 totalDeployed)'),
  parseAbiItem('event StrategyDeallocated(address indexed strategy, uint256 amount, uint256 position, uint256 totalDeployed, bool emergency)'),
  parseAbiItem('event ProtocolExposureChanged(bytes32 indexed protocol, uint256 exposure, uint256 absoluteCap, uint16 relativeCapBps)'),
  parseAbiItem('event AssetExposureChanged(address indexed asset, uint256 exposure, uint256 absoluteCap, uint16 relativeCapBps)'),
  parseAbiItem('event AutomationExecuted(address indexed strategy, uint256 amount, bool deallocation)'),
  {
    type: 'event',
    name: 'RiskPolicyChanged',
    inputs: [
      {
        type: 'tuple',
        name: 'policy',
        indexed: false,
        components: [
          { type: 'uint256', name: 'minimumLiquidReserve' },
          { type: 'uint16', name: 'minimumLiquidReserveBps' },
          { type: 'uint256', name: 'maximumTotalDeployed' },
        ],
      },
      { type: 'address', name: 'changedBy', indexed: true },
      { type: 'bool', name: 'immediate' },
    ],
    anonymous: false,
  },
  parseAbiItem('event TimelockScheduled(bytes32 indexed operationId, uint8 indexed kind, uint64 eta)'),
  parseAbiItem('event TimelockExecuted(bytes32 indexed operationId, uint8 indexed kind)'),
  parseAbiItem('event TimelockCancelled(bytes32 indexed operationId, uint8 indexed kind)'),
  parseAbiItem('event ProtocolApprovalChanged(bytes32 indexed protocol, bool approved, bool enabled)'),
  parseAbiItem('event AssetApprovalChanged(address indexed asset, bool approved, bool enabled)'),
  parseAbiItem('event StrategyApprovalChanged(address indexed strategy, bytes32 indexed protocol, address indexed asset, bool approved, bool enabled)'),
  parseAbiItem('event EmergencyPause(address indexed account)'),
  parseAbiItem('event EmergencyDeallocation(address indexed strategy, uint256 amount, address indexed account)'),
  parseAbiItem('event Paused(address account)'),
  parseAbiItem('event Unpaused(address account)'),
  parseAbiItem('event StrategyValuationUpdated(address indexed strategy, uint256 value, uint256 shares, uint256 fees, uint256 blockNumber, uint8 status)'),
  parseAbiItem('event StrategyValuationStatusChanged(address indexed strategy, uint8 status)'),
  parseAbiItem('event StrategyAccountingUpdated(address indexed strategy, uint256 principal, uint256 shares, uint256 currentValue, uint256 realizedYield, uint256 realizedLoss, uint256 withdrawalShortfall, uint256 totalDeployed, uint256 valuationBlock, uint8 status)'),
  {
    type: 'event',
    name: 'BucketPolicyChanged',
    inputs: [
      {
        type: 'tuple',
        name: 'policy',
        indexed: false,
        components: [
          { type: 'uint16', name: 'liquidOperationalReserveBps' },
          { type: 'uint16', name: 'yieldStrategyBufferBps' },
          { type: 'uint16', name: 'sweepLiquidityBufferBps' },
          { type: 'uint16', name: 'automationAgentPoolBps' },
        ],
      },
      { type: 'address', name: 'changedBy', indexed: true },
      { type: 'bool', name: 'immediate' },
    ],
    anonymous: false,
  },
  parseAbiItem('event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)'),
  parseAbiItem('event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)'),
  parseAbiItem('event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)'),
] as const;

export type ArcFinalityMode = 'latest' | 'safe' | 'finalized';

export interface ArcFinalityConfig {
  mode?: ArcFinalityMode;
  offset?: bigint;
}

export interface ArcMainnetIndexerConfig {
  chainId?: number;
  coreAddress?: Address;
  finality?: ArcFinalityConfig;
  startBlock?: bigint;
}

export interface IndexerStateRow {
  chain_id?: bigint | number | string;
  chainId?: bigint | number | string;
  contract_address?: string;
  contractAddress?: string;
  last_processed_block?: bigint | number | string;
  lastProcessedBlock?: bigint | number | string;
  finalized_block?: bigint | number | string;
  finalizedBlock?: bigint | number | string;
  updated_at?: string | Date;
  updatedAt?: string | Date;
}

export interface EventLogRow {
  chain_id: bigint;
  contract_address: string;
  tx_hash: string;
  block_number: bigint;
  block_timestamp: bigint;
  log_index: bigint;
  event_name: string;
  decoded_data: Record<string, unknown>;
}

export interface IndexerDatabase {
  getIndexerState: (chainId: number, contractAddress: Address) => Promise<IndexerStateRow | null>;
  transaction: <T>(fn: (db: IndexerDatabase) => Promise<T>) => Promise<T>;
  insertEvent: (entry: EventLogRow) => Promise<void>;
  updateIndexerState: (row: IndexerStateRow) => Promise<void>;
}

export interface ArcMainnetIndexerOptions {
  db: IndexerDatabase;
  client: {
    getBlockNumber: () => Promise<bigint>;
    getLogs: (params: { address: Address; fromBlock: bigint; toBlock: bigint }) => Promise<Log[]>;
    getBlock: (params: { blockNumber?: bigint; blockTag?: 'safe' | 'finalized' | 'latest' }) => Promise<{ number?: bigint; timestamp?: bigint }>;
  };
  config?: ArcMainnetIndexerConfig;
}

export function toBigInt(value: bigint | number | string | undefined): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  return BigInt(value);
}

export function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => serializeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, serializeValue(nested)]));
  }
  return value;
}

export function isSupportedCoreEventName(name: string): boolean {
  return EVENT_ABI.some((event) => event.name === name);
}

export class ArcMainnetIndexer {
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly db: IndexerDatabase;
  readonly client: ArcMainnetIndexerOptions['client'];
  readonly finality: Required<ArcFinalityConfig>;
  readonly startBlock: bigint;

  constructor({ db, client, config = {} }: ArcMainnetIndexerOptions) {
    const chainId = config.chainId ?? ARC_MAINNET_CHAIN_ID;
    const rawAddress = config.coreAddress ?? ARC_MAINNET_CORE_ADDRESS;

    if (chainId !== ARC_MAINNET_CHAIN_ID) {
      throw new Error(`Arc Mainnet indexer only supports chain ID ${ARC_MAINNET_CHAIN_ID}.`);
    }
    if (!isAddress(rawAddress)) {
      throw new Error('Core address is invalid.');
    }
    if (isRetiredArcMainnetAddress(rawAddress)) {
      throw new Error('Retired Core address cannot be used by the Arc Mainnet indexer.');
    }

    this.chainId = chainId;
    this.coreAddress = getAddress(rawAddress) as Address;
    this.db = db;
    this.client = client;
    this.finality = {
      mode: config.finality?.mode ?? 'safe',
      offset: config.finality?.offset ?? 0n,
    };
    this.startBlock = config.startBlock ?? 0n;
  }

  getSupportedEventNames(): string[] {
    return EVENT_ABI.map((event) => event.name);
  }

  async readState(): Promise<IndexerStateRow> {
    const state = await this.db.getIndexerState(this.chainId, this.coreAddress);
    if (!state) {
      return {
        chain_id: BigInt(this.chainId),
        contract_address: this.coreAddress,
        last_processed_block: this.startBlock,
        finalized_block: this.startBlock,
        updated_at: new Date().toISOString(),
      };
    }

    return {
      chain_id: toBigInt(state.chain_id ?? state.chainId ?? this.chainId),
      contract_address: state.contract_address ?? state.contractAddress ?? this.coreAddress,
      last_processed_block: toBigInt(state.last_processed_block ?? state.lastProcessedBlock ?? this.startBlock),
      finalized_block: toBigInt(state.finalized_block ?? state.finalizedBlock ?? this.startBlock),
      updated_at: state.updated_at ?? state.updatedAt ?? new Date().toISOString(),
    };
  }

  async determineSafeHead(): Promise<bigint> {
    try {
      const head = await this.client.getBlockNumber();
      const mode = this.finality.mode;

      if (mode === 'latest') {
        return head - this.finality.offset;
      }

      if (mode === 'safe' || mode === 'finalized') {
        const block = await this.client.getBlock({ blockTag: mode });
        const safeBlock = block.number ?? head;
        return safeBlock - this.finality.offset;
      }

      return head - this.finality.offset;
    } catch (error) {
      throw new Error(`RPC timeout/error while resolving finality: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getNextRange(startBlock?: bigint, endBlock?: bigint): Promise<{ fromBlock: bigint; toBlock: bigint }> {
    const state = await this.readState();
    const fromBlock = startBlock ?? (toBigInt(state.last_processed_block) + 1n);
    const toBlock = endBlock ?? (await this.determineSafeHead());

    if (fromBlock > toBlock) {
      throw new Error('Invalid block range');
    }

    if (fromBlock < 0n || toBlock < 0n) {
      throw new Error('Invalid block range');
    }

    return { fromBlock, toBlock };
  }

  decodeSupportedLog(log: Log): { eventName: string; decodedData: Record<string, unknown> } | null {
    const eventTopics = log.topics as Hex[];
    if (!eventTopics.length || !eventTopics[0]) {
      return null;
    }

    const matchedEvent = EVENT_ABI.find((event) => {
      try {
        return decodeEventLog({
          abi: [event],
          data: log.data,
          topics: eventTopics as [Hex, ...Hex[]],
        }).eventName === event.name;
      } catch {
        return false;
      }
    });

    if (!matchedEvent) {
      return null;
    }

    try {
      const decoded = decodeEventLog({
        abi: [matchedEvent],
        data: log.data,
        topics: eventTopics as [Hex, ...Hex[]],
      });
      return {
        eventName: String(decoded.eventName ?? 'Unknown'),
        decodedData: serializeValue(decoded.args) as Record<string, unknown>,
      };
    } catch (error) {
      throw new Error(`Decode failure for ${matchedEvent.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async runRange(options: { startBlock?: bigint; endBlock?: bigint; dryRun?: boolean } = {}): Promise<{ processed: number; startBlock: bigint; endBlock: bigint; dryRun: boolean }> {
    const { startBlock, endBlock, dryRun = false } = options;
    const { fromBlock, toBlock } = await this.getNextRange(startBlock, endBlock);

    let logs: Log[];
    try {
      logs = await this.client.getLogs({
        address: this.coreAddress,
        fromBlock,
        toBlock,
      });
    } catch (error) {
      throw new Error(`RPC error while fetching logs: ${error instanceof Error ? error.message : String(error)}`);
    }

    const rows: EventLogRow[] = [];

    for (const log of logs) {
      if (log.address.toLowerCase() !== this.coreAddress.toLowerCase()) {
        continue;
      }

      const decoded = this.decodeSupportedLog(log);
      if (!decoded) {
        continue;
      }

      try {
        const blockNumber = log.blockNumber ?? 0n;
        const block = await this.client.getBlock({ blockNumber });
        rows.push({
          chain_id: BigInt(this.chainId),
          contract_address: this.coreAddress,
          tx_hash: String(log.transactionHash ?? '0x'),
          block_number: BigInt(blockNumber),
          block_timestamp: BigInt(block.timestamp ?? 0n),
          log_index: BigInt(log.logIndex ?? 0),
          event_name: decoded.eventName,
          decoded_data: decoded.decodedData,
        });
      } catch (error) {
        throw new Error(`RPC error while resolving block timestamp for tx ${String(log.transactionHash)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (dryRun) {
      return {
        processed: rows.length,
        startBlock: fromBlock,
        endBlock: toBlock,
        dryRun: true,
      };
    }

    await this.db.transaction(async (tx) => {
      for (const entry of rows) {
        await tx.insertEvent(entry);
      }

      const updated = {
        chain_id: BigInt(this.chainId),
        contract_address: this.coreAddress,
        last_processed_block: toBlock,
        finalized_block: toBlock,
        updated_at: new Date().toISOString(),
      };

      await tx.updateIndexerState(updated);
    });

    return {
      processed: rows.length,
      startBlock: fromBlock,
      endBlock: toBlock,
      dryRun: false,
    };
  }
}

export function createArcMainnetIndexer(options: ArcMainnetIndexerOptions): ArcMainnetIndexer {
  return new ArcMainnetIndexer(options);
}
