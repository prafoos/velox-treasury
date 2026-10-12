import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient, useWriteContract } from 'wagmi';
import { parseEventLogs } from 'viem';

import { useWalletStatus } from '../../../hooks/useWalletStatus';
import { useUSDCBalance } from '../../usdc';
import { useTreasuryUserProjection } from './useTreasuryUserProjection';
import {
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
  getArcMainnetTreasuryAddress,
  TIMELOCK_EXECUTOR_ROLE,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { getTreasurySummary } from '../services/treasuryService';
import { formatUSDC } from '../../usdc/services/usdcService';
import { hasSavedTreasuryPolicy, loadTreasuryPolicy } from '../services/policyService';
import type { TreasuryCorePolicyDraft } from '../services/policyService';
import { withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import {
  deduplicateScheduledOperationEvidence,
  readLogsInBlockChunks,
  resolveLogQueryChunkSize,
} from '../services/contractEventPagination';
import type { TreasuryPolicyModel } from '@velox/domain';
import type { TokenBalanceDescriptor, TreasuryModalState, TreasurySummary } from '../types';

type AdminProjection = Record<string, unknown>;

type CoreRiskPolicyState = {
  readonly minimumLiquidReserve: bigint;
  readonly minimumLiquidReserveBps: number;
  readonly maximumTotalDeployed: bigint;
};

type CoreWithdrawalPolicyState = {
  readonly maximumSingleWithdrawal: bigint;
  readonly dailyOutflowCap: bigint;
};

export function withAuthoritativeBucketPolicy(
  policy: TreasuryPolicyModel,
  bucket: CoreBucketPolicyState | null,
): TreasuryPolicyModel | null {
  if (!bucket) return null;
  const values = Object.values(bucket);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000)
    || values.reduce((sum, value) => sum + value, 0) !== 10_000) return null;
  return {
    ...policy,
    allocations: {
      operational_reserve: BigInt(bucket.liquidOperationalReserveBps),
      yield_strategy: BigInt(bucket.yieldStrategyBufferBps),
      swap_liquidity: BigInt(bucket.sweepLiquidityBufferBps),
      automation_agent: BigInt(bucket.automationAgentPoolBps),
    },
  };
}

export type CoreBucketPolicyState = {
  readonly liquidOperationalReserveBps: number;
  readonly yieldStrategyBufferBps: number;
  readonly sweepLiquidityBufferBps: number;
  readonly automationAgentPoolBps: number;
};

type PendingPolicyOperation = {
  readonly operationId: string;
  readonly kind: 'RiskPolicy' | 'BucketPolicy' | 'WithdrawalPolicy';
  readonly eta: bigint;
  readonly bucketPolicy?: CoreBucketPolicyState;
};

type PolicyMutationPorts = {
  readonly submit: (action: PolicyMutationAction) => Promise<string>;
  readonly waitForReceipt: (hash: string) => Promise<{ readonly status: string; readonly logs: readonly unknown[] }>;
  readonly findScheduledOperation: (receipt: { readonly status: string; readonly logs: readonly unknown[] }, action: PolicyMutationAction) => string;
  readonly readPendingOperation: (operationId: string) => Promise<{
    readonly kind: number;
    readonly eta: bigint;
    readonly value1: bigint;
    readonly value2: bigint;
    readonly bps: number;
    readonly bps2: number;
    readonly bps3: number;
    readonly bps4: number;
  }>;
  readonly readPolicies: () => Promise<{
    readonly riskPolicy: CoreRiskPolicyState;
    readonly bucketPolicy: CoreBucketPolicyState;
    readonly withdrawalPolicy?: CoreWithdrawalPolicyState | null;
  }>;
};

export type PolicyMutationResult = {
  readonly status: 'APPLIED' | 'SCHEDULED' | 'NO_ONCHAIN_CHANGES';
  readonly pendingOperations: readonly PendingPolicyOperation[];
};

export type PendingBucketPolicy = {
  readonly operationId: string;
  readonly eta: bigint;
  readonly policy: CoreBucketPolicyState;
};

export type PendingRiskPolicy = {
  readonly operationId: string;
  readonly eta: bigint;
  readonly policy: CoreRiskPolicyState;
};

export type PendingWithdrawalPolicy = {
  readonly operationId: string;
  readonly eta: bigint;
  readonly policy: CoreWithdrawalPolicyState;
};

// Values follow the OperationKind declaration order in VeloxTreasuryCore.
const RISK_POLICY_OPERATION_KIND = 0;
const BUCKET_POLICY_OPERATION_KIND = 4;
const WITHDRAWAL_POLICY_OPERATION_KIND = 5;

type RiskPolicyOperation = {
  readonly kind: number;
  readonly eta: bigint;
  readonly value1: bigint;
  readonly value2: bigint;
  readonly bps: number;
  readonly bps2: number;
  readonly bps3: number;
  readonly bps4: number;
};

export async function discoverPendingRiskPolicyOperations(
  scheduledOperations: readonly { readonly operationId: string; readonly kind: number; readonly eta: bigint }[],
  readPendingOperation: (operationId: string) => Promise<RiskPolicyOperation>,
): Promise<readonly PendingRiskPolicy[]> {
  const riskOperations = scheduledOperations.filter((operation) => operation.kind === RISK_POLICY_OPERATION_KIND);
  const pending = await Promise.all(riskOperations.map(async (scheduled) => {
    if (!/^0x[\da-fA-F]{64}$/.test(scheduled.operationId)) {
      throw new Error('Core returned an invalid TimelockScheduled operation ID.');
    }
    const operation = await readPendingOperation(scheduled.operationId);
    if (operation.eta === 0n || operation.kind !== RISK_POLICY_OPERATION_KIND) return null;
    if (operation.eta !== scheduled.eta) {
      throw new Error('Core pending Risk Policy operation does not match its TimelockScheduled evidence.');
    }
    if (operation.bps < 0 || operation.bps > 10_000 || operation.bps2 !== 0
      || operation.bps3 !== 0 || operation.bps4 !== 0) {
      throw new Error('Core pending Risk Policy operation has an invalid payload.');
    }
    return {
      operationId: scheduled.operationId,
      eta: operation.eta,
      policy: {
        minimumLiquidReserve: operation.value1,
        minimumLiquidReserveBps: operation.bps,
        maximumTotalDeployed: operation.value2,
      },
    };
  }));
  return pending.filter((operation): operation is PendingRiskPolicy => operation !== null)
    .sort((left, right) => left.eta < right.eta ? -1 : left.eta > right.eta ? 1 : 0);
}

export async function discoverPendingWithdrawalPolicyOperations(
  scheduledOperations: readonly { readonly operationId: string; readonly kind: number; readonly eta: bigint }[],
  readPendingOperation: (operationId: string) => Promise<RiskPolicyOperation>,
): Promise<readonly PendingWithdrawalPolicy[]> {
  const withdrawalOperations = scheduledOperations.filter((operation) => operation.kind === WITHDRAWAL_POLICY_OPERATION_KIND);
  const pending = await Promise.all(withdrawalOperations.map(async (scheduled) => {
    if (!/^0x[\da-fA-F]{64}$/.test(scheduled.operationId)) {
      throw new Error('Core returned an invalid TimelockScheduled operation ID.');
    }
    const operation = await readPendingOperation(scheduled.operationId);
    if (operation.eta === 0n) return null;
    if (operation.kind !== WITHDRAWAL_POLICY_OPERATION_KIND) {
      throw new Error('Core pending operation kind does not match the Withdrawal Policy event.');
    }
    if (operation.eta !== scheduled.eta) {
      throw new Error('Core pending Withdrawal Policy operation does not match its TimelockScheduled evidence.');
    }
    if (operation.bps !== 0 || operation.bps2 !== 0 || operation.bps3 !== 0 || operation.bps4 !== 0) {
      throw new Error('Core pending Withdrawal Policy operation has an invalid payload.');
    }
    return {
      operationId: scheduled.operationId,
      eta: operation.eta,
      policy: {
        maximumSingleWithdrawal: operation.value1,
        dailyOutflowCap: operation.value2,
      },
    };
  }));
  return pending.filter((operation): operation is PendingWithdrawalPolicy => operation !== null)
    .sort((left, right) => left.eta < right.eta ? -1 : left.eta > right.eta ? 1 : 0);
}

