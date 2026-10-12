import type {
  AiRecommendation,
  AiRecommendationAction,
  AuthenticatedAdminApprovalContext,
  RiskSeverity,
} from '../policy/index.js';

export interface ModelMessagePart {
  readonly text: string;
}

export interface ModelMessage {
  readonly role: 'user' | 'model' | 'system';
  readonly parts: readonly ModelMessagePart[];
}

export interface ModelGenerationConfig {
  readonly temperature?: number;
  readonly seed?: number;
  readonly maxOutputTokens?: number;
  readonly responseMimeType?: 'text/plain' | 'application/json';
  readonly responseSchema?: Record<string, unknown>;
}

export interface ModelRequest {
  readonly systemPrompt?: string;
  readonly prompt: string;
  readonly generationConfig?: ModelGenerationConfig;
  readonly timeoutMs?: number;
}

export interface ModelResponse {
  readonly text: string;
  readonly rawJson?: unknown;
  readonly model: string;
  readonly finishReason?: string;
}

/**
 * Provider-neutral interface for model adapters.
 * Implementations (e.g. Gemini, Anthropic, OpenAI) sit behind this abstraction.
 */
export interface IModelAdapter {
  readonly providerName: string;
  readonly model: string;
  generateText(request: ModelRequest): Promise<ModelResponse>;
  generateStructuredJson<T = unknown>(request: ModelRequest): Promise<{ data: T; response: ModelResponse }>;
}

export interface GeminiAdapterConfig {
  readonly apiKey?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
}

export interface UserFinancialProjectionMetadata {
  readonly source: string;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly unit: string;
  readonly zeroMeaning: 'AUTHORITATIVE_ZERO' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
}

export interface UserFinancialState {
  readonly principal: bigint | string | null;
  readonly currentValue: bigint | string | null;
  readonly unrealizedPnl: bigint | string | null;
  readonly realizedPnl: bigint | string | null;
  readonly totalPnl: bigint | string | null;
}

export type UserStrategyStatusReason =
  | 'POSITION_AVAILABLE'
  | 'CORE_PAUSED'
  | 'STRATEGY_NOT_APPROVED'
  | 'STRATEGY_DISABLED'
  | 'VALUATION_UNAVAILABLE'
  | 'VALUATION_STALE'
  | 'VALUATION_IMPAIRED'
  | 'APPROVED_ENABLED_NO_POSITION'
  | 'UNKNOWN';

export interface UserStrategyStatus {
  readonly source: 'CORE';
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly reason: UserStrategyStatusReason;
  readonly approved: boolean | null;
  readonly enabled: boolean | null;
  readonly paused: boolean | null;
  readonly positionShares: bigint | string | null;
  readonly positionValue: bigint | string | null;
  readonly valuationStatus: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'IMPAIRED' | 'UNKNOWN';
  readonly valuationBlock: bigint | string | null;
  readonly verifiedAtBlock: bigint | string | null;
}

/**
 * Strict data boundary for User AI.
 * Contains only the authenticated user's own permitted projection.
 * Must never include Treasury-wide balances, global liquidity, other users, or admin roles.
 */
export interface UserAiInput {
  readonly scope: 'USER';
  readonly authenticatedWalletAddress: string;
  readonly chainId: 5042;
  readonly walletUSDC: bigint | string | null;
  readonly userBalance: bigint | string | null;
  readonly treasuryFinancialState: UserFinancialState | null;
  readonly publicOperationalStatus: {
    readonly paused: boolean | null;
    readonly blockNumber: bigint | string | null;
  };
  readonly immediateWithdrawalLiquidity: {
    readonly source: 'CORE' | 'UNAVAILABLE';
    readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
    readonly status: 'AVAILABLE' | 'CONSTRAINED' | 'PAUSED' | 'UNAVAILABLE';
    readonly unit: 'USDC_BASE_UNITS';
    readonly value: bigint | string | null;
  };
  readonly personalStrategyStatus?: UserStrategyStatus;
  readonly fieldMetadata?: Record<string, UserFinancialProjectionMetadata>;
}

