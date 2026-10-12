export type LedgerEventRecord = {
  chainId: bigint | number | string;
  contractAddress: string;
  txHash: string;
  blockNumber: bigint | number | string;
  blockTimestamp: bigint | number | string;
  logIndex: bigint | number | string;
  eventName: string;
  decodedData: Record<string, unknown>;
};

export interface UserLedgerEntry {
  userAddress: string;
  eventType: 'Deposit' | 'Withdrawal';
  txHash: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  logIndex: bigint;
  depositAmount: bigint | null;
  withdrawalAmount: bigint | null;
  userUnits: bigint | null;
  userNav: bigint | null;
  realizedYield: bigint | null;
  realizedLoss: bigint | null;
  netUserPosition: bigint | null;
}

export interface UserLedgerSummary {
  userAddress: string;
  depositAmount: bigint;
  withdrawalAmount: bigint;
  userUnits: bigint | null;
  userNav: bigint | null;
  realizedYield: bigint | null;
  realizedLoss: bigint | null;
  netUserPosition: bigint;
}

export interface StrategyLedgerEntry {
  strategyAddress: string | null;
  protocolId: string | null;
  assetAddress: string | null;
  approved: boolean | null;
  enabled: boolean | null;
  absoluteCap: bigint | null;
  relativeCapBps: bigint | null;
  eventType: string;
  txHash: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  logIndex: bigint;
  principal: bigint | null;
  shares: bigint | null;
  currentValue: bigint | null;
  realizedYield: bigint | null;
  realizedLoss: bigint | null;
  feesAccrued: bigint | null;
  withdrawalShortfall: bigint | null;
  valuationSource: string | null;
  valuationStatus: bigint | number | string | null;
  valuationBlock: bigint | null;
  totalDeployed: bigint | null;
  protocolExposure: bigint | null;
  assetExposure: bigint | null;
}

const USER_LEDGER_EVENTS = new Set(['Deposit', 'Withdrawal']);
const STRATEGY_LEDGER_EVENTS = new Set([
  'AllocationChanged',
  'StrategyDeallocated',
  'StrategyValuationUpdated',
  'StrategyAccountingUpdated',
  'StrategyValuationStatusChanged',
  'ProtocolExposureChanged',
  'AssetExposureChanged',
  'StrategyApprovalChanged',
]);

function toBigInt(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '0x') return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function normalizeBytes32(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

function pickFirstAddress(decodedData: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = normalizeAddress(decodedData[key]);
    if (candidate) return candidate;
  }
  return null;
}

function pickFirstBytes32(decodedData: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = normalizeBytes32(decodedData[key]);
    if (candidate) return candidate;
  }
  return null;
}

function pickFirstBigInt(decodedData: Record<string, unknown>, keys: string[]): bigint | null {
  for (const key of keys) {
    const candidate = toBigInt(decodedData[key]);
    if (candidate !== null) return candidate;
  }
  return null;
}