export async function discoverPendingBucketPolicyOperations(
  scheduledOperations: readonly { readonly operationId: string; readonly kind: number; readonly eta: bigint }[],
  readPendingOperation: (operationId: string) => Promise<RiskPolicyOperation>,
): Promise<readonly PendingBucketPolicy[]> {
  const bucketOperations = scheduledOperations.filter((operation) => operation.kind === BUCKET_POLICY_OPERATION_KIND);
  const pending = await Promise.all(bucketOperations.map(async (scheduled) => {
    if (!/^0x[\da-fA-F]{64}$/.test(scheduled.operationId)) {
      throw new Error('Core returned an invalid TimelockScheduled operation ID.');
    }
    const operation = await readPendingOperation(scheduled.operationId);
    if (operation.eta === 0n) return null;
    if (operation.kind !== BUCKET_POLICY_OPERATION_KIND) {
      throw new Error('Core pending operation kind does not match the Bucket Policy event.');
    }
    if (operation.eta !== scheduled.eta) {
      throw new Error('Core pending Bucket Policy operation does not match its TimelockScheduled evidence.');
    }
    const values = [operation.bps, operation.bps2, operation.bps3, operation.bps4];
    if (operation.value1 !== 0n || operation.value2 !== 0n
      || values.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000)
      || values.reduce((sum, value) => sum + value, 0) !== 10_000) {
      throw new Error('Core pending Bucket Policy operation has an invalid payload.');
    }
    return {
      operationId: scheduled.operationId,
      eta: operation.eta,
      policy: {
        liquidOperationalReserveBps: operation.bps,
        yieldStrategyBufferBps: operation.bps2,
        sweepLiquidityBufferBps: operation.bps3,
        automationAgentPoolBps: operation.bps4,
      },
    };
  }));
  return pending.filter((operation): operation is PendingBucketPolicy => operation !== null)
    .sort((left, right) => left.eta < right.eta ? -1 : left.eta > right.eta ? 1 : 0);
}

type ScheduledPolicyExecutionPorts = {
  readonly isTimelockExecutor: () => Promise<boolean>;
  readonly readPendingOperation: (operationId: string) => Promise<RiskPolicyOperation>;
  readonly getCurrentTimestamp: () => Promise<bigint>;
  readonly submit: (operationId: string) => Promise<string>;
  readonly waitForReceipt: (hash: string) => Promise<{ readonly status: string }>;
  readonly readRiskPolicy: () => Promise<CoreRiskPolicyState>;
  readonly readWithdrawalPolicy: () => Promise<CoreWithdrawalPolicyState>;
};

export async function executeAndVerifyScheduledPolicy(
  pending: PendingRiskPolicy | PendingWithdrawalPolicy,
  ports: ScheduledPolicyExecutionPorts,
): Promise<CoreRiskPolicyState | CoreWithdrawalPolicyState> {
  if (!await ports.isTimelockExecutor()) {
    throw new Error('Connected wallet is not the Treasury TIMELOCK_EXECUTOR.');
  }

  const operation = await ports.readPendingOperation(pending.operationId);
  const isRiskPolicy = 'minimumLiquidReserve' in pending.policy;
  const expectedKind = isRiskPolicy ? RISK_POLICY_OPERATION_KIND : WITHDRAWAL_POLICY_OPERATION_KIND;
  const matchesPayload = isRiskPolicy
    ? operation.value1 === pending.policy.minimumLiquidReserve
      && operation.bps === pending.policy.minimumLiquidReserveBps
      && operation.value2 === pending.policy.maximumTotalDeployed
      && operation.bps >= 0 && operation.bps <= 10_000
    : operation.value1 === pending.policy.maximumSingleWithdrawal
      && operation.value2 === pending.policy.dailyOutflowCap
      && operation.bps === 0;
  if (operation.eta === 0n || operation.kind !== expectedKind || operation.eta !== pending.eta
    || !matchesPayload || operation.bps2 !== 0 || operation.bps3 !== 0 || operation.bps4 !== 0) {
    throw new Error(`Pending ${isRiskPolicy ? 'Risk' : 'Withdrawal'} Policy operation no longer matches the verified Core operation.`);
  }
  if (!isRiskPolicy && await ports.getCurrentTimestamp() < operation.eta) {
    throw new Error('Withdrawal Policy operation timelock ETA has not been reached.');
  }

  const hash = await ports.submit(pending.operationId);
  const receipt = await ports.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error('executeRiskPolicy failed or was reverted.');

  if (isRiskPolicy) {
    const appliedPolicy = await ports.readRiskPolicy();
    if (appliedPolicy.minimumLiquidReserve !== pending.policy.minimumLiquidReserve
      || appliedPolicy.minimumLiquidReserveBps !== pending.policy.minimumLiquidReserveBps
      || appliedPolicy.maximumTotalDeployed !== pending.policy.maximumTotalDeployed) {
      throw new Error('Core riskPolicy readback does not match the executed operation.');
    }
    return appliedPolicy;
  }

  const appliedPolicy = await ports.readWithdrawalPolicy();
  if (appliedPolicy.maximumSingleWithdrawal !== pending.policy.maximumSingleWithdrawal
    || appliedPolicy.dailyOutflowCap !== pending.policy.dailyOutflowCap) {
    throw new Error('Core Withdrawal Policy readback does not match the executed operation.');
  }
  return appliedPolicy;
}

type RiskPolicyExecutionPorts = Omit<ScheduledPolicyExecutionPorts, 'getCurrentTimestamp' | 'readWithdrawalPolicy'>;

export async function executeAndVerifyRiskPolicy(
  pending: PendingRiskPolicy,
  ports: RiskPolicyExecutionPorts,
): Promise<CoreRiskPolicyState> {
  const result = await executeAndVerifyScheduledPolicy(pending, {
    ...ports,
    getCurrentTimestamp: async () => 0n,
    readWithdrawalPolicy: async () => { throw new Error('Withdrawal Policy readback is not available for a Risk Policy operation.'); },
  });
  if (!('minimumLiquidReserve' in result)) throw new Error('Core returned an invalid Risk Policy readback.');
  return result;
}

type BucketPolicyExecutionPorts = {
  readonly isTimelockExecutor: () => Promise<boolean>;
  readonly getCurrentTimestamp?: () => Promise<bigint>;
  readonly readPendingOperation: (operationId: string) => Promise<{
    readonly kind: number;
    readonly eta: bigint;
    readonly value1: bigint;
    readonly value2: bigint;
    readonly bps: number;
    readonly bps2: number;
    readonly bps3: number;
    readonly bps4: number;
  }>;
  readonly submit: (operationId: string) => Promise<string>;
  readonly waitForReceipt: (hash: string) => Promise<{ readonly status: string }>;
  readonly readBucketPolicy: () => Promise<CoreBucketPolicyState>;
};