export interface ProjectionValue<T> {
  readonly source: string;
  readonly availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  readonly unit: string;
  readonly zeroMeaning: 'AUTHORITATIVE_ZERO' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
  readonly value: T | null;
}

export interface ExposureCapProjection {
  readonly absoluteCap: ProjectionValue<bigint | string>;
  readonly relativeCapBps: ProjectionValue<number>;
  readonly approved: ProjectionValue<boolean>;
  readonly enabled: ProjectionValue<boolean>;
}

/**
 * Data boundary for Admin AI.
 * Represents server-side authenticated Admin AI projection.
 */
export interface AdminAiInput {
  readonly scope: 'ADMIN';
  readonly authenticatedWalletAddress: `0x${string}`;
  readonly chainId: 5042;
  readonly coreAddress: `0x${string}`;
  readonly authorization: {
    readonly policyAdmin: ProjectionValue<boolean>;
    readonly timelockExecutor?: ProjectionValue<boolean>;
    readonly automation?: ProjectionValue<boolean>;
    readonly emergency?: ProjectionValue<boolean>;
  };
  readonly treasury: {
    readonly totalUserLiabilities: ProjectionValue<bigint | string>;
    readonly liquidUSDC: ProjectionValue<bigint | string>;
    readonly requiredLiquidReserve: ProjectionValue<bigint | string>;
    readonly availableLiquidity: ProjectionValue<bigint | string>;
    readonly totalDeployed: ProjectionValue<bigint | string>;
    readonly totalManagedAssets: ProjectionValue<bigint | string>;
    readonly paused: ProjectionValue<boolean>;
    readonly blockNumber: ProjectionValue<bigint | string>;
    readonly [key: string]: unknown;
  };
  readonly riskPolicy?: {
    readonly minimumLiquidReserve?: ProjectionValue<bigint | string>;
    readonly minimumLiquidReserveBps?: ProjectionValue<number>;
    readonly maximumTotalDeployed?: ProjectionValue<bigint | string>;
  };
  readonly coreExecutionConstraints?: {
    readonly timelockDelaySeconds: ProjectionValue<bigint | string>;
    readonly valuationFreshnessBlocks: ProjectionValue<bigint | string>;
  };
  readonly bucketPolicy?: unknown;
  readonly marketRisk?: SteakhouseMarketSnapshot;
  readonly strategy?: unknown;
  readonly exposure?: {
    readonly source: string;
    readonly availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
    readonly data: unknown;
    readonly reason?: string;
  };
  readonly operationalStatus?: {
    readonly source: string;
    readonly availability: string;
    readonly data: {
      readonly paused: ProjectionValue<boolean>;
      readonly blockNumber: ProjectionValue<bigint | string>;
    };
  };
  readonly [key: string]: unknown;
}

export interface VerifiedMarketValue<T> {
  readonly source: 'ARC_MAINNET_RPC' | 'MORPHO_GRAPHQL' | 'UNAVAILABLE';
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly value: T | null;
  readonly unit: string;
}

