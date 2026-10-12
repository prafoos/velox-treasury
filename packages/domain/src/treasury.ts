/**
 * Treasury Domain Models
 * Core types representing Treasury balances, allocations, rules, and risk boundaries.
 * 
 * In Step 3, these models provide explicit typing and status descriptors
 * without fabricating blockchain balances or executing transactions.
 */

export type BalanceStateStatus =
  | 'disconnected'
  | 'wrong_network'
  | 'loading'
  | 'error'
  | 'pending_integration'
  | 'not_configured'
  | 'synced';

export const USDC_DECIMALS = 6 as const;
export const USDC_SYMBOL = 'USDC' as const;

export interface TokenBalanceDescriptor {
  readonly symbol: typeof USDC_SYMBOL;
  readonly decimals: number;
  readonly rawAmount: bigint | null;
  readonly formattedAmount: string | null;
  readonly state: BalanceStateStatus;
  readonly message: string;
}

export interface TreasuryBalanceModel {
  readonly total: TokenBalanceDescriptor;
  readonly available: TokenBalanceDescriptor;
  readonly allocated: TokenBalanceDescriptor;
}

export type AllocationCategory =
  | 'operational_reserve'
  | 'yield_strategy'
  | 'swap_liquidity'
  | 'custom_rule';

/** Percentages are stored as basis points (10,000 = 100.00%) to avoid float arithmetic. */
export type AllocationPercentageBps = bigint;

export type AllocationStatus =
  | 'unallocated'
  | 'allocated'
  | 'unavailable'
  | 'pending_execution'
  | 'paused';

export interface TreasuryAllocationBucket {
  readonly id: string;
  readonly name: string;
  readonly category: AllocationCategory;
  readonly targetAmount: string | null;
  readonly targetPercentageBps: AllocationPercentageBps | null;
  readonly currentAmount: string | null;
  readonly status: AllocationStatus;
  readonly description: string;
  readonly targetStage: string;
}

export interface TreasuryAllocationModel {
  readonly buckets: readonly TreasuryAllocationBucket[];
  readonly totalAllocatedPercentageBps: AllocationPercentageBps | null;
  readonly statusMessage: string;
}

export type RuleTriggerType = 'min_reserve' | 'excess_sweep' | 'max_outflow';

export interface TreasuryRuleModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggerType: RuleTriggerType;
  readonly thresholdDisplay: string;
  readonly isEnabled: boolean;
  readonly executionMode: 'manual_approval' | 'automated_bounded';
  readonly implementationStage: string;
}

/**
 * A local-only treasury policy. Amounts are native USDC units (6 decimals).
 * This model describes user intent; it does not grant permissions or execute actions.
 */
export interface TreasuryPolicyModel {
  readonly minimumLiquidReserve: bigint;
  readonly surplusSweepThreshold: bigint;
  readonly dailyOutflowCap: bigint;
  readonly maximumSingleWithdrawal: bigint;
  readonly automatedSweepEnabled: boolean;
  readonly allocations: Readonly<Record<string, AllocationPercentageBps>>;
}

export type TreasuryTransactionType = 'deposit' | 'withdrawal' | 'transfer' | 'approval';
export type TreasuryTransactionStatus = 'pending' | 'confirmed' | 'failed';

/** A transaction record is valid only when sourced from a real Arc Mainnet provider or indexer. */
export interface TreasuryTransactionModel {
  readonly hash: `0x${string}`;
  readonly chainId: number;
  readonly asset: typeof USDC_SYMBOL;
  readonly rawAmount: bigint;
  readonly sender: `0x${string}`;
  readonly recipient: `0x${string}`;
  readonly type: TreasuryTransactionType;
  readonly status: TreasuryTransactionStatus;
  readonly blockNumber?: bigint;
  readonly timestamp?: bigint;
  readonly explorerUrl?: string;
}

export type CircuitBreakerStatus = 'standby' | 'active' | 'triggered';

export interface RiskLimitModel {
  readonly id: string;
  readonly label: string;
  readonly configuredValue: string;
  readonly description: string;
  readonly status: 'active_boundary' | 'pre_activation';
}

export interface EmergencyControlModel {
  readonly status: CircuitBreakerStatus;
  readonly isPaused: boolean;
  readonly limits: readonly RiskLimitModel[];
  readonly statusNotice: string;
  readonly targetStage: string;
}