export async function executeAndVerifyBucketPolicy(
  pending: PendingBucketPolicy,
  ports: BucketPolicyExecutionPorts,
): Promise<CoreBucketPolicyState> {
  if (!await ports.isTimelockExecutor()) {
    throw new Error('Connected wallet is not the Treasury TIMELOCK_EXECUTOR.');
  }

  const operation = await ports.readPendingOperation(pending.operationId);
  if (operation.kind !== BUCKET_POLICY_OPERATION_KIND || operation.eta === 0n || operation.eta !== pending.eta
    || operation.value1 !== 0n || operation.value2 !== 0n
    || operation.bps !== pending.policy.liquidOperationalReserveBps
    || operation.bps2 !== pending.policy.yieldStrategyBufferBps
    || operation.bps3 !== pending.policy.sweepLiquidityBufferBps
    || operation.bps4 !== pending.policy.automationAgentPoolBps) {
    throw new Error('Pending BucketPolicy operation no longer matches the verified Core operation.');
  }
  if (ports.getCurrentTimestamp && await ports.getCurrentTimestamp() < operation.eta) {
    throw new Error('BucketPolicy operation timelock ETA has not been reached.');
  }

  const hash = await ports.submit(pending.operationId);
  const receipt = await ports.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error('executeBucketPolicy failed or was reverted.');

  const appliedPolicy = await ports.readBucketPolicy();
  if (appliedPolicy.liquidOperationalReserveBps !== pending.policy.liquidOperationalReserveBps
    || appliedPolicy.yieldStrategyBufferBps !== pending.policy.yieldStrategyBufferBps
    || appliedPolicy.sweepLiquidityBufferBps !== pending.policy.sweepLiquidityBufferBps
    || appliedPolicy.automationAgentPoolBps !== pending.policy.automationAgentPoolBps) {
    throw new Error('Core bucketPolicy readback does not match the executed operation.');
  }
  return appliedPolicy;
}

type CoreBucketPolicyArgument = {
    liquidOperationalReserveBps: number;
    yieldStrategyBufferBps: number;
    sweepLiquidityBufferBps: number;
    automationAgentPoolBps: number;
};

type PolicyMutationAction =
  | {
      readonly functionName: 'scheduleRiskPolicy';
      readonly args: readonly [bigint, number, bigint];
    }
  | {
      readonly functionName: 'reduceRiskPolicy';
      readonly args: readonly [bigint, number, bigint];
    }
  | {
      readonly functionName: 'setWithdrawalPolicy';
      readonly args: readonly [bigint, bigint];
      readonly isRiskIncreasing: boolean;
      readonly previousMaximumSingleWithdrawal: bigint;
      readonly previousDailyOutflowCap: bigint;
    }
  | {
      readonly functionName: 'scheduleBucketPolicy';
      readonly args: readonly [CoreBucketPolicyArgument];
    }
  | {
      readonly functionName: 'reduceBucketPolicy';
      readonly args: readonly [CoreBucketPolicyArgument];
    };

function isRiskIncreasingBucketPolicy(next: CoreBucketPolicyState, current: CoreBucketPolicyState): boolean {
  return next.yieldStrategyBufferBps > current.yieldStrategyBufferBps
    || next.liquidOperationalReserveBps < current.liquidOperationalReserveBps;
}

export function buildPolicyMutationPlan(
  policy: TreasuryCorePolicyDraft,
  currentRisk: CoreRiskPolicyState | null,
  currentBucket: CoreBucketPolicyState | null,
  currentWithdrawalPolicy: CoreWithdrawalPolicyState | null = null,
): { readonly actions: readonly PolicyMutationAction[] } {
  if (!currentRisk || !currentBucket) throw new Error('Current Core policy getters are unavailable.');
  if (policy.minimumLiquidReserve < 0n || policy.maximumTotalDeployed < 0n) {
    throw new Error('Core risk policy amounts cannot be negative.');
  }
  if (policy.valuationFreshnessBlocks <= 0n) throw new Error('Valuation freshness blocks must be greater than zero.');
  const toBps = (value: bigint | undefined, name: string): number => {
    if (value === undefined || value < 0n || value > 10_000n) throw new Error(`Invalid or unavailable ${name}.`);
    return Number(value);
  };

  const nextBucketPolicy: CoreBucketPolicyState = {
    liquidOperationalReserveBps: toBps(policy.allocations.operational_reserve, 'Liquid Operational Reserve BPS'),
    yieldStrategyBufferBps: toBps(policy.allocations.yield_strategy, 'Yield Strategy Buffer BPS'),
    sweepLiquidityBufferBps: toBps(policy.allocations.swap_liquidity, 'Sweep Liquidity Buffer BPS'),
    automationAgentPoolBps: toBps(policy.allocations.automation_agent, 'Automation Agent Pool BPS'),
  };
  if (Object.values(nextBucketPolicy).reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new Error('Core bucket policy must total exactly 10,000 BPS.');
  }

  const actions: PolicyMutationAction[] = [];

  const riskChanged = policy.minimumLiquidReserve !== currentRisk.minimumLiquidReserve
    || policy.minimumLiquidReserveBps !== currentRisk.minimumLiquidReserveBps
    || policy.maximumTotalDeployed !== currentRisk.maximumTotalDeployed;
  if (riskChanged) {
    const hasRiskIncrease = policy.minimumLiquidReserve < currentRisk.minimumLiquidReserve
      || policy.minimumLiquidReserveBps < currentRisk.minimumLiquidReserveBps
      || policy.maximumTotalDeployed > currentRisk.maximumTotalDeployed;
    const hasRiskReduction = policy.minimumLiquidReserve > currentRisk.minimumLiquidReserve
      || policy.minimumLiquidReserveBps > currentRisk.minimumLiquidReserveBps
      || policy.maximumTotalDeployed < currentRisk.maximumTotalDeployed;
    if (hasRiskIncrease && hasRiskReduction) {
      throw new Error('Risk policy changes mix increases and reductions; apply them in separate Core policy updates.');
    }
    actions.push({
      functionName: hasRiskIncrease ? 'scheduleRiskPolicy' : 'reduceRiskPolicy',
      args: [policy.minimumLiquidReserve, policy.minimumLiquidReserveBps, policy.maximumTotalDeployed],
    });
  }

  const bucketChanged = nextBucketPolicy.liquidOperationalReserveBps !== currentBucket.liquidOperationalReserveBps
    || nextBucketPolicy.yieldStrategyBufferBps !== currentBucket.yieldStrategyBufferBps
    || nextBucketPolicy.sweepLiquidityBufferBps !== currentBucket.sweepLiquidityBufferBps
    || nextBucketPolicy.automationAgentPoolBps !== currentBucket.automationAgentPoolBps;

  if (bucketChanged) {
    actions.push({
      functionName: isRiskIncreasingBucketPolicy(nextBucketPolicy, currentBucket) ? 'scheduleBucketPolicy' : 'reduceBucketPolicy',
      args: [nextBucketPolicy],
    });
  }

  const hasWithdrawalDraft = policy.maximumSingleWithdrawal !== undefined || policy.dailyOutflowCap !== undefined;
  if (hasWithdrawalDraft && !currentWithdrawalPolicy) {
    throw new Error('Current Core withdrawal policy getters are unavailable.');
  }
  if (currentWithdrawalPolicy && hasWithdrawalDraft) {
    if (policy.maximumSingleWithdrawal === undefined || policy.dailyOutflowCap === undefined) {
      throw new Error('Both Core withdrawal policy limits must be available before applying changes.');
    }
    const withdrawalPolicyChanged = policy.maximumSingleWithdrawal !== currentWithdrawalPolicy.maximumSingleWithdrawal
      || policy.dailyOutflowCap !== currentWithdrawalPolicy.dailyOutflowCap;
    if (withdrawalPolicyChanged) {
      actions.push({
        functionName: 'setWithdrawalPolicy',
        args: [policy.maximumSingleWithdrawal, policy.dailyOutflowCap],
        isRiskIncreasing: (currentWithdrawalPolicy.maximumSingleWithdrawal !== 0n
          && (policy.maximumSingleWithdrawal === 0n || policy.maximumSingleWithdrawal > currentWithdrawalPolicy.maximumSingleWithdrawal))
          || (currentWithdrawalPolicy.dailyOutflowCap !== 0n
            && (policy.dailyOutflowCap === 0n || policy.dailyOutflowCap > currentWithdrawalPolicy.dailyOutflowCap)),
        previousMaximumSingleWithdrawal: currentWithdrawalPolicy.maximumSingleWithdrawal,
        previousDailyOutflowCap: currentWithdrawalPolicy.dailyOutflowCap,
      });
    }
  }

  return { actions };
}