export interface SteakhouseMarketSnapshot {
  readonly source: 'ARC_MAINNET_RPC' | 'MORPHO_GRAPHQL' | 'MULTIPLE_VERIFIED_SOURCES' | 'UNAVAILABLE';
  readonly status: 'PARTIAL' | 'UNAVAILABLE';
  readonly network: 'Arc Mainnet';
  readonly chainId: 5042;
  readonly assetAddress: string;
  readonly vaultAddress: string;
  readonly protocolName: 'STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2';
  readonly protocolId: string;
  readonly identityVerified: boolean;
  readonly freshness: {
    readonly status: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
    readonly blockNumber: string | null;
    readonly blockTimestamp: string | null;
    readonly retrievedAt: string;
    readonly ageSeconds: number | null;
    readonly maximumAgeSeconds: number;
    readonly sourceHeadBlockNumber?: string | null;
    readonly sourceHeadBlockTimestamp?: string | null;
  };
  readonly vault: {
    readonly totalAssets: VerifiedMarketValue<string>;
    readonly availableLiquidity: VerifiedMarketValue<string>;
    readonly idleLiquidity: VerifiedMarketValue<string>;
    readonly utilizationBps: VerifiedMarketValue<number>;
    readonly totalSupply: VerifiedMarketValue<string>;
    readonly apy: VerifiedMarketValue<string>;
    readonly netApy: VerifiedMarketValue<string>;
    readonly allocation: VerifiedMarketValue<string>;
    readonly depositAvailability: VerifiedMarketValue<string>;
    readonly depositGateStatus: VerifiedMarketValue<string>;
    readonly timelock: VerifiedMarketValue<string>;
    readonly warnings: VerifiedMarketValue<readonly string[]>;
  };
  readonly underlyingMarket: {
    readonly allocation: VerifiedMarketValue<string>;
    readonly liquidity: VerifiedMarketValue<string>;
    readonly utilizationBps: VerifiedMarketValue<number>;
    readonly collateralExposure: VerifiedMarketValue<string>;
    readonly lltv: VerifiedMarketValue<string>;
    readonly oracleStatus: VerifiedMarketValue<string>;
    readonly badDebtStatus: VerifiedMarketValue<string>;
    readonly liquidationRisk: VerifiedMarketValue<string>;
    readonly warnings: VerifiedMarketValue<readonly string[]>;
    readonly marketId?: VerifiedMarketValue<string>;
    readonly stateBlockNumber?: VerifiedMarketValue<string>;
    readonly stateTimestamp?: VerifiedMarketValue<string>;
    readonly collateralAssetAddress?: VerifiedMarketValue<string>;
    readonly collateralAssetDecimals?: VerifiedMarketValue<number>;
  };
  readonly unavailableData: readonly string[];
  readonly reason?: string;
}

export type MarketAnalysisSignal =
  | 'ADVERSE_EVIDENCE'
  | 'OPPORTUNITY_EVIDENCE'
  | 'NO_ADVERSE_EVIDENCE_REPORTED'
  | 'THRESHOLD_UNCONFIGURED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'UNAVAILABLE';

export interface MarketAnalysisEvidence {
  readonly field: string;
  readonly source: string;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly value: string | number | boolean | readonly string[] | null;
  readonly unit: string;
  readonly freshness: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
}

export interface MarketAnalysisFinding {
  readonly signal: MarketAnalysisSignal;
  readonly summary: string;
  readonly evidence: readonly MarketAnalysisEvidence[];
  readonly missingInputs: readonly string[];
  readonly threshold?: {
    readonly value: number | null;
    readonly unit: string;
    readonly status: 'CONFIGURED' | 'UNAVAILABLE';
  };
}

export interface BucketAllocationRange {
  readonly id: BucketPolicyAllocationId;
  readonly minimumBps: number;
  readonly maximumBps: number;
  readonly boundBasis: 'DOMAIN_ONLY' | 'CONFIGURED';
}

export interface MarketRiskAnalysis {
  readonly status: 'ANALYZED' | 'PARTIAL' | 'INSUFFICIENT_EVIDENCE' | 'INVALID_MARKET_IDENTITY' | 'STALE_MARKET_DATA';
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
  readonly sourceFreshness: SteakhouseMarketSnapshot['freshness'];
  readonly findings: {
    readonly liquidityRisk: MarketAnalysisFinding;
    readonly yieldOpportunity: MarketAnalysisFinding;
    readonly strategyProtocolRisk: MarketAnalysisFinding;
    readonly withdrawalLiquidityPressure: MarketAnalysisFinding;
    readonly sweepLiquidity: MarketAnalysisFinding;
    readonly automationPool: MarketAnalysisFinding;
  };
  readonly allocationRanges: readonly BucketAllocationRange[];
  readonly allocationCompatibility: {
    readonly totalBps: 10_000;
    readonly compatible: boolean;
    readonly status: 'COMPATIBLE' | 'INCOMPATIBLE';
  };
  readonly unavailableInputs: readonly string[];
  readonly configuredThresholds: {
    readonly highUtilizationBps: number | null;
    readonly lowLiquidityRatioBps: number | null;
    readonly highWithdrawalPressureBps: number | null;
  };
}

