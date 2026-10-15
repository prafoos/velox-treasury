import type {
  AllocationPercentageBps,
  TreasuryAllocationBucket,
  TreasuryPolicyModel,
  TreasuryRuleModel,
} from '@velox/domain';

import { formatUSDC, parseUSDC } from '../../usdc/services/usdcService';

export const POLICY_STORAGE_KEY = 'velox-treasury-policy-v1';
export const TOTAL_ALLOCATION_BPS = 10_000n;
const MAX_UINT256 = (1n << 256n) - 1n;

export const ALLOCATION_BUCKETS = [
  { id: 'operational_reserve', name: 'Liquid Operational Reserve', category: 'operational_reserve' },
  { id: 'yield_strategy', name: 'Yield Strategy Buffer', category: 'yield_strategy' },
  { id: 'swap_liquidity', name: 'Sweep Liquidity Buffer', category: 'swap_liquidity' },
  { id: 'automation_agent', name: 'Automation / AI Agent Pool', category: 'custom_rule' },
] as const;

export interface TreasuryPolicyFormValues {
  readonly minimumLiquidReserve: string;
  readonly minimumLiquidReserveBps: string;
  readonly maximumTotalDeployed: string;
  readonly timelockDelaySeconds: string;
  readonly valuationFreshnessBlocks: string;
  readonly surplusSweepThreshold: string;
  readonly dailyOutflowCap: string;
  readonly maximumSingleWithdrawal: string;
  readonly automatedSweepEnabled: boolean;
  readonly allocations: Readonly<Record<string, string>>;
}

export interface PolicyValidationResult {
  readonly policy?: TreasuryPolicyModel;
  readonly errors: Readonly<Record<string, string>>;
  readonly isValid: boolean;
}

export interface TreasuryCorePolicyDraft {
  readonly minimumLiquidReserve: bigint;
  readonly minimumLiquidReserveBps: number;
  readonly maximumTotalDeployed: bigint;
  readonly maximumSingleWithdrawal?: bigint;
  readonly dailyOutflowCap?: bigint;
  readonly timelockDelaySeconds: bigint;
  readonly valuationFreshnessBlocks: bigint;
  readonly allocations: TreasuryPolicyModel['allocations'];
}

export interface TreasuryCorePolicyReadback {
  readonly minimumLiquidReserve?: bigint | string | number | null;
  readonly minimumLiquidReserveBps?: bigint | string | number | null;
  readonly maximumTotalDeployed?: bigint | string | number | null;
  readonly maximumSingleWithdrawal?: bigint | string | number | null;
  readonly dailyOutflowCap?: bigint | string | number | null;
  readonly timelockDelaySeconds?: bigint | string | number | null;
  readonly valuationFreshnessBlocks?: bigint | string | number | null;
}

export function createDefaultPolicy(): TreasuryPolicyModel {
  return {
    minimumLiquidReserve: 0n,
    surplusSweepThreshold: 0n,
    dailyOutflowCap: 0n,
    maximumSingleWithdrawal: 0n,
    automatedSweepEnabled: false,
    allocations: {
      operational_reserve: 0n,
      yield_strategy: 0n,
      swap_liquidity: 0n,
      automation_agent: 0n,
    },
  };
}