export async function submitAndVerifyPolicyMutationPlan(
  plan: { readonly actions: readonly PolicyMutationAction[] },
  policy: TreasuryCorePolicyDraft,
  currentRisk: CoreRiskPolicyState,
  currentBucket: CoreBucketPolicyState,
  ports: PolicyMutationPorts,
): Promise<PolicyMutationResult> {
  const pendingOperations: PendingPolicyOperation[] = [];
  const confirmedActions: PolicyMutationAction[] = [];

  for (const action of plan.actions) {
    try {
      const hash = await ports.submit(action);
      const receipt = await ports.waitForReceipt(hash);
      if (receipt.status !== 'success') throw new Error(`${action.functionName} failed or was reverted.`);

      const isScheduled = action.functionName === 'scheduleRiskPolicy'
        || action.functionName === 'scheduleBucketPolicy'
        || (action.functionName === 'setWithdrawalPolicy' && action.isRiskIncreasing);
      if (isScheduled) {
        const operationId = ports.findScheduledOperation(receipt, action);
        const operation = await ports.readPendingOperation(operationId);
        const expectedKind = action.functionName === 'scheduleRiskPolicy' ? 0
          : action.functionName === 'scheduleBucketPolicy' ? 4 : 5;
        const expectedValues = action.functionName === 'scheduleRiskPolicy'
          ? {
              value1: action.args[0],
              value2: action.args[2],
              bps: action.args[1],
              bps2: 0,
              bps3: 0,
              bps4: 0,
            }
          : action.functionName === 'scheduleBucketPolicy'
            ? {
              value1: 0n,
              value2: 0n,
              bps: action.args[0].liquidOperationalReserveBps,
              bps2: action.args[0].yieldStrategyBufferBps,
              bps3: action.args[0].sweepLiquidityBufferBps,
              bps4: action.args[0].automationAgentPoolBps,
            }
            : {
              value1: action.args[0],
              value2: action.args[1],
              bps: 0,
              bps2: 0,
              bps3: 0,
              bps4: 0,
            };
        if (operation.kind !== expectedKind || operation.eta <= 0n
          || operation.value1 !== expectedValues.value1 || operation.value2 !== expectedValues.value2
          || operation.bps !== expectedValues.bps || operation.bps2 !== expectedValues.bps2
          || operation.bps3 !== expectedValues.bps3 || operation.bps4 !== expectedValues.bps4) {
          throw new Error(`${action.functionName} receipt was not confirmed by Core pending-operation readback.`);
        }
        pendingOperations.push({
          operationId,
          kind: expectedKind === 0 ? 'RiskPolicy' : expectedKind === 4 ? 'BucketPolicy' : 'WithdrawalPolicy',
          eta: operation.eta,
          ...(expectedKind === 4 ? {
            bucketPolicy: {
              liquidOperationalReserveBps: operation.bps,
              yieldStrategyBufferBps: operation.bps2,
              sweepLiquidityBufferBps: operation.bps3,
              automationAgentPoolBps: operation.bps4,
            },
          } : {}),
        });
      }
      confirmedActions.push(action);
    } catch (error) {
      if (confirmedActions.length === 0) throw error;
      let priorState = 'Earlier transaction(s) were submitted, but authoritative Core readback is unavailable.';
      try {
        assertPolicyStateMatches(await ports.readPolicies(), policy, currentRisk, currentBucket, confirmedActions);
        priorState = 'Earlier policy change(s) were confirmed by authoritative Core readback.';
      } catch {
        // Keep the failed later action visible without claiming success for earlier writes.
      }
      const scheduled = pendingOperations.map(({ operationId, kind, eta }) => `${kind} ${operationId} (ETA ${eta})`).join(', ');
      const pendingText = scheduled ? ` Verified pending operation(s): ${scheduled}.` : '';
      const message = error instanceof Error ? error.message : 'Transaction failed or was rejected.';
      throw new Error(`${message} ${priorState}${pendingText}`);
    }
  }

  assertPolicyStateMatches(await ports.readPolicies(), policy, currentRisk, currentBucket, confirmedActions);

  return {
    status: pendingOperations.length > 0 ? 'SCHEDULED' : plan.actions.length > 0 ? 'APPLIED' : 'NO_ONCHAIN_CHANGES',
    pendingOperations,
  };
}

function assertPolicyStateMatches(
  refreshed: {
    readonly riskPolicy: CoreRiskPolicyState;
    readonly bucketPolicy: CoreBucketPolicyState;
    readonly withdrawalPolicy?: CoreWithdrawalPolicyState | null;
  },
  policy: TreasuryCorePolicyDraft,
  currentRisk: CoreRiskPolicyState,
  currentBucket: CoreBucketPolicyState,
  confirmedActions: readonly PolicyMutationAction[],
): void {
  const riskAction = confirmedActions.find((action) => action.functionName === 'scheduleRiskPolicy' || action.functionName === 'reduceRiskPolicy');
  const bucketAction = confirmedActions.find((action) => action.functionName === 'scheduleBucketPolicy' || action.functionName === 'reduceBucketPolicy');
  const riskWasScheduled = riskAction?.functionName === 'scheduleRiskPolicy';
  const bucketWasScheduled = bucketAction?.functionName === 'scheduleBucketPolicy';
  const expectedRisk: CoreRiskPolicyState = {
    minimumLiquidReserve: !riskAction || riskWasScheduled ? currentRisk.minimumLiquidReserve : riskAction.args[0],
    minimumLiquidReserveBps: !riskAction || riskWasScheduled ? currentRisk.minimumLiquidReserveBps : riskAction.args[1],
    maximumTotalDeployed: !riskAction || riskWasScheduled ? currentRisk.maximumTotalDeployed : riskAction.args[2],
  };
  const expectedBucket: CoreBucketPolicyState = !bucketAction || bucketWasScheduled ? currentBucket : {
    liquidOperationalReserveBps: Number(policy.allocations.operational_reserve),
    yieldStrategyBufferBps: Number(policy.allocations.yield_strategy),
    sweepLiquidityBufferBps: Number(policy.allocations.swap_liquidity),
    automationAgentPoolBps: Number(policy.allocations.automation_agent),
  };
  if (refreshed.riskPolicy.minimumLiquidReserve !== expectedRisk.minimumLiquidReserve
    || refreshed.riskPolicy.minimumLiquidReserveBps !== expectedRisk.minimumLiquidReserveBps
    || refreshed.riskPolicy.maximumTotalDeployed !== expectedRisk.maximumTotalDeployed) {
    throw new Error('Core risk policy readback does not match the confirmed policy state.');
  }
  if (refreshed.bucketPolicy.liquidOperationalReserveBps !== expectedBucket.liquidOperationalReserveBps
    || refreshed.bucketPolicy.yieldStrategyBufferBps !== expectedBucket.yieldStrategyBufferBps
    || refreshed.bucketPolicy.sweepLiquidityBufferBps !== expectedBucket.sweepLiquidityBufferBps
    || refreshed.bucketPolicy.automationAgentPoolBps !== expectedBucket.automationAgentPoolBps) {
    throw new Error('Core bucket policy readback does not match the confirmed policy state.');
  }
  const withdrawalAction = confirmedActions.find((action) => action.functionName === 'setWithdrawalPolicy');
  if (withdrawalAction) {
    const expectedWithdrawal = withdrawalAction.isRiskIncreasing
      ? {
          maximumSingleWithdrawal: withdrawalAction.previousMaximumSingleWithdrawal,
          dailyOutflowCap: withdrawalAction.previousDailyOutflowCap,
        }
      : {
          maximumSingleWithdrawal: withdrawalAction.args[0],
          dailyOutflowCap: withdrawalAction.args[1],
        };
    if (!refreshed.withdrawalPolicy
      || refreshed.withdrawalPolicy.maximumSingleWithdrawal !== expectedWithdrawal.maximumSingleWithdrawal
      || refreshed.withdrawalPolicy.dailyOutflowCap !== expectedWithdrawal.dailyOutflowCap) {
      throw new Error('Core withdrawal policy readback does not match the confirmed policy state.');
    }
  }
}