function dedupeEvents(events: LedgerEventRecord[]): LedgerEventRecord[] {
  const seen = new Set<string>();
  const result: LedgerEventRecord[] = [];

  for (const event of events) {
    const key = `${String(event.chainId)}:${event.contractAddress}:${event.txHash}:${String(event.logIndex)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }

  return result;
}

function getUserAddress(decodedData: Record<string, unknown>): string | null {
  return pickFirstAddress(decodedData, ['user', 'account', 'owner']);
}

export function buildUserLedger(events: LedgerEventRecord[]): UserLedgerEntry[] {
  return dedupeEvents(events)
    .filter((event) => USER_LEDGER_EVENTS.has(event.eventName))
    .map((event) => {
      const decoded = event.decodedData ?? {};
      const userAddress = getUserAddress(decoded);

      if (!userAddress) {
        return {
          userAddress: 'unknown',
          eventType: event.eventName as 'Deposit' | 'Withdrawal',
          txHash: event.txHash,
          blockNumber: BigInt(event.blockNumber),
          blockTimestamp: BigInt(event.blockTimestamp),
          logIndex: BigInt(event.logIndex),
          depositAmount: null,
          withdrawalAmount: null,
          userUnits: null,
          userNav: null,
          realizedYield: null,
          realizedLoss: null,
          netUserPosition: null,
        };
      }

      const amount = pickFirstBigInt(decoded, ['amount', 'value']);
      const userBalance = pickFirstBigInt(decoded, ['userBalance', 'balance', 'currentBalance']);
      const userUnits = pickFirstBigInt(decoded, ['userUnits', 'totalUserUnits']);
      const userNav = pickFirstBigInt(decoded, ['userNav', 'nav', 'userBalance', 'balance', 'currentBalance']);
      const depositAmount = event.eventName === 'Deposit' ? amount : null;
      const withdrawalAmount = event.eventName === 'Withdrawal' ? amount : null;
      const netUserPosition = event.eventName === 'Deposit' ? (amount ?? null) : event.eventName === 'Withdrawal' ? (amount !== null ? -amount : null) : null;

      return {
        userAddress,
        eventType: event.eventName as 'Deposit' | 'Withdrawal',
        txHash: event.txHash,
        blockNumber: BigInt(event.blockNumber),
        blockTimestamp: BigInt(event.blockTimestamp),
        logIndex: BigInt(event.logIndex),
        depositAmount,
        withdrawalAmount,
        userUnits,
        userNav,
        realizedYield: null,
        realizedLoss: null,
        netUserPosition,
      };
    });
}

export function summarizeUserLedger(events: LedgerEventRecord[]): Record<string, UserLedgerSummary> {
  const summary = new Map<string, UserLedgerSummary>();

  for (const entry of buildUserLedger(events)) {
    const current = summary.get(entry.userAddress) ?? {
      userAddress: entry.userAddress,
      depositAmount: 0n,
      withdrawalAmount: 0n,
      userUnits: entry.userUnits,
      userNav: entry.userNav,
      realizedYield: null,
      realizedLoss: null,
      netUserPosition: 0n,
    };

    current.depositAmount += entry.depositAmount ?? 0n;
    current.withdrawalAmount += entry.withdrawalAmount ?? 0n;
    current.userUnits = entry.userUnits ?? current.userUnits;
    current.userNav = entry.userNav ?? current.userNav;
    current.netUserPosition += entry.netUserPosition ?? 0n;

    summary.set(entry.userAddress, current);
  }

  return Object.fromEntries([...summary.entries()].map(([userAddress, value]) => [userAddress, value]));
}

export function buildStrategyLedger(events: LedgerEventRecord[]): StrategyLedgerEntry[] {
  return dedupeEvents(events)
    .filter((event) => STRATEGY_LEDGER_EVENTS.has(event.eventName))
    .map((event) => {
      const decoded = event.decodedData ?? {};
      const strategyAddress = pickFirstAddress(decoded, ['strategy', 'strategyAddress']);
      const protocolId = pickFirstBytes32(decoded, ['protocol', 'protocolId']);
      const assetAddress = pickFirstAddress(decoded, ['asset', 'assetAddress']);
      const approved = typeof decoded.approved === 'boolean' ? decoded.approved : null;
      const enabled = typeof decoded.enabled === 'boolean' ? decoded.enabled : null;
      const absoluteCap = pickFirstBigInt(decoded, ['absoluteCap']);
      const relativeCapBps = pickFirstBigInt(decoded, ['relativeCapBps']);
      const isAccountingSnapshot = event.eventName === 'StrategyAccountingUpdated';

      const principal = isAccountingSnapshot ? pickFirstBigInt(decoded, ['principal']) : null;
      const shares = pickFirstBigInt(decoded, ['shares']);
      const currentValue = isAccountingSnapshot
        ? pickFirstBigInt(decoded, ['currentValue'])
        : pickFirstBigInt(decoded, ['value', 'currentValue', 'position']);
      const realizedYield = isAccountingSnapshot ? pickFirstBigInt(decoded, ['realizedYield']) : null;
      const realizedLoss = isAccountingSnapshot ? pickFirstBigInt(decoded, ['realizedLoss']) : null;
      const feesAccrued = pickFirstBigInt(decoded, ['feesAccrued', 'fees']);
      const totalDeployed = pickFirstBigInt(decoded, ['totalDeployed', 'total_deployed']);
      const protocolExposure = pickFirstBigInt(decoded, ['exposure', 'protocolExposure']);
      const assetExposure = pickFirstBigInt(decoded, ['exposure', 'assetExposure']);
      const withdrawalShortfall = pickFirstBigInt(decoded, ['withdrawalShortfall', 'shortfall']);
      const valuationStatus = decoded.status ?? decoded.valuationStatus ?? null;
      const valuationSource = pickFirstAddress(decoded, ['valuationSource', 'source'])
        ?? (event.eventName === 'StrategyValuationUpdated' || event.eventName === 'StrategyAccountingUpdated' ? strategyAddress : null);
      const valuationBlock = toBigInt((decoded.valuationBlock as bigint | number | string | undefined) ?? (decoded.blockNumber as bigint | number | string | undefined));

      return {
        strategyAddress,
        protocolId,
        assetAddress,
        approved,
        enabled,
        absoluteCap,
        relativeCapBps,
        eventType: event.eventName,
        txHash: event.txHash,
        blockNumber: BigInt(event.blockNumber),
        blockTimestamp: BigInt(event.blockTimestamp),
        logIndex: BigInt(event.logIndex),
        principal,
        shares,
        currentValue,
        realizedYield,
        realizedLoss,
        feesAccrued,
        withdrawalShortfall,
        valuationSource,
        valuationStatus:
          typeof valuationStatus === 'bigint' || typeof valuationStatus === 'number' || typeof valuationStatus === 'string'
            ? valuationStatus
            : null,
        valuationBlock,
        totalDeployed,
        protocolExposure,
        assetExposure,
      };
    });
}

export function summarizeStrategyLedger(events: LedgerEventRecord[]): Record<string, StrategyLedgerEntry> {
  const summary = new Map<string, StrategyLedgerEntry>();

  for (const entry of buildStrategyLedger(events)) {
    if (!entry.strategyAddress) {
      continue;
    }

    const current = summary.get(entry.strategyAddress) ?? {
      strategyAddress: entry.strategyAddress,
      protocolId: entry.protocolId,
      assetAddress: entry.assetAddress,
      approved: entry.approved,
      enabled: entry.enabled,
      absoluteCap: entry.absoluteCap,
      relativeCapBps: entry.relativeCapBps,
      eventType: entry.eventType,
      txHash: entry.txHash,
      blockNumber: entry.blockNumber,
      blockTimestamp: entry.blockTimestamp,
      logIndex: entry.logIndex,
      principal: entry.principal,
      shares: entry.shares,
      currentValue: entry.currentValue,
      realizedYield: entry.realizedYield,
      realizedLoss: entry.realizedLoss,
      feesAccrued: entry.feesAccrued,
      withdrawalShortfall: entry.withdrawalShortfall,
      valuationSource: entry.valuationSource,
      valuationStatus: entry.valuationStatus,
      valuationBlock: entry.valuationBlock,
      totalDeployed: entry.totalDeployed,
      protocolExposure: entry.protocolExposure,
      assetExposure: entry.assetExposure,
    };

    if (entry.principal !== null) current.principal = entry.principal;
    if (entry.shares !== null) current.shares = entry.shares;
    if (entry.currentValue !== null) current.currentValue = entry.currentValue;
    if (entry.totalDeployed !== null) current.totalDeployed = entry.totalDeployed;
    if (entry.protocolExposure !== null) current.protocolExposure = entry.protocolExposure;
    if (entry.assetExposure !== null) current.assetExposure = entry.assetExposure;
    if (entry.valuationStatus !== null) current.valuationStatus = entry.valuationStatus;
    if (entry.valuationBlock !== null) current.valuationBlock = entry.valuationBlock;
    if (entry.withdrawalShortfall !== null) current.withdrawalShortfall = entry.withdrawalShortfall;
    if (entry.feesAccrued !== null) current.feesAccrued = entry.feesAccrued;
    if (entry.valuationSource) current.valuationSource = entry.valuationSource;
    if (entry.protocolId) current.protocolId = entry.protocolId;
    if (entry.assetAddress) current.assetAddress = entry.assetAddress;
    if (entry.approved !== null) current.approved = entry.approved;
    if (entry.enabled !== null) current.enabled = entry.enabled;
    if (entry.absoluteCap !== null) current.absoluteCap = entry.absoluteCap;
    if (entry.relativeCapBps !== null) current.relativeCapBps = entry.relativeCapBps;

    current.eventType = entry.eventType;
    current.txHash = entry.txHash;
    current.blockNumber = entry.blockNumber;
    current.blockTimestamp = entry.blockTimestamp;
    current.logIndex = entry.logIndex;

    summary.set(entry.strategyAddress, current);
  }

  return Object.fromEntries([...summary.entries()]);
}