export function policyToFormValues(
  policy: TreasuryPolicyModel,
  corePolicy: TreasuryCorePolicyReadback | null = null,
): TreasuryPolicyFormValues {
  const amount = (value: bigint) => (formatUSDC(value, { includeCommas: false, minDecimals: 0 }) ?? '0').replace(/\.$/, '');
  const coreValue = (value: bigint | string | number | null | undefined): string =>
    value === null || value === undefined ? '' : String(value);
  const fixedCoreValue = (value: bigint | string | number | null | undefined): string => {
    if (value === null || value === undefined) return 'Unavailable';
    try {
      const parsed = BigInt(value);
      return parsed > 0n && parsed <= MAX_UINT256 ? parsed.toString() : 'Unavailable';
    } catch {
      return 'Unavailable';
    }
  };
  const allocationTotal = Object.values(policy.allocations).reduce((sum, value) => sum + value, 0n);
  return {
    minimumLiquidReserve: corePolicy
      ? coreValue(corePolicy.minimumLiquidReserve)
      : policy.minimumLiquidReserve === 0n ? '' : amount(policy.minimumLiquidReserve),
    minimumLiquidReserveBps: coreValue(corePolicy?.minimumLiquidReserveBps),
    maximumTotalDeployed: coreValue(corePolicy?.maximumTotalDeployed),
    timelockDelaySeconds: fixedCoreValue(corePolicy?.timelockDelaySeconds),
    valuationFreshnessBlocks: fixedCoreValue(corePolicy?.valuationFreshnessBlocks),
    surplusSweepThreshold: amount(policy.surplusSweepThreshold),
    dailyOutflowCap: amount(policy.dailyOutflowCap),
    maximumSingleWithdrawal: amount(policy.maximumSingleWithdrawal),
    automatedSweepEnabled: policy.automatedSweepEnabled,
    allocations: Object.fromEntries(
      ALLOCATION_BUCKETS.map(({ id }) => [
        id,
        allocationTotal === TOTAL_ALLOCATION_BPS ? formatPercentageBps(policy.allocations[id] ?? 0n) : '',
      ]),
    ),
  };
}

export function formatPercentageBps(value: AllocationPercentageBps): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parsePercentageBps(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Enter a percentage with up to two decimal places.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (bps > TOTAL_ALLOCATION_BPS) throw new Error('Percentage must be between 0 and 100.');
  return bps;
}

function parseAmount(value: string, label: string, errors: Record<string, string>, key: string): bigint | undefined {
  try {
    return parseUSDC(value.trim());
  } catch {
    errors[key] = `${label} must be a non-negative USDC amount with up to 6 decimal places.`;
    return undefined;
  }
}

/** Validates a local policy's structure without considering the wallet's current balance. */
export function validateTreasuryPolicy(values: TreasuryPolicyFormValues): PolicyValidationResult {
  const errors: Record<string, string> = {};
  const reserve = parseAmount(values.minimumLiquidReserve, 'Minimum liquid reserve', errors, 'minimumLiquidReserve');
  const sweepThreshold = parseAmount(values.surplusSweepThreshold, 'Surplus sweep threshold', errors, 'surplusSweepThreshold');
  const dailyCap = parseAmount(values.dailyOutflowCap, '24-hour outflow cap', errors, 'dailyOutflowCap');
  const maxWithdrawal = parseAmount(values.maximumSingleWithdrawal, 'Maximum single withdrawal', errors, 'maximumSingleWithdrawal');
  const allocations: Record<string, bigint> = {};

  for (const { id, name } of ALLOCATION_BUCKETS) {
    try {
      allocations[id] = parsePercentageBps(values.allocations[id] ?? '');
    } catch (error) {
      errors[`allocations.${id}`] = error instanceof Error ? `${name}: ${error.message}` : `${name} is invalid.`;
    }
  }

  if (Object.keys(allocations).length === ALLOCATION_BUCKETS.length) {
    const total = Object.values(allocations).reduce((sum, value) => sum + value, 0n);
    if (total !== TOTAL_ALLOCATION_BPS) {
      errors.allocations = `Allocation percentages must total exactly 100% (currently ${formatPercentageBps(total)}%).`;
    }
  }

  if (reserve !== undefined && sweepThreshold !== undefined && values.automatedSweepEnabled && sweepThreshold < reserve) {
    errors.surplusSweepThreshold = 'Automated sweep threshold must be at least the liquid reserve, so sweeps preserve the reserve.';
  }
  if (dailyCap !== undefined && maxWithdrawal !== undefined && maxWithdrawal > dailyCap) {
    errors.maximumSingleWithdrawal = 'Maximum single withdrawal cannot exceed the 24-hour outflow cap.';
  }

  if (Object.keys(errors).length > 0 || reserve === undefined || sweepThreshold === undefined || dailyCap === undefined || maxWithdrawal === undefined) {
    return { errors, isValid: false };
  }

  return {
    errors: {},
    isValid: true,
    policy: {
      minimumLiquidReserve: reserve,
      surplusSweepThreshold: sweepThreshold,
      dailyOutflowCap: dailyCap,
      maximumSingleWithdrawal: maxWithdrawal,
      automatedSweepEnabled: values.automatedSweepEnabled,
      allocations,
    },
  };
}