export function isAuthorizedTreasuryAdminProjection(
  value: unknown,
  walletAddress: string | undefined,
  expectedCoreAddress: string | null,
): value is AdminProjection {
  const projection = asRecord(value);
  const authorization = asRecord(projection?.authorization);
  const policyAdmin = asRecord(authorization?.policyAdmin);
  return Boolean(projection
    && projection.scope === 'ADMIN'
    && projection.chainId === 5042
    && typeof projection.coreAddress === 'string'
    && projection.coreAddress.toLowerCase() === expectedCoreAddress?.toLowerCase()
    && typeof projection.authenticatedWalletAddress === 'string'
    && projection.authenticatedWalletAddress.toLowerCase() === walletAddress?.toLowerCase()
    && policyAdmin?.source === 'CORE'
    && policyAdmin.availability === 'AVAILABLE'
    && policyAdmin.value === true);
}

export function expectedAdminProjectionCoreAddress(
  configuredCoreAddress: string | null,
  isProduction = import.meta.env.PROD,
): string | null {
  if (configuredCoreAddress) return configuredCoreAddress;
  return isProduction ? null : APPROVED_ARC_MAINNET_CORE_ADDRESS;
}

function asRecord(value: unknown): AdminProjection | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as AdminProjection : null;
}

function projectionValue(section: unknown): bigint | string | number | null {
  const field = asRecord(section);
  const value = field?.availability === 'AVAILABLE' ? field.value : null;
  return typeof value === 'bigint' || typeof value === 'string' || typeof value === 'number' ? value : null;
}

function adminBalanceDescriptor(section: unknown, unavailableMessage: string): TokenBalanceDescriptor {
  const value = projectionValue(section);
  if (typeof value === 'string' || typeof value === 'bigint' || typeof value === 'number') {
    try {
      const amount = BigInt(value);
      return { symbol: 'USDC', decimals: 6, rawAmount: amount, formattedAmount: formatUSDC(amount), state: 'synced', message: 'Authorized Core value.' };
    } catch {
      // Invalid projection values stay unavailable.
    }
  }
  return { symbol: 'USDC', decimals: 6, rawAmount: null, formattedAmount: null, state: 'pending_integration', message: unavailableMessage };
}

const userTreasuryBalanceDescriptor: TokenBalanceDescriptor = {
  symbol: 'USDC',
  decimals: 6,
  rawAmount: null,
  formattedAmount: null,
  state: 'pending_integration',
  message: 'Treasury-wide balance is excluded from the user view.',
};

async function readWithdrawalPolicy(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  treasuryAddress: `0x${string}`,
): Promise<CoreWithdrawalPolicyState | null> {
  try {
    const [maximumSingleWithdrawal, dailyOutflowCap] = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
      publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'maximumSingleWithdrawal' }),
      publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'dailyOutflowCap' }),
    ]));
    return { maximumSingleWithdrawal, dailyOutflowCap };
  } catch {
    return null;
  }
}