export type BucketPolicyAllocationId =
  | 'liquidOperationalReserve'
  | 'yieldStrategyBuffer'
  | 'sweepLiquidityBuffer'
  | 'automationAgentPool';

export interface BucketPolicySuggestion {
  readonly advisoryLabel: 'AI recommendation — Admin review required.';
  readonly recommendationStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'INSUFFICIENT_VERIFIED_DATA' | 'REQUIRES_ADMIN_ADJUSTMENT' | 'CORE_CONSTRAINTS_UNAVAILABLE';
  readonly marketDataStatus: 'PARTIAL' | 'UNAVAILABLE';
  readonly marketData: SteakhouseMarketSnapshot | null;
  readonly veloxFacts: {
    readonly treasury: AdminAiInput['treasury'];
    readonly riskPolicy: AdminAiInput['riskPolicy'];
    readonly currentBucketPolicy: unknown;
    readonly strategy: unknown;
    readonly coreExecutionConstraints: AdminAiInput['coreExecutionConstraints'];
  };
  readonly coreConstraints: {
    readonly status: 'AVAILABLE' | 'UNAVAILABLE';
    readonly maximumYieldStrategyBufferBps: number | null;
    readonly minimumLiquidOperationalReserveBps: number | null;
    readonly reason?: string;
  };
  readonly bucketPolicyValidation: {
    readonly status: 'AVAILABLE' | 'UNAVAILABLE';
    readonly exceededBuckets: readonly BucketPolicyAllocationId[];
  };
  readonly allocations: readonly {
    readonly id: BucketPolicyAllocationId;
    readonly name: string;
    readonly percentage: string;
    readonly bps: number;
    readonly reasoning: string;
  }[];
  readonly totalPercentage: '100%' | null;
  readonly totalBps: 10_000 | null;
  readonly missingVerifiedData: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly keyRiskAssumptions: readonly string[];
  readonly unavailableData: readonly string[];
  readonly executionStatus: 'NOT_EXECUTABLE';
  readonly lineage?: {
    readonly model: string | null;
    readonly generatedAt: string;
    readonly evidenceSnapshotId: string;
    readonly rawGeminiResponse: string | null;
    readonly evidenceSnapshot: unknown;
  };
  readonly lifecycle?: {
    readonly disposition: 'GENERATED' | 'ACTIVE_EXISTING' | 'REGENERATED';
    readonly evidenceStatus: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
  };
}

export interface UntrustedRecommendationPayload {
  readonly recommendationId: string;
  readonly actionType: AiRecommendationAction;
  readonly target: `0x${string}`;
  readonly requestedAmount?: bigint | string | number | null;
  readonly asset?: `0x${string}` | null;
  readonly protocol?: `0x${string}` | null;
  readonly strategy?: `0x${string}` | null;
  readonly rationale: readonly string[];
  readonly evidenceReferences?: readonly string[];
  readonly expectedEffect: string;
  readonly riskClassification: RiskSeverity;
  readonly requiredApproval: 'ADMIN' | 'ADMIN_AND_TIMELOCK' | 'EMERGENCY_AUTHORITY';
}

export class AiServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code = 'AI_SERVICE_ERROR', statusCode = 500) {
    super(message);
    this.name = 'AiServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