export function validateTreasuryCorePolicyDraft(
  values: TreasuryPolicyFormValues,
  authoritative: TreasuryCorePolicyReadback | null,
): { readonly draft?: TreasuryCorePolicyDraft; readonly errors: Readonly<Record<string, string>> } {
  const errors: Record<string, string> = {};
  const parseInteger = (value: string, key: string, label: string, max?: bigint): bigint | undefined => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      errors[key] = `${label} is required and must be a non-negative whole number.`;
      return undefined;
    }
    const parsed = BigInt(normalized);
    if (max !== undefined && parsed > max) {
      errors[key] = `${label} must not exceed ${max.toString()}.`;
      return undefined;
    }
    return parsed;
  };
  const parseUSDCValue = (value: string, key: string, label: string): bigint | undefined => {
    try {
      if (!value.trim()) throw new Error('empty');
      const parsed = parseUSDC(value.trim());
      if (parsed > MAX_UINT256) throw new Error('outside uint256');
      return parsed;
    } catch {
      errors[key] = `${label} is required and must be a non-negative USDC amount with up to 6 decimal places.`;
      return undefined;
    }
  };

  const minReserve = parseUSDCValue(values.minimumLiquidReserve, 'minimumLiquidReserve', 'Minimum liquid reserve');
  const reserveBps = parseInteger(values.minimumLiquidReserveBps, 'minimumLiquidReserveBps', 'Minimum liquid reserve BPS', 10_000n);
  const maximumTotalDeployed = parseUSDCValue(values.maximumTotalDeployed, 'maximumTotalDeployed', 'Maximum total deployed');
  const hasWithdrawalPolicyReadback = parseCoreAmount(authoritative?.maximumSingleWithdrawal) !== undefined
    && parseCoreAmount(authoritative?.dailyOutflowCap) !== undefined;
  const maximumSingleWithdrawal = hasWithdrawalPolicyReadback
    ? parseUSDCValue(values.maximumSingleWithdrawal, 'maximumSingleWithdrawal', 'Maximum single withdrawal')
    : undefined;
  const dailyOutflowCap = hasWithdrawalPolicyReadback
    ? parseUSDCValue(values.dailyOutflowCap, 'dailyOutflowCap', '24-hour outflow spending cap')
    : undefined;

  const allocations: Record<string, bigint> = {};
  for (const { id, name } of ALLOCATION_BUCKETS) {
    try {
      allocations[id] = parsePercentageBps(values.allocations[id] ?? '');
    } catch (error) {
      errors[`allocations.${id}`] = error instanceof Error ? `${name}: ${error.message}` : `${name} is invalid.`;
    }
  }
  if (Object.keys(allocations).length === ALLOCATION_BUCKETS.length
    && Object.values(allocations).reduce((sum, value) => sum + value, 0n) !== TOTAL_ALLOCATION_BPS) {
    errors.allocations = 'Allocation percentages must total exactly 100%.';
  }

  if (Object.keys(errors).length > 0
    || minReserve === undefined
    || reserveBps === undefined
    || maximumTotalDeployed === undefined
    || (hasWithdrawalPolicyReadback && (maximumSingleWithdrawal === undefined || dailyOutflowCap === undefined))
  ) {
    return { errors };
  }

  const readOnlyValue = (key: 'timelockDelaySeconds' | 'valuationFreshnessBlocks'): bigint | undefined => {
    const value = authoritative?.[key];
    if (value === null || value === undefined) return undefined;
    try {
      const parsed = BigInt(value);
      return parsed > 0n && parsed <= MAX_UINT256 ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  const timelockDelay = readOnlyValue('timelockDelaySeconds');
  const freshness = readOnlyValue('valuationFreshnessBlocks');
  if (timelockDelay === undefined || freshness === undefined) return { errors: {} };

  return {
    errors: {},
    draft: {
      minimumLiquidReserve: minReserve,
      minimumLiquidReserveBps: Number(reserveBps),
      maximumTotalDeployed,
      ...(hasWithdrawalPolicyReadback ? { maximumSingleWithdrawal, dailyOutflowCap } : {}),
      timelockDelaySeconds: timelockDelay,
      valuationFreshnessBlocks: freshness,
      allocations,
    },
  };
}

function parseCoreAmount(value: bigint | string | number | null | undefined): bigint | undefined {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isSafeInteger(value))) return undefined;
  try {
    const amount = BigInt(value);
    return amount >= 0n && amount <= MAX_UINT256 ? amount : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Execution-time safety boundary for future withdrawal, sweep, transfer, or automation flows.
 * This intentionally does not participate in saving a local policy.
 */
export function validatePolicyExecutionLimits(policy: TreasuryPolicyModel, currentBalance: bigint): Readonly<Record<string, string>> {
  const spendable = currentBalance > policy.minimumLiquidReserve
    ? currentBalance - policy.minimumLiquidReserve
    : 0n;
  const errors: Record<string, string> = {};
  if (policy.dailyOutflowCap > spendable) {
    errors.dailyOutflowCap = `With the current balance and reserve, the spendable amount is ${formatUSDC(spendable)} USDC.`;
  }
  if (policy.maximumSingleWithdrawal > spendable) {
    errors.maximumSingleWithdrawal = `With the current balance and reserve, a withdrawal cannot exceed ${formatUSDC(spendable)} USDC.`;
  }
  return errors;
}

export function getPolicyBalanceWarning(policy: TreasuryPolicyModel, currentBalance: bigint | null): string | undefined {
  if (currentBalance === null) return undefined;
  const errors = validatePolicyExecutionLimits(policy, currentBalance);
  if (Object.keys(errors).length === 0) return undefined;
  const spendable = currentBalance > policy.minimumLiquidReserve ? currentBalance - policy.minimumLiquidReserve : 0n;
  return `Current spendable amount is ${formatUSDC(spendable)} USDC. This does not prevent saving the policy; future execution must satisfy the reserve and balance limits.`;
}

export function createAllocationBuckets(
  policy: TreasuryPolicyModel,
  bucketTargets?: readonly bigint[] | null,
  classifications?: readonly bigint[] | null,
): readonly TreasuryAllocationBucket[] {
  const allocationTotal = Object.values(policy.allocations).reduce((sum, value) => sum + value, 0n);
  const hasCompleteAllocationDraft = allocationTotal === TOTAL_ALLOCATION_BPS;
  return ALLOCATION_BUCKETS.map(({ id, name, category }, index) => {
    const targetAmount = bucketTargets && bucketTargets[index] !== undefined ? bucketTargets[index] : null;
    const classificationIndex = [0, -1, 1, 2][index] ?? -1;
    const currentAmount = classificationIndex >= 0 && classifications && classifications[classificationIndex] !== undefined
      ? classifications[classificationIndex]
      : null;
    const normalizedTarget = targetAmount === null ? null : formatUSDC(targetAmount);
    const normalizedCurrent = currentAmount === null ? null : formatUSDC(currentAmount);

    let status: TreasuryAllocationBucket['status'] = currentAmount === null ? 'unavailable' : 'unallocated';
    let description = hasCompleteAllocationDraft
      ? `${name} current liquid classification is unavailable. Local percentage is a draft, not Core policy.`
      : `${name} current liquid classification and Admin-selected allocation are unavailable.`;
    let targetStage = 'Unavailable: current classification';

    if (currentAmount !== null) {
      if (currentAmount > 0n) {
        status = 'allocated';
        description = hasCompleteAllocationDraft
          ? `${name} current liquid classification is read from Core. The percentage shown is a local draft.`
          : `${name} current liquid classification is read from Core. Admin-selected allocation is unavailable.`;
        targetStage = 'Core classification available';
      } else {
        status = 'unallocated';
        description = hasCompleteAllocationDraft
          ? `${name} current liquid classification is zero according to Core. The percentage shown is a local draft.`
          : `${name} current liquid classification is zero according to Core. Admin-selected allocation is unavailable.`;
        targetStage = 'Zero Core classification';
      }
    }

    return {
      id,
      name,
      category,
      targetAmount: normalizedTarget,
      targetPercentageBps: hasCompleteAllocationDraft ? policy.allocations[id] ?? null : null,
      currentAmount: normalizedCurrent,
      status,
      description: id === 'swap_liquidity'
        ? `${description} This is the Core Sweep Liquidity Buffer target/classification; it does not establish funds reserved or spent for swap operations.`
        : description,
      targetStage,
    };
  });
}

export function createTreasuryRules(policy: TreasuryPolicyModel): readonly TreasuryRuleModel[] {
  return [
    { id: 'rule-min-reserve', name: 'Minimum Liquid Reserve', description: 'Local policy preview only; final Core reserve enforcement is configured and read back separately.', triggerType: 'min_reserve', thresholdDisplay: `${formatUSDC(policy.minimumLiquidReserve)} USDC`, isEnabled: true, executionMode: 'manual_approval', implementationStage: 'Application-only preview — not enforced by final Core' },
    { id: 'rule-excess-sweep', name: 'Surplus Operational Sweep', description: 'Legacy application-only threshold; the final Core exposes no surplus-sweep threshold or sweep automation.', triggerType: 'excess_sweep', thresholdDisplay: `${formatUSDC(policy.surplusSweepThreshold)} USDC`, isEnabled: policy.automatedSweepEnabled, executionMode: 'automated_bounded', implementationStage: 'Application-only preview — not enforced by final Core' },
    { id: 'rule-outflow-cap', name: '24-Hour Outflow Spending Cap', description: 'Legacy application-only threshold; the final Core exposes no rolling 24-hour outflow cap.', triggerType: 'max_outflow', thresholdDisplay: `${formatUSDC(policy.dailyOutflowCap)} USDC / 24h`, isEnabled: true, executionMode: 'manual_approval', implementationStage: 'Application-only preview — not enforced by final Core' },
  ];
}

function readSavedTreasuryPolicy(): TreasuryPolicyModel | null {
  try {
    const raw = window.localStorage.getItem(POLICY_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const candidate = policyToFormValues({
      minimumLiquidReserve: BigInt(String(stored.minimumLiquidReserve)),
      surplusSweepThreshold: BigInt(String(stored.surplusSweepThreshold)),
      dailyOutflowCap: BigInt(String(stored.dailyOutflowCap)),
      maximumSingleWithdrawal: BigInt(String(stored.maximumSingleWithdrawal)),
      automatedSweepEnabled: stored.automatedSweepEnabled === true,
      allocations: Object.fromEntries(ALLOCATION_BUCKETS.map(({ id }) => [id, BigInt(String((stored.allocations as Record<string, unknown> | undefined)?.[id] ?? 0))])),
    });
    return validateTreasuryPolicy(candidate).policy ?? null;
  } catch {
    return null;
  }
}

export function hasSavedTreasuryPolicy(): boolean {
  return readSavedTreasuryPolicy() !== null;
}

export function loadTreasuryPolicy(): TreasuryPolicyModel {
  return readSavedTreasuryPolicy() ?? createDefaultPolicy();
}

export function saveTreasuryPolicy(policy: TreasuryPolicyModel): void {
  window.localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify({
    ...policy,
    minimumLiquidReserve: policy.minimumLiquidReserve.toString(),
    surplusSweepThreshold: policy.surplusSweepThreshold.toString(),
    dailyOutflowCap: policy.dailyOutflowCap.toString(),
    maximumSingleWithdrawal: policy.maximumSingleWithdrawal.toString(),
    allocations: Object.fromEntries(Object.entries(policy.allocations).map(([id, value]) => [id, value.toString()])),
  }));
}