export function useTreasurySummary() {
  const { address, chain, disconnect, isArcMainnet, isConnected } = useWalletStatus();
  const usdc = useUSDCBalance();
  const userProjection = useTreasuryUserProjection(isConnected, isArcMainnet, address);
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const treasuryAddress = getArcMainnetTreasuryAddress();
  const { writeContractAsync } = useWriteContract();
  const hasSavedLocalPolicy = useRef(hasSavedTreasuryPolicy());
  const adminProjectionQuery = useQuery({
    queryKey: ['treasury-authorized-admin-projection', address?.toLowerCase() ?? null],
    enabled: Boolean(isConnected && isArcMainnet && userProjection.isAuthenticated),
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<AdminProjection | null> => {
      const response = await fetch('/api/admin-projection', { headers: { accept: 'application/json' }, cache: 'no-store' });
      const payload = asRecord(await response.json().catch(() => null));
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok || !payload) throw new Error('Authorized Admin projection is temporarily unavailable.');
      if (!isAuthorizedTreasuryAdminProjection(
        payload,
        address,
        expectedAdminProjectionCoreAddress(treasuryAddress),
      )) {
        return null;
      }
      return payload;
    },
  });
  const [policy, setPolicy] = useState<TreasuryPolicyModel>(loadTreasuryPolicy);
  const [scheduledBucketPolicy, setScheduledBucketPolicy] = useState<PendingBucketPolicy | null>(null);
  const [verifiedBucketPolicy, setVerifiedBucketPolicy] = useState<CoreBucketPolicyState | null>(null);
  const [bucketPolicyExecutionStatus, setBucketPolicyExecutionStatus] = useState<string | null>(null);
  const [riskPolicyExecutionStatus, setRiskPolicyExecutionStatus] = useState<string | null>(null);

  const [modalState, setModalState] = useState<TreasuryModalState>({
    isDepositOpen: false,
    isWithdrawOpen: false,
    isRulesOpen: false,
    isEmergencyOpen: false,
  });

  const isPolicyAdmin = Boolean(userProjection.isAuthenticated && adminProjectionQuery.data);
  const timelockExecutorRoleQuery = useQuery({
    queryKey: ['treasury-timelock-executor-role', ARC_MAINNET_CHAIN_ID, treasuryAddress, address?.toLowerCase() ?? null],
    enabled: Boolean(isConnected && isArcMainnet && address && publicClient && treasuryAddress),
    staleTime: 10_000,
    retry: false,
    queryFn: async () => {
      if (!publicClient || !treasuryAddress || !address) return false;
      return withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
        address: treasuryAddress,
        abi: veloxTreasuryAbi,
        functionName: 'hasRole',
        args: [TIMELOCK_EXECUTOR_ROLE, address],
      }));
    },
  });
  const isTimelockExecutor = timelockExecutorRoleQuery.data === true;
  const pendingTimelockPolicyQuery = useQuery({
    queryKey: ['treasury-pending-executable-policies', ARC_MAINNET_CHAIN_ID, treasuryAddress],
    enabled: Boolean(isConnected && isArcMainnet && isTimelockExecutor && publicClient && treasuryAddress),
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<{
      readonly bucketPolicies: readonly PendingBucketPolicy[];
      readonly riskPolicies: readonly PendingRiskPolicy[];
      readonly withdrawalPolicies: readonly PendingWithdrawalPolicy[];
    }> => {
      if (!publicClient || !treasuryAddress) throw new Error('Configured Core is unavailable.');
      const chunkSize = resolveLogQueryChunkSize(import.meta.env.VITE_ARC_MAINNET_LOG_CHUNK_SIZE);
      const scheduledLogs = await withVerifiedArcMainnetPublicClient(publicClient, async () => {
        const toBlock = await publicClient.getBlockNumber();
        return readLogsInBlockChunks(0n, toBlock, (fromBlock, chunkToBlock) => publicClient.getContractEvents({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          eventName: 'TimelockScheduled',
          fromBlock,
          toBlock: chunkToBlock,
        }), chunkSize);
      });
      const scheduledEvidence: { readonly operationId: string; readonly kind: number; readonly eta: bigint }[] = [];
      for (const { args } of scheduledLogs) {
        if (args.kind !== BUCKET_POLICY_OPERATION_KIND
          && args.kind !== RISK_POLICY_OPERATION_KIND
          && args.kind !== WITHDRAWAL_POLICY_OPERATION_KIND) continue;
        if (!args.operationId || args.kind === undefined || args.eta === undefined) {
          throw new Error('Core returned incomplete TimelockScheduled event evidence.');
        }
        const evidence = {
          operationId: args.operationId,
          kind: Number(args.kind),
          eta: args.eta,
        };
        scheduledEvidence.push(evidence);
      }
      const uniqueScheduledEvidence = deduplicateScheduledOperationEvidence(scheduledEvidence);
      const readPendingOperation = async (operationId: string) => {
        const operation = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'pendingOperations',
          args: [operationId as `0x${string}`],
        }));
        return {
          kind: Number(operation[0]),
          eta: operation[1],
          value1: operation[5],
          value2: operation[6],
          bps: Number(operation[7]),
          bps2: Number(operation[8]),
          bps3: Number(operation[9]),
          bps4: Number(operation[10]),
        };
      };
      const [bucketPolicies, riskPolicies, withdrawalPolicies] = await Promise.all([
        discoverPendingBucketPolicyOperations(uniqueScheduledEvidence, readPendingOperation),
        discoverPendingRiskPolicyOperations(uniqueScheduledEvidence, readPendingOperation),
        discoverPendingWithdrawalPolicyOperations(uniqueScheduledEvidence, readPendingOperation),
      ]);
      return { bucketPolicies, riskPolicies, withdrawalPolicies };
    },
  });
  const pendingBucketPolicy = pendingTimelockPolicyQuery.data
    ? pendingTimelockPolicyQuery.data.bucketPolicies[0] ?? null
    : scheduledBucketPolicy;
  const policyCoreSupportQuery = useQuery({
    queryKey: ['treasury-core-policy-capabilities', ARC_MAINNET_CHAIN_ID, treasuryAddress],
    enabled: Boolean(isConnected && isArcMainnet && (isPolicyAdmin || isTimelockExecutor) && publicClient && treasuryAddress),
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      if (!publicClient || !treasuryAddress) throw new Error('Configured Core is unavailable.');
      const [delay, , , , freshness, withdrawalPolicy] = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
        publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'TIMELOCK_DELAY' }),
        publicClient.readContract({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'pendingOperations',
          args: [`0x${'00'.repeat(32)}`],
        }),
        publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'riskPolicy' }),
        publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'bucketPolicy' }),
        publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'valuationFreshnessBlocks' }),
        readWithdrawalPolicy(publicClient, treasuryAddress),
      ]));
      return {
        timelockDelaySeconds: delay,
        valuationFreshnessBlocks: freshness,
        withdrawalPolicy,
        supported: delay === 2n * 24n * 60n * 60n && freshness > 0n,
      };
    },
  });
  const isPolicyCoreSupported = policyCoreSupportQuery.data?.supported === true;
  const adminTreasury = asRecord(adminProjectionQuery.data?.treasury);
  const summary: TreasurySummary = useMemo(() => {
    const baseSummary = getTreasurySummary(
      {
        isConnected,
        isArcMainnet,
        address,
        chainName: chain?.name ?? (chain?.id ? `Chain ${chain.id}` : undefined),
      },
      userTreasuryBalanceDescriptor,
      policy,
    );
    if (!isPolicyAdmin || !adminTreasury) return baseSummary;
    return {
      ...baseSummary,
      balances: {
        total: adminBalanceDescriptor(adminTreasury.liquidUSDC, 'Treasury-held USDC is unavailable from Core.'),
        available: adminBalanceDescriptor(adminTreasury.availableLiquidity, 'Available Treasury liquidity is unavailable from Core.'),
        allocated: adminBalanceDescriptor(asRecord(adminTreasury.allocatedBalance), 'Aggregate allocated balance is unavailable from Core.'),
      },
    };
  }, [isConnected, isArcMainnet, address, chain, policy, isPolicyAdmin, adminTreasury]);

  const openDepositModal = () => setModalState((prev) => ({ ...prev, isDepositOpen: true }));
  const closeDepositModal = () => setModalState((prev) => ({ ...prev, isDepositOpen: false }));

  const openWithdrawModal = () => setModalState((prev) => ({ ...prev, isWithdrawOpen: true }));
  const closeWithdrawModal = () => setModalState((prev) => ({ ...prev, isWithdrawOpen: false }));

  const openRulesModal = () => setModalState((prev) => ({ ...prev, isRulesOpen: true }));
  const closeRulesModal = useCallback(() => setModalState((prev) => prev.isRulesOpen
    ? { ...prev, isRulesOpen: false }
    : prev), []);

  const openEmergencyModal = () => setModalState((prev) => ({ ...prev, isEmergencyOpen: true }));
  const closeEmergencyModal = useCallback(() => setModalState((prev) => prev.isEmergencyOpen
    ? { ...prev, isEmergencyOpen: false }
    : prev), []);
  const refreshFinancialState = useCallback(async () => {
    await Promise.all([
      usdc.refetch(),
      userProjection.refetch(),
    ]);
  }, [usdc.refetch, userProjection.refetch]);

  const adminRiskPolicy = asRecord(adminProjectionQuery.data?.riskPolicy);
  const adminBucketPolicy = asRecord(adminProjectionQuery.data?.bucketPolicy);
  useEffect(() => {
    if (hasSavedLocalPolicy.current || !isPolicyAdmin || modalState.isRulesOpen || !adminBucketPolicy) return;
    const toBps = (value: bigint | string | number | null): number | null => {
      if (value === null) return null;
      try {
        const parsed = BigInt(value);
        return parsed >= 0n && parsed <= 10_000n ? Number(parsed) : null;
      } catch {
        return null;
      }
    };
    const liquidOperationalReserveBps = toBps(projectionValue(adminBucketPolicy.liquidOperationalReserveBps));
    const yieldStrategyBufferBps = toBps(projectionValue(adminBucketPolicy.yieldStrategyBufferBps));
    const sweepLiquidityBufferBps = toBps(projectionValue(adminBucketPolicy.sweepLiquidityBufferBps));
    const automationAgentPoolBps = toBps(projectionValue(adminBucketPolicy.automationAgentPoolBps));
    if (
      liquidOperationalReserveBps === null
      || yieldStrategyBufferBps === null
      || sweepLiquidityBufferBps === null
      || automationAgentPoolBps === null
    ) return;
    const authoritativeBucket = {
      liquidOperationalReserveBps,
      yieldStrategyBufferBps,
      sweepLiquidityBufferBps,
      automationAgentPoolBps,
    };
    setPolicy((current) => {
      const hydratedPolicy = withAuthoritativeBucketPolicy(current, authoritativeBucket);
      if (!hydratedPolicy) return current;
      const allocations = hydratedPolicy.allocations;
      return current.allocations.operational_reserve === allocations.operational_reserve
        && current.allocations.yield_strategy === allocations.yield_strategy
        && current.allocations.swap_liquidity === allocations.swap_liquidity
        && current.allocations.automation_agent === allocations.automation_agent
        ? current
        : { ...current, allocations };
    });
  }, [adminBucketPolicy, isPolicyAdmin, modalState.isRulesOpen]);

  const updateOnChainPolicy = useCallback(async (nextPolicy: TreasuryCorePolicyDraft) => {
    const treasuryAddress = getArcMainnetTreasuryAddress();
    if (!treasuryAddress) throw new Error('Treasury is not configured on Arc Mainnet');
    if (!isConnected || !isArcMainnet) throw new Error('Connect the POLICY_ADMIN wallet on Arc Mainnet.');
    if (!isPolicyAdmin) throw new Error('Connected wallet is not the Treasury POLICY_ADMIN.');
    if (!publicClient) throw new Error('Arc Mainnet public client is unavailable.');
    if (!isPolicyCoreSupported) throw new Error('The configured Core does not expose the supported two-day policy timelock interface.');
    const fixedPolicyReadback = policyCoreSupportQuery.data;
    if (!fixedPolicyReadback) throw new Error('Fixed Core policy readback is unavailable.');
    if (nextPolicy.timelockDelaySeconds !== fixedPolicyReadback.timelockDelaySeconds
      || nextPolicy.valuationFreshnessBlocks !== fixedPolicyReadback.valuationFreshnessBlocks) {
      throw new Error('Timelock delay and valuation freshness must match authoritative, fixed Core readback values.');
    }

    const [timelockDelay, , freshness] = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
      publicClient.readContract({
        address: treasuryAddress,
        abi: veloxTreasuryAbi,
        functionName: 'TIMELOCK_DELAY',
      }),
      publicClient.readContract({
        address: treasuryAddress,
        abi: veloxTreasuryAbi,
        functionName: 'pendingOperations',
        args: [`0x${'00'.repeat(32)}`],
      }),
      publicClient.readContract({
        address: treasuryAddress,
        abi: veloxTreasuryAbi,
        functionName: 'valuationFreshnessBlocks',
      }),
    ]));
    if (timelockDelay !== 2n * 24n * 60n * 60n) throw new Error('Core timelock delay is not the required two days.');
    if (freshness === 0n || freshness !== nextPolicy.valuationFreshnessBlocks) {
      throw new Error('Valuation freshness must match the current nonzero authoritative Core value.');
    }

    const [currentRisk, currentBucket, currentWithdrawalPolicy] = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
      publicClient.readContract({
        address: treasuryAddress,
        abi: veloxTreasuryAbi,
        functionName: 'riskPolicy',
      }),
      publicClient.readContract({
        address: treasuryAddress,
        abi: veloxTreasuryAbi,
        functionName: 'bucketPolicy',
      }),
      readWithdrawalPolicy(publicClient, treasuryAddress),
    ]));

    const plan = buildPolicyMutationPlan(nextPolicy, currentRisk, currentBucket, currentWithdrawalPolicy);
    const result = await submitAndVerifyPolicyMutationPlan(plan, nextPolicy, currentRisk, currentBucket, {
      submit: (action) => writeContractAsync({
        address: treasuryAddress,
        abi: veloxTreasuryAbi,
        functionName: action.functionName,
        args: action.args as never,
        chainId: ARC_MAINNET_CHAIN_ID,
      }),
      waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(
        publicClient,
        () => publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` }),
      ),
      findScheduledOperation: (receipt, action) => {
        const expectedKind = action.functionName === 'scheduleRiskPolicy' ? 0
          : action.functionName === 'scheduleBucketPolicy' ? 4 : 5;
        const coreLogs = receipt.logs.filter((log) => typeof log === 'object'
          && log !== null
          && 'address' in log
          && typeof log.address === 'string'
          && log.address.toLowerCase() === treasuryAddress.toLowerCase());
        const event = parseEventLogs({
          abi: veloxTreasuryAbi,
          logs: coreLogs as never,
          eventName: 'TimelockScheduled',
        }).find((entry) => Number(entry.args.kind) === expectedKind);
        if (!event) throw new Error(`${action.functionName} receipt did not contain a Core TimelockScheduled event.`);
        return event.args.operationId;
      },
      readPendingOperation: async (operationId) => {
        const operation = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'pendingOperations',
          args: [operationId as `0x${string}`],
        }));
        return {
          kind: Number(operation[0]),
          eta: operation[1],
          value1: operation[5],
          value2: operation[6],
          bps: operation[7],
          bps2: operation[8],
          bps3: operation[9],
          bps4: operation[10],
        };
      },
      readPolicies: async () => {
        const [riskPolicy, bucketPolicy, withdrawalPolicy] = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
          publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'riskPolicy' }),
          publicClient.readContract({ address: treasuryAddress, abi: veloxTreasuryAbi, functionName: 'bucketPolicy' }),
          readWithdrawalPolicy(publicClient, treasuryAddress),
        ]));
        return { riskPolicy, bucketPolicy, withdrawalPolicy };
      },
    });
    const scheduledBucketPolicy = result.pendingOperations.find((operation) => operation.kind === 'BucketPolicy' && operation.bucketPolicy);
    if (scheduledBucketPolicy?.bucketPolicy) {
      setScheduledBucketPolicy({
        operationId: scheduledBucketPolicy.operationId,
        eta: scheduledBucketPolicy.eta,
        policy: scheduledBucketPolicy.bucketPolicy,
      });
      setBucketPolicyExecutionStatus(null);
    }
    await pendingTimelockPolicyQuery.refetch();
    await Promise.all([adminProjectionQuery.refetch(), userProjection.refetch()]);
    return result;
  }, [adminProjectionQuery.refetch, isArcMainnet, isConnected, isPolicyAdmin, isPolicyCoreSupported, pendingTimelockPolicyQuery.refetch, policyCoreSupportQuery.data, publicClient, userProjection.refetch, writeContractAsync]);

  const executePendingBucketPolicy = useCallback(async () => {
    const treasuryAddress = getArcMainnetTreasuryAddress();
    if (!treasuryAddress) throw new Error('Treasury is not configured on Arc Mainnet');
    if (!isConnected || !isArcMainnet) throw new Error('Connect the TIMELOCK_EXECUTOR wallet on Arc Mainnet.');
    if (!address || !isTimelockExecutor) throw new Error('Connected wallet is not the Treasury TIMELOCK_EXECUTOR.');
    if (!publicClient) throw new Error('Arc Mainnet public client is unavailable.');
    if (!pendingBucketPolicy) throw new Error('There is no verified pending BucketPolicy operation to execute.');

    setBucketPolicyExecutionStatus('Executing pending BucketPolicy operation.');
    try {
      const appliedPolicy = await executeAndVerifyBucketPolicy(pendingBucketPolicy, {
        isTimelockExecutor: async () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [TIMELOCK_EXECUTOR_ROLE, address],
        })),
        readPendingOperation: async (operationId) => {
          const operation = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'pendingOperations',
            args: [operationId as `0x${string}`],
          }));
          return {
            kind: Number(operation[0]),
            eta: operation[1],
            value1: operation[5],
            value2: operation[6],
            bps: Number(operation[7]),
            bps2: Number(operation[8]),
            bps3: Number(operation[9]),
            bps4: Number(operation[10]),
          };
        },
        getCurrentTimestamp: async () => withVerifiedArcMainnetPublicClient(
          publicClient,
          async () => (await publicClient.getBlock({ blockTag: 'latest' })).timestamp,
        ),
        submit: (operationId) => writeContractAsync({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'executeBucketPolicy',
          args: [operationId as `0x${string}`],
          chainId: ARC_MAINNET_CHAIN_ID,
        }),
        waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(
          publicClient,
          () => publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` }),
        ),
        readBucketPolicy: async () => {
          const bucketPolicy = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'bucketPolicy',
          }));
          return {
            liquidOperationalReserveBps: Number(bucketPolicy.liquidOperationalReserveBps),
            yieldStrategyBufferBps: Number(bucketPolicy.yieldStrategyBufferBps),
            sweepLiquidityBufferBps: Number(bucketPolicy.sweepLiquidityBufferBps),
            automationAgentPoolBps: Number(bucketPolicy.automationAgentPoolBps),
          };
        },
      });
      setVerifiedBucketPolicy(appliedPolicy);
      setScheduledBucketPolicy(null);
      setBucketPolicyExecutionStatus('BucketPolicy execution confirmed by receipt and exact Core readback.');
      await Promise.all([
        pendingTimelockPolicyQuery.refetch(),
        adminProjectionQuery.refetch(),
        userProjection.refetch(),
      ]);
      return appliedPolicy;
    } catch (error) {
      setBucketPolicyExecutionStatus(error instanceof Error ? error.message : 'BucketPolicy execution failed.');
      throw error;
    }
  }, [address, adminProjectionQuery.refetch, isArcMainnet, isConnected, isTimelockExecutor, pendingBucketPolicy, pendingTimelockPolicyQuery.refetch, publicClient, userProjection.refetch, writeContractAsync]);

  const executePendingScheduledPolicy = useCallback(async (
    pending: PendingRiskPolicy | PendingWithdrawalPolicy,
  ) => {
    const treasuryAddress = getArcMainnetTreasuryAddress();
    if (!treasuryAddress) throw new Error('Treasury is not configured on Arc Mainnet.');
    if (!isConnected || !isArcMainnet) throw new Error('Connect the TIMELOCK_EXECUTOR wallet on Arc Mainnet.');
    if (!address || !isTimelockExecutor) throw new Error('Connected wallet is not the Treasury TIMELOCK_EXECUTOR.');
    if (!publicClient) throw new Error('Arc Mainnet public client is unavailable.');

    const isRiskPolicy = 'minimumLiquidReserve' in pending.policy;
    const policyLabel = isRiskPolicy ? 'Risk' : 'Withdrawal';
    setRiskPolicyExecutionStatus(`Executing ${policyLabel} Policy operation ${pending.operationId}.`);
    try {
      const appliedPolicy = await executeAndVerifyScheduledPolicy(pending, {
        isTimelockExecutor: async () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [TIMELOCK_EXECUTOR_ROLE, address],
        })),
        readPendingOperation: async (operationId) => {
          const operation = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'pendingOperations',
            args: [operationId as `0x${string}`],
          }));
          return {
            kind: Number(operation[0]),
            eta: operation[1],
            value1: operation[5],
            value2: operation[6],
            bps: Number(operation[7]),
            bps2: Number(operation[8]),
            bps3: Number(operation[9]),
            bps4: Number(operation[10]),
          };
        },
        getCurrentTimestamp: async () => withVerifiedArcMainnetPublicClient(
          publicClient,
          async () => (await publicClient.getBlock({ blockTag: 'latest' })).timestamp,
        ),
        submit: (operationId) => writeContractAsync({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'executeRiskPolicy',
          args: [operationId as `0x${string}`],
          chainId: ARC_MAINNET_CHAIN_ID,
        }),
        waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(
          publicClient,
          () => publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` }),
        ),
        readRiskPolicy: async () => {
          const riskPolicy = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'riskPolicy',
          }));
          return {
            minimumLiquidReserve: riskPolicy.minimumLiquidReserve,
            minimumLiquidReserveBps: riskPolicy.minimumLiquidReserveBps,
            maximumTotalDeployed: riskPolicy.maximumTotalDeployed,
          };
        },
        readWithdrawalPolicy: async () => {
          const [maximumSingleWithdrawal, dailyOutflowCap] = await withVerifiedArcMainnetPublicClient(
            publicClient,
            () => Promise.all([
              publicClient.readContract({
                address: treasuryAddress,
                abi: veloxTreasuryAbi,
                functionName: 'maximumSingleWithdrawal',
              }),
              publicClient.readContract({
                address: treasuryAddress,
                abi: veloxTreasuryAbi,
                functionName: 'dailyOutflowCap',
              }),
            ]),
          );
          return { maximumSingleWithdrawal, dailyOutflowCap };
        },
      });
      setRiskPolicyExecutionStatus(`${policyLabel} Policy operation ${pending.operationId} executed and verified by Core readback.`);
      await Promise.all([
        pendingTimelockPolicyQuery.refetch(),
        adminProjectionQuery.refetch(),
        userProjection.refetch(),
      ]);
      return appliedPolicy;
    } catch (error) {
      setRiskPolicyExecutionStatus(error instanceof Error ? error.message : `${policyLabel} Policy execution failed.`);
      throw error;
    }
  }, [address, adminProjectionQuery.refetch, isArcMainnet, isConnected, isTimelockExecutor, pendingTimelockPolicyQuery.refetch, publicClient, userProjection.refetch, writeContractAsync]);

  const executePendingRiskPolicy = useCallback((pending: PendingRiskPolicy) => (
    executePendingScheduledPolicy(pending)
  ), [executePendingScheduledPolicy]);

  const executePendingWithdrawalPolicy = useCallback((pending: PendingWithdrawalPolicy) => (
    executePendingScheduledPolicy(pending)
  ), [executePendingScheduledPolicy]);

  const updateOnChainAllocations = useCallback(async (nextPolicy: TreasuryCorePolicyDraft) => {
    return updateOnChainPolicy(nextPolicy);
  }, [updateOnChainPolicy]);

  const onChainPolicy = isPolicyAdmin ? {
    isPolicyAdmin: true as const,
    canSelfWithdraw: userProjection.canSelfWithdraw,
    coreState: null,
    policy: {
      minimumLiquidReserve: projectionValue(adminRiskPolicy?.minimumLiquidReserve),
      minimumLiquidReserveBps: projectionValue(adminRiskPolicy?.minimumLiquidReserveBps),
      maximumTotalDeployed: projectionValue(adminRiskPolicy?.maximumTotalDeployed),
      maximumSingleWithdrawal: policyCoreSupportQuery.data?.withdrawalPolicy?.maximumSingleWithdrawal ?? null,
      dailyOutflowCap: policyCoreSupportQuery.data?.withdrawalPolicy?.dailyOutflowCap ?? null,
      timelockDelaySeconds: policyCoreSupportQuery.data?.timelockDelaySeconds ?? null,
      valuationFreshnessBlocks: policyCoreSupportQuery.data?.valuationFreshnessBlocks ?? null,
      bucketPolicy: {
        liquidOperationalReserveBps: projectionValue(adminBucketPolicy?.liquidOperationalReserveBps),
        yieldStrategyBufferBps: projectionValue(adminBucketPolicy?.yieldStrategyBufferBps),
        sweepLiquidityBufferBps: projectionValue(adminBucketPolicy?.sweepLiquidityBufferBps),
        automationAgentPoolBps: projectionValue(adminBucketPolicy?.automationAgentPoolBps),
      },
    },
    bucketPolicy: {
      liquidOperationalReserveBps: projectionValue(adminBucketPolicy?.liquidOperationalReserveBps),
      yieldStrategyBufferBps: projectionValue(adminBucketPolicy?.yieldStrategyBufferBps),
      sweepLiquidityBufferBps: projectionValue(adminBucketPolicy?.sweepLiquidityBufferBps),
      automationAgentPoolBps: projectionValue(adminBucketPolicy?.automationAgentPoolBps),
    },
  } : userProjection.projection ? {
    isPolicyAdmin: false as const,
    canSelfWithdraw: userProjection.canSelfWithdraw,
    coreState: null,
    bucketPolicy: null,
    policy: null,
  } : null;

  return {
    summary,
    modalState,
    disconnect,
    openDepositModal,
    closeDepositModal,
    openWithdrawModal,
    closeWithdrawModal,
    openRulesModal,
    closeRulesModal,
    openEmergencyModal,
    closeEmergencyModal,
    refetchTreasuryBalance: undefined,
    refetchWalletBalance: usdc.refetch,
    refreshBalances: async () => { await usdc.refetch(); await userProjection.refetch(); },
    refreshFinancialState,
    isRefreshingBalance: usdc.isLoading,
    walletUsdc: usdc.descriptor,
    treasuryAddress: getArcMainnetTreasuryAddress(),
    onChainPolicy,
    adminProjection: isPolicyAdmin ? adminProjectionQuery.data ?? null : null,
    adminProjectionLoading: userProjection.isAuthenticated && adminProjectionQuery.isLoading,
    userProjection: userProjection.projection,
    userProjectionLoading: userProjection.isLoading,
    userProjectionError: userProjection.error,
    userAuthenticationLoading: userProjection.isAuthenticationLoading,
    isUserAuthenticated: userProjection.isAuthenticated,
    userAuthenticationError: userProjection.authenticationError,
    isPolicyAdmin,
    isTimelockExecutor,
    pendingBucketPolicy,
    verifiedBucketPolicy,
    bucketPolicyExecutionStatus,
    executePendingBucketPolicy,
    pendingRiskPolicies: pendingTimelockPolicyQuery.data?.riskPolicies ?? [],
    pendingWithdrawalPolicies: pendingTimelockPolicyQuery.data?.withdrawalPolicies ?? [],
    pendingScheduledPoliciesLoading: pendingTimelockPolicyQuery.isLoading,
    scheduledPolicyDiscoveryError: pendingTimelockPolicyQuery.error instanceof Error ? pendingTimelockPolicyQuery.error : null,
    riskPolicyExecutionStatus,
    executePendingRiskPolicy,
    executePendingWithdrawalPolicy,
    isPolicyCoreSupported,
    policyCoreSupportLoading: policyCoreSupportQuery.isLoading,
    policyCoreSupportError: policyCoreSupportQuery.error,
    canSelfWithdraw: userProjection.canSelfWithdraw,
    policyContractError: userProjection.error ?? (isPolicyAdmin ? adminProjectionQuery.error : null),
    refetchOnChainPolicy: userProjection.refetch,
    updateOnChainPolicy,
    updateOnChainAllocations,
    policy,
  };
}
