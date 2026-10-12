export type FinancialProjectionSource =
  | 'CORE'
  | 'TOKEN_CONTRACT'
  | 'API_DERIVED'
  | 'INDEXER'
  | 'LOCAL_CONFIGURATION'
  | 'LOCAL_DRAFT'
  | 'UNAVAILABLE';

export type FinancialProjectionAvailability = 'AVAILABLE' | 'UNAVAILABLE';
export type FinancialProjectionUnit =
  | 'USDC_BASE_UNITS'
  | 'SHARES'
  | 'BPS'
  | 'BLOCK'
  | 'COUNT'
  | 'BOOLEAN'
  | 'ADDRESS'
  | 'BYTES32'
  | 'ENUM'
  | 'NONE';

export interface FinancialProjectionFieldMetadata {
  readonly source: FinancialProjectionSource;
  readonly availability: FinancialProjectionAvailability;
  readonly unit: FinancialProjectionUnit;
  readonly zeroMeaning: 'AUTHORITATIVE_ZERO' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
}

export interface UserFinancialProjection<Amount> {
  readonly scope: 'USER';
  readonly authenticatedWalletAddress: string;
  readonly chainId: 5042;
  readonly walletUSDC: Amount | null;
  readonly userBalance: Amount | null;
  readonly treasuryFinancialState: {
    readonly principal: Amount | null;
    readonly currentValue: Amount | null;
    readonly unrealizedPnl: Amount | null;
    readonly realizedPnl: Amount | null;
    readonly totalPnl: Amount | null;
    readonly immediatelyWithdrawableValue?: Amount | null;
  } | null;
  readonly publicOperationalStatus: {
    readonly paused: boolean | null;
    readonly blockNumber: Amount | null;
  };
  readonly immediateWithdrawalLiquidity: {
    readonly source: 'CORE' | 'UNAVAILABLE';
    readonly availability: FinancialProjectionAvailability;
    readonly status: 'AVAILABLE' | 'CONSTRAINED' | 'PAUSED' | 'UNAVAILABLE';
    readonly unit: 'USDC_BASE_UNITS';
    readonly value: Amount | null;
  };
  readonly treasuryBucketTargets?: {
    readonly liquidOperationalReserveBps: bigint | null;
    readonly yieldStrategyBufferBps: bigint | null;
    readonly sweepLiquidityBufferBps: bigint | null;
    readonly automationAgentPoolBps: bigint | null;
    readonly liquidOperationalReserve: Amount | null;
    readonly yieldStrategyBuffer: Amount | null;
    readonly sweepLiquidityBuffer: Amount | null;
    readonly automationAgentPool: Amount | null;
    readonly totalManagedAssets: Amount | null;
    readonly totalDeployed: Amount | null;
  } | null;
  readonly fieldMetadata: {
    readonly walletUSDC: FinancialProjectionFieldMetadata;
    readonly userBalance: FinancialProjectionFieldMetadata;
    readonly treasuryFinancialState: FinancialProjectionFieldMetadata;
    readonly principal: FinancialProjectionFieldMetadata;
    readonly currentValue: FinancialProjectionFieldMetadata;
    readonly unrealizedPnl: FinancialProjectionFieldMetadata;
    readonly realizedPnl: FinancialProjectionFieldMetadata;
    readonly totalPnl: FinancialProjectionFieldMetadata;
    readonly immediateWithdrawalLiquidity: FinancialProjectionFieldMetadata;
    readonly paused: FinancialProjectionFieldMetadata;
    readonly blockNumber: FinancialProjectionFieldMetadata;
  };
}

export type UserFinancialProjectionModel = UserFinancialProjection<bigint>;
export type UserFinancialProjectionPayload = UserFinancialProjection<string>;