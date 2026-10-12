import { describe, expect, it, vi } from 'vitest';

import {
  buildPolicyMutationPlan,
  executeAndVerifyBucketPolicy,
  discoverPendingBucketPolicyOperations,
  discoverPendingRiskPolicyOperations,
  discoverPendingWithdrawalPolicyOperations,
  executeAndVerifyRiskPolicy,
  executeAndVerifyScheduledPolicy,
  expectedAdminProjectionCoreAddress,
  isAuthorizedTreasuryAdminProjection,
  submitAndVerifyPolicyMutationPlan,
  withAuthoritativeBucketPolicy,
} from './useTreasurySummary';
import { createDefaultPolicy } from '../services/policyService';

const defaultPolicy = {
  minimumLiquidReserve: 50_000_000n,
  minimumLiquidReserveBps: 5_000,
  maximumTotalDeployed: 1_000_000_000n,
  timelockDelaySeconds: 172_800n,
  valuationFreshnessBlocks: 100n,
  surplusSweepThreshold: 100_000_000n,
  automatedSweepEnabled: false,
  allocations: {
    operational_reserve: 5_000n,
    yield_strategy: 3_000n,
    swap_liquidity: 1_000n,
    automation_agent: 1_000n,
  },
};

const defaultRisk = {
  minimumLiquidReserve: 50_000_000n,
  minimumLiquidReserveBps: 5_000,
  maximumTotalDeployed: 1_000_000_000n,
};

const defaultBucket = {
  liquidOperationalReserveBps: 5_000,
  yieldStrategyBufferBps: 3_000,
  sweepLiquidityBufferBps: 1_000,
  automationAgentPoolBps: 1_000,
};
const defaultWithdrawalPolicy = {
  maximumSingleWithdrawal: 50_000_000n,
  dailyOutflowCap: 150_000_000n,
};
const coreAddress = '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';

describe('Risk Policy execution', () => {
  const pending = {
    operationId: `0x${'34'.repeat(32)}`,
    eta: 234_567n,
    policy: defaultRisk,
  };
  const operation = {
    kind: 0,
    eta: pending.eta,
    value1: pending.policy.minimumLiquidReserve,
    value2: pending.policy.maximumTotalDeployed,
    bps: pending.policy.minimumLiquidReserveBps,
    bps2: 0,
    bps3: 0,
    bps4: 0,
  };

  it('discovers Risk Policy operation IDs from scheduled event evidence and verifies pending getter payloads', async () => {
    const readPendingOperation = vi.fn(async () => operation);
    const discovered = await discoverPendingRiskPolicyOperations([
      { operationId: pending.operationId, kind: 0, eta: pending.eta },
      { operationId: `0x${'56'.repeat(32)}`, kind: 4, eta: 345_678n },
    ], readPendingOperation);

    expect(discovered).toEqual([pending]);
    expect(readPendingOperation).toHaveBeenCalledExactlyOnceWith(pending.operationId);
  });

  it('rejects scheduled evidence whose ETA does not match the Core pending operation', async () => {
    await expect(discoverPendingRiskPolicyOperations([
      { operationId: pending.operationId, kind: 0, eta: pending.eta + 1n },
    ], async () => operation)).rejects.toThrow('TimelockScheduled evidence');
  });

  it('checks executor role and exact pending payload before submitting and verifies active Core readback after receipt', async () => {
    const steps: string[] = [];
    const result = await executeAndVerifyRiskPolicy(pending, {
      isTimelockExecutor: async () => { steps.push('role'); return true; },
      readPendingOperation: async (operationId) => {
        steps.push('pending');
        expect(operationId).toBe(pending.operationId);
        return operation;
      },
      submit: async (operationId) => {
        steps.push('submit');
        expect(operationId).toBe(pending.operationId);
        return '0xtransaction';
      },
      waitForReceipt: async (hash) => {
        steps.push('receipt');
        expect(hash).toBe('0xtransaction');
        return { status: 'success' };
      },
      readRiskPolicy: async () => { steps.push('readback'); return pending.policy; },
    });

    expect(result).toEqual(pending.policy);
    expect(steps).toEqual(['role', 'pending', 'submit', 'receipt', 'readback']);
  });

  it('does not submit for a wallet without TIMELOCK_EXECUTOR_ROLE', async () => {
    const submit = vi.fn(async () => '0xtransaction');
    await expect(executeAndVerifyRiskPolicy(pending, {
      isTimelockExecutor: async () => false,
      readPendingOperation: async () => operation,
      submit,
      waitForReceipt: async () => ({ status: 'success' }),
      readRiskPolicy: async () => pending.policy,
    })).rejects.toThrow('TIMELOCK_EXECUTOR');
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not submit when the pending payload differs from the discovered operation', async () => {
    const submit = vi.fn(async () => '0xtransaction');
    await expect(executeAndVerifyRiskPolicy(pending, {
      isTimelockExecutor: async () => true,
      readPendingOperation: async () => ({ ...operation, value2: operation.value2 + 1n }),
      submit,
      waitForReceipt: async () => ({ status: 'success' }),
      readRiskPolicy: async () => pending.policy,
    })).rejects.toThrow('no longer matches');
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not report success for a failed transaction receipt', async () => {
    const readRiskPolicy = vi.fn(async () => pending.policy);
    await expect(executeAndVerifyRiskPolicy(pending, {
      isTimelockExecutor: async () => true,
      readPendingOperation: async () => operation,
      submit: async () => '0xtransaction',
      waitForReceipt: async () => ({ status: 'reverted' }),
      readRiskPolicy,
    })).rejects.toThrow('failed or was reverted');
    expect(readRiskPolicy).not.toHaveBeenCalled();
  });

  it('does not report success unless all active Risk Policy fields exactly match', async () => {
    await expect(executeAndVerifyRiskPolicy(pending, {
      isTimelockExecutor: async () => true,
      readPendingOperation: async () => operation,
      submit: async () => '0xtransaction',
      waitForReceipt: async () => ({ status: 'success' }),
      readRiskPolicy: async () => ({ ...pending.policy, maximumTotalDeployed: pending.policy.maximumTotalDeployed - 1n }),
    })).rejects.toThrow('does not match the executed operation');
  });
});

describe('Withdrawal Policy execution through executeRiskPolicy', () => {
  const pending = {
    operationId: `0x${'78'.repeat(32)}`,
    eta: 345_678n,
    policy: defaultWithdrawalPolicy,
  };
  const operation = {
    kind: 5,
    eta: pending.eta,
    value1: pending.policy.maximumSingleWithdrawal,
    value2: pending.policy.dailyOutflowCap,
    bps: 0,
    bps2: 0,
    bps3: 0,
    bps4: 0,
  };
  const ports = (overrides: Partial<Parameters<typeof executeAndVerifyScheduledPolicy>[1]> = {}) => ({
    isTimelockExecutor: async () => true,
    readPendingOperation: async () => operation,
    getCurrentTimestamp: async () => pending.eta,
    submit: async (operationId: string) => {
      expect(operationId).toBe(pending.operationId);
      return '0xtransaction';
    },
    waitForReceipt: async () => ({ status: 'success' }),
    readRiskPolicy: async () => defaultRisk,
    readWithdrawalPolicy: async () => pending.policy,
    ...overrides,
  });

  it('discovers Withdrawal Policy operations from event evidence and verifies Core pending payloads', async () => {
    const readPending = vi.fn(async () => operation);
    const discovered = await discoverPendingWithdrawalPolicyOperations([
      { operationId: pending.operationId, kind: 5, eta: pending.eta },
      { operationId: `0x${'90'.repeat(32)}`, kind: 0, eta: 456_789n },
    ], readPending);
    expect(discovered).toEqual([pending]);
    expect(readPending).toHaveBeenCalledExactlyOnceWith(pending.operationId);
  });

  it('rejects operation kinds and scheduled evidence that do not identify a pending Withdrawal Policy', async () => {
    await expect(discoverPendingWithdrawalPolicyOperations([
      { operationId: pending.operationId, kind: 5, eta: pending.eta },
    ], async () => ({ ...operation, kind: 0 }))).rejects.toThrow('does not match the Withdrawal Policy event');

    await expect(discoverPendingWithdrawalPolicyOperations([
      { operationId: pending.operationId, kind: 5, eta: pending.eta + 1n },
    ], async () => operation)).rejects.toThrow('TimelockScheduled evidence');
  });

  it('checks executor authorization, pending payload and satisfied ETA before calling executeRiskPolicy', async () => {
    const steps: string[] = [];
    const result = await executeAndVerifyScheduledPolicy(pending, ports({
      isTimelockExecutor: async () => { steps.push('role'); return true; },
      readPendingOperation: async () => { steps.push('pending'); return operation; },
      getCurrentTimestamp: async () => { steps.push('timestamp'); return pending.eta; },
      submit: async (operationId) => {
        steps.push('executeRiskPolicy');
        expect(operationId).toBe(pending.operationId);
        return '0xtransaction';
      },
      waitForReceipt: async () => { steps.push('receipt'); return { status: 'success' }; },
      readWithdrawalPolicy: async () => { steps.push('readback'); return pending.policy; },
    }));
    expect(result).toEqual(pending.policy);
    expect(steps).toEqual(['role', 'pending', 'timestamp', 'executeRiskPolicy', 'receipt', 'readback']);
  });

  it('does not submit for an unauthorized executor or when the Withdrawal Policy kind/payload is invalid', async () => {
    const submit = vi.fn(async () => '0xtransaction');
    await expect(executeAndVerifyScheduledPolicy(pending, ports({
      isTimelockExecutor: async () => false,
      submit,
    }))).rejects.toThrow('TIMELOCK_EXECUTOR');
    expect(submit).not.toHaveBeenCalled();

    await expect(executeAndVerifyScheduledPolicy(pending, ports({
      readPendingOperation: async () => ({ ...operation, kind: 0 }),
    }))).rejects.toThrow('no longer matches');
    await expect(executeAndVerifyScheduledPolicy(pending, ports({
      readPendingOperation: async () => ({ ...operation, value2: operation.value2 + 1n }),
    }))).rejects.toThrow('no longer matches');
  });

  it('rejects an unconsumed operation whose ETA has not been reached', async () => {
    const submit = vi.fn(async () => '0xtransaction');
    await expect(executeAndVerifyScheduledPolicy(pending, ports({
      getCurrentTimestamp: async () => pending.eta - 1n,
      submit,
    }))).rejects.toThrow('ETA has not been reached');
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not report success on receipt failure or mismatched active Withdrawal Policy readback', async () => {
    const readWithdrawalPolicy = vi.fn(async () => pending.policy);
    await expect(executeAndVerifyScheduledPolicy(pending, ports({
      waitForReceipt: async () => ({ status: 'reverted' }),
      readWithdrawalPolicy,
    }))).rejects.toThrow('failed or was reverted');
    expect(readWithdrawalPolicy).not.toHaveBeenCalled();

    await expect(executeAndVerifyScheduledPolicy(pending, ports({
      readWithdrawalPolicy: async () => ({ ...pending.policy, dailyOutflowCap: pending.policy.dailyOutflowCap - 1n }),
    }))).rejects.toThrow('Withdrawal Policy readback does not match');
  });
});

describe('buildPolicyMutationPlan', () => {
  it('schedules a risk increase when reducing the reserve floor and preserves other current risk parameters', () => {
    const plan = buildPolicyMutationPlan(
      {
        ...defaultPolicy,
        minimumLiquidReserve: 25_000_000n,
      },
      {
        minimumLiquidReserve: 50_000_000n,
        minimumLiquidReserveBps: 5_000,
        maximumTotalDeployed: 1_000_000_000n,
      },
      {
        liquidOperationalReserveBps: 5_000,
        yieldStrategyBufferBps: 2_500,
        sweepLiquidityBufferBps: 1_250,
        automationAgentPoolBps: 1_250,
      },
    );

    expect(plan.actions).toEqual([
      {
        functionName: 'scheduleRiskPolicy',
        args: [25_000_000n, 5_000, 1_000_000_000n],
      },
      {
        functionName: 'scheduleBucketPolicy',
        args: [{
          liquidOperationalReserveBps: 5_000,
          yieldStrategyBufferBps: 3_000,
          sweepLiquidityBufferBps: 1_000,
          automationAgentPoolBps: 1_000,
        }],
      },
    ]);
  });

  describe('executeAndVerifyBucketPolicy', () => {
    const pending = {
      operationId: `0x${'12'.repeat(32)}`,
      eta: 123_456n,
      policy: {
        liquidOperationalReserveBps: 3_000,
        yieldStrategyBufferBps: 5_000,
        sweepLiquidityBufferBps: 1_000,
        automationAgentPoolBps: 1_000,
      },
    };

    it('passes the verified operation ID and reports success only after receipt and exact Core readback', async () => {
      const steps: string[] = [];
      const result = await executeAndVerifyBucketPolicy(pending, {
        isTimelockExecutor: async () => { steps.push('role'); return true; },
        getCurrentTimestamp: async () => pending.eta,
        readPendingOperation: async (operationId) => {
          steps.push('pending');
          expect(operationId).toBe(pending.operationId);
          return { kind: 4, eta: pending.eta, value1: 0n, value2: 0n, bps: 3_000, bps2: 5_000, bps3: 1_000, bps4: 1_000 };
        },
        submit: async (operationId) => {
          steps.push('submit');
          expect(operationId).toBe(pending.operationId);
          return '0xtransaction';
        },
        waitForReceipt: async (hash) => {
          steps.push('receipt');
          expect(hash).toBe('0xtransaction');
          return { status: 'success' };
        },
        readBucketPolicy: async () => { steps.push('readback'); return pending.policy; },
      });

      expect(result).toEqual(pending.policy);
      expect(steps).toEqual(['role', 'pending', 'submit', 'receipt', 'readback']);
    });

    it('does not execute for an unauthorized wallet', async () => {
      const submit = vi.fn(async () => '0xtransaction');
      await expect(executeAndVerifyBucketPolicy(pending, {
        isTimelockExecutor: async () => false,
        readPendingOperation: async () => { throw new Error('Must not read operation.'); },
        submit,
        waitForReceipt: async () => ({ status: 'success' }),
        readBucketPolicy: async () => pending.policy,
      })).rejects.toThrow('TIMELOCK_EXECUTOR');
      expect(submit).not.toHaveBeenCalled();
    });

    it('does not report success if the Core bucket readback differs', async () => {
      await expect(executeAndVerifyBucketPolicy(pending, {
        isTimelockExecutor: async () => true,
        getCurrentTimestamp: async () => pending.eta,
        readPendingOperation: async () => ({ kind: 4, eta: pending.eta, value1: 0n, value2: 0n, bps: 3_000, bps2: 5_000, bps3: 1_000, bps4: 1_000 }),
        submit: async () => '0xtransaction',
        waitForReceipt: async () => ({ status: 'success' }),
        readBucketPolicy: async () => ({ ...pending.policy, automationAgentPoolBps: 999 }),
      })).rejects.toThrow('does not match the executed operation');
    });

    it('does not submit before the verified operation ETA', async () => {
      const submit = vi.fn(async () => '0xtransaction');
      await expect(executeAndVerifyBucketPolicy(pending, {
        isTimelockExecutor: async () => true,
        getCurrentTimestamp: async () => pending.eta - 1n,
        readPendingOperation: async () => ({ kind: 4, eta: pending.eta, value1: 0n, value2: 0n, bps: 3_000, bps2: 5_000, bps3: 1_000, bps4: 1_000 }),
        submit,
        waitForReceipt: async () => ({ status: 'success' }),
        readBucketPolicy: async () => pending.policy,
      })).rejects.toThrow('ETA has not been reached');
      expect(submit).not.toHaveBeenCalled();
    });

    it('discovers a pending Bucket Policy operation from fresh scheduled-event evidence and verifies the full getter payload', async () => {
      const operationId = pending.operationId;
      const readPendingOperation = vi.fn(async () => ({
        kind: 4,
        eta: pending.eta,
        value1: 0n,
        value2: 0n,
        bps: 3_000,
        bps2: 5_000,
        bps3: 1_000,
        bps4: 1_000,
      }));
      const discovered = await discoverPendingBucketPolicyOperations([
        { operationId, kind: 4, eta: pending.eta },
      ], readPendingOperation);

      expect(discovered).toEqual([pending]);
      expect(readPendingOperation).toHaveBeenCalledExactlyOnceWith(operationId);
    });

    it('filters non-Bucket events and returns no pending operation when Core has consumed the event candidate', async () => {
      const readPendingOperation = vi.fn(async () => ({
        kind: 4, eta: 0n, value1: 0n, value2: 0n, bps: 0, bps2: 0, bps3: 0, bps4: 0,
      }));
      const discovered = await discoverPendingBucketPolicyOperations([
        { operationId: pending.operationId, kind: 0, eta: pending.eta },
      ], readPendingOperation);

      expect(discovered).toEqual([]);
      expect(readPendingOperation).not.toHaveBeenCalled();
    });

    it('rejects mismatched operation kind, ETA, and invalid four-field payloads', async () => {
      const scheduled = [{ operationId: pending.operationId, kind: 4, eta: pending.eta }];
      const base = { kind: 4, eta: pending.eta, value1: 0n, value2: 0n, bps: 3_000, bps2: 5_000, bps3: 1_000, bps4: 1_000 };
      await expect(discoverPendingBucketPolicyOperations(scheduled, async () => ({ ...base, kind: 0 })))
        .rejects.toThrow('operation kind');
      await expect(discoverPendingBucketPolicyOperations(scheduled, async () => ({ ...base, eta: pending.eta + 1n })))
        .rejects.toThrow('TimelockScheduled evidence');
      await expect(discoverPendingBucketPolicyOperations(scheduled, async () => ({ ...base, bps4: 999 })))
        .rejects.toThrow('invalid payload');
    });

    it('retains the verified pending policy, operation ID, and ETA from the schedule receipt', async () => {
      const policy = {
        ...defaultPolicy,
        allocations: {
          operational_reserve: 4_000n,
          yield_strategy: 4_000n,
          swap_liquidity: 1_000n,
          automation_agent: 1_000n,
        },
      };
      const plan = buildPolicyMutationPlan(policy, defaultRisk, defaultBucket);
      const result = await submitAndVerifyPolicyMutationPlan(plan, policy, defaultRisk, defaultBucket, {
        submit: async (action) => {
          expect(action.functionName).toBe('scheduleBucketPolicy');
          return '0xschedule';
        },
        waitForReceipt: async () => ({ status: 'success', logs: [] }),
        findScheduledOperation: () => pending.operationId,
        readPendingOperation: async () => ({
          kind: 4,
          eta: pending.eta,
          value1: 0n,
          value2: 0n,
          bps: 4_000,
          bps2: 4_000,
          bps3: 1_000,
          bps4: 1_000,
        }),
        readPolicies: async () => ({ riskPolicy: defaultRisk, bucketPolicy: defaultBucket }),
      });
      expect(result.pendingOperations).toEqual([{
        operationId: pending.operationId,
        kind: 'BucketPolicy',
        eta: pending.eta,
        bucketPolicy: {
          liquidOperationalReserveBps: 4_000,
          yieldStrategyBufferBps: 4_000,
          sweepLiquidityBufferBps: 1_000,
          automationAgentPoolBps: 1_000,
        },
      }]);
    });
  });

  it('uses the immediate reduction path when increasing the reserve floor and for less-risky bucket changes', () => {
    const plan = buildPolicyMutationPlan(
      {
        ...defaultPolicy,
        minimumLiquidReserve: 30_000_000n,
        allocations: {
          operational_reserve: 6_000n,
          yield_strategy: 2_500n,
          swap_liquidity: 750n,
          automation_agent: 750n,
        },
      },
      {
        minimumLiquidReserve: 25_000_000n,
        minimumLiquidReserveBps: 5_000,
        maximumTotalDeployed: 1_000_000_000n,
      },
      {
        liquidOperationalReserveBps: 5_000,
        yieldStrategyBufferBps: 3_000,
        sweepLiquidityBufferBps: 1_000,
        automationAgentPoolBps: 1_000,
      },
    );

    expect(plan.actions).toEqual([
      {
        functionName: 'reduceRiskPolicy',
        args: [30_000_000n, 5_000, 1_000_000_000n],
      },
      {
        functionName: 'reduceBucketPolicy',
        args: [{
          liquidOperationalReserveBps: 6_000,
          yieldStrategyBufferBps: 2_500,
          sweepLiquidityBufferBps: 750,
          automationAgentPoolBps: 750,
        }],
      },
    ]);
  });

  it('does not plan withdrawal changes without authoritative Core readback', () => {
    const plan = buildPolicyMutationPlan(
      {
        ...defaultPolicy,
        minimumLiquidReserve: 10_000_000n,
      },
      {
        minimumLiquidReserve: 10_000_000n,
        minimumLiquidReserveBps: 5_000,
        maximumTotalDeployed: 1_000_000_000n,
      },
      {
        liquidOperationalReserveBps: 5_000,
        yieldStrategyBufferBps: 3_000,
        sweepLiquidityBufferBps: 1_000,
        automationAgentPoolBps: 1_000,
      },
    );

    expect(plan.actions).toEqual([]);
    expect(() => buildPolicyMutationPlan({
      ...defaultPolicy,
      maximumSingleWithdrawal: 50_000_000n,
      dailyOutflowCap: 150_000_000n,
    }, defaultRisk, defaultBucket)).toThrow('withdrawal policy getters are unavailable');
  });

  it('uses authoritative Core withdrawal limits and the real setter for increases', () => {
    const plan = buildPolicyMutationPlan({
      ...defaultPolicy,
      maximumSingleWithdrawal: 60_000_000n,
      dailyOutflowCap: 160_000_000n,
    }, defaultRisk, defaultBucket, defaultWithdrawalPolicy);

    expect(plan.actions).toEqual([{
      functionName: 'setWithdrawalPolicy',
      args: [60_000_000n, 160_000_000n],
      isRiskIncreasing: true,
      previousMaximumSingleWithdrawal: 50_000_000n,
      previousDailyOutflowCap: 150_000_000n,
    }]);
  });

  it('applies withdrawal-limit reductions immediately', () => {
    const reduction = buildPolicyMutationPlan({
      ...defaultPolicy,
      maximumSingleWithdrawal: 40_000_000n,
      dailyOutflowCap: 100_000_000n,
    }, defaultRisk, defaultBucket, defaultWithdrawalPolicy);
    expect(reduction.actions).toEqual([{
      functionName: 'setWithdrawalPolicy',
      args: [40_000_000n, 100_000_000n],
      isRiskIncreasing: false,
      previousMaximumSingleWithdrawal: 50_000_000n,
      previousDailyOutflowCap: 150_000_000n,
    }]);

    expect(buildPolicyMutationPlan(defaultPolicy, defaultRisk, defaultBucket).actions).toEqual([]);
  });

  it('preserves explicit zero bucket values and rejects a bucket total other than 10,000 BPS', () => {
    const zeroValues = buildPolicyMutationPlan({
      ...defaultPolicy,
      allocations: { operational_reserve: 0n, yield_strategy: 10_000n, swap_liquidity: 0n, automation_agent: 0n },
    }, defaultRisk, defaultBucket);
    expect(zeroValues.actions[0]).toEqual({
      functionName: 'scheduleBucketPolicy',
      args: [{ liquidOperationalReserveBps: 0, yieldStrategyBufferBps: 10_000, sweepLiquidityBufferBps: 0, automationAgentPoolBps: 0 }],
    });

    expect(() => buildPolicyMutationPlan({
      ...defaultPolicy,
      allocations: { ...defaultPolicy.allocations, automation_agent: 999n },
    }, defaultRisk, defaultBucket)).toThrow('exactly 10,000 BPS');
  });

  it('submits editable Core risk BPS and deployed limits through existing policy functions', () => {
    const increase = buildPolicyMutationPlan({
      ...defaultPolicy,
      minimumLiquidReserveBps: 4_000,
      maximumTotalDeployed: 1_100_000_000n,
    }, defaultRisk, defaultBucket);
    expect(increase.actions).toEqual([{
      functionName: 'scheduleRiskPolicy',
      args: [defaultPolicy.minimumLiquidReserve, 4_000, 1_100_000_000n],
    }]);

    const reduction = buildPolicyMutationPlan({
      ...defaultPolicy,
      minimumLiquidReserveBps: 6_000,
      maximumTotalDeployed: 900_000_000n,
    }, defaultRisk, defaultBucket);
    expect(reduction.actions).toEqual([{
      functionName: 'reduceRiskPolicy',
      args: [defaultPolicy.minimumLiquidReserve, 6_000, 900_000_000n],
    }]);
  });

  it('rejects mixed risk increases and reductions before submitting a transaction', () => {
    expect(() => buildPolicyMutationPlan({
      ...defaultPolicy,
      minimumLiquidReserveBps: 6_000,
      maximumTotalDeployed: 1_100_000_000n,
    }, defaultRisk, defaultBucket)).toThrow('apply them in separate Core policy updates');
  });

  it('hydrates the editable bucket draft from authoritative Core values and preserves them unchanged', () => {
    const hydrated = withAuthoritativeBucketPolicy(createDefaultPolicy(), {
      liquidOperationalReserveBps: 0,
      yieldStrategyBufferBps: 10_000,
      sweepLiquidityBufferBps: 0,
      automationAgentPoolBps: 0,
    });
    expect(hydrated?.allocations).toEqual({
      operational_reserve: 0n,
      yield_strategy: 10_000n,
      swap_liquidity: 0n,
      automation_agent: 0n,
    });
    expect(hydrated && buildPolicyMutationPlan({ ...defaultPolicy, minimumLiquidReserve: 0n, minimumLiquidReserveBps: 10_000, maximumTotalDeployed: 0n, allocations: hydrated.allocations }, {
      minimumLiquidReserve: 0n,
      minimumLiquidReserveBps: 10_000,
      maximumTotalDeployed: 0n,
    }, {
      liquidOperationalReserveBps: 0,
      yieldStrategyBufferBps: 10_000,
      sweepLiquidityBufferBps: 0,
      automationAgentPoolBps: 0,
    }).actions).toEqual([]);
  });

  it('does not hydrate a draft from unavailable or invalid Core bucket values', () => {
    expect(withAuthoritativeBucketPolicy(createDefaultPolicy(), null)).toBeNull();
    expect(withAuthoritativeBucketPolicy(createDefaultPolicy(), {
      liquidOperationalReserveBps: 10_000,
      yieldStrategyBufferBps: 10_000,
      sweepLiquidityBufferBps: 0,
      automationAgentPoolBps: 0,
    })).toBeNull();
  });

  it('fails closed when Core risk or bucket getters are unavailable', () => {
    expect(() => buildPolicyMutationPlan(defaultPolicy, null, defaultBucket)).toThrow('getters are unavailable');
    expect(() => buildPolicyMutationPlan(defaultPolicy, defaultRisk, null)).toThrow('getters are unavailable');
  });

  it('allows on-chain policy mutation only for the authenticated Core POLICY_ADMIN projection', () => {
    const projection = {
      scope: 'ADMIN',
      chainId: 5042,
      coreAddress,
      authenticatedWalletAddress: '0x1111111111111111111111111111111111111111',
      authorization: { policyAdmin: { source: 'CORE', availability: 'AVAILABLE', value: true } },
    };
    expect(isAuthorizedTreasuryAdminProjection(projection, projection.authenticatedWalletAddress, coreAddress)).toBe(true);
    expect(isAuthorizedTreasuryAdminProjection(projection, projection.authenticatedWalletAddress, '0x1111111111111111111111111111111111111111')).toBe(false);
    expect(isAuthorizedTreasuryAdminProjection(projection, '0x2222222222222222222222222222222222222222', coreAddress)).toBe(false);
    expect(isAuthorizedTreasuryAdminProjection({ ...projection, scope: 'USER' }, projection.authenticatedWalletAddress, coreAddress)).toBe(false);
    expect(isAuthorizedTreasuryAdminProjection({ ...projection, coreAddress: undefined }, projection.authenticatedWalletAddress, coreAddress)).toBe(false);
  });

  it('uses only the known reference Core for local Admin projection validation, never as the production transaction target', () => {
    expect(expectedAdminProjectionCoreAddress(null, false)).toBe(coreAddress);
    expect(expectedAdminProjectionCoreAddress(null, true)).toBeNull();
    expect(expectedAdminProjectionCoreAddress('0x1111111111111111111111111111111111111111', false))
      .toBe('0x1111111111111111111111111111111111111111');
  });

  it('reports a risk increase as scheduled only after receipt and exact Core pending readback', async () => {
    const policy = { ...defaultPolicy, minimumLiquidReserve: 25_000_000n };
    const plan = buildPolicyMutationPlan(policy, defaultRisk, defaultBucket);
    const submit = vi.fn(async () => '0xtransaction');
    const waitForReceipt = vi.fn(async () => ({ status: 'success', logs: [] }));
    const findScheduledOperation = vi.fn(() => '0xoperation');
    const readPendingOperation = vi.fn(async () => ({
      kind: 0,
      eta: 123_456n,
      value1: 25_000_000n,
      value2: defaultRisk.maximumTotalDeployed,
      bps: defaultRisk.minimumLiquidReserveBps,
      bps2: 0,
      bps3: 0,
      bps4: 0,
    }));
    const readPolicies = vi.fn(async () => ({ riskPolicy: defaultRisk, bucketPolicy: defaultBucket }));

    const result = await submitAndVerifyPolicyMutationPlan(plan, policy, defaultRisk, defaultBucket, {
      submit,
      waitForReceipt,
      findScheduledOperation,
      readPendingOperation,
      readPolicies,
    });
    expect(result).toEqual({ status: 'SCHEDULED', pendingOperations: [{ operationId: '0xoperation', kind: 'RiskPolicy', eta: 123_456n }] });
    expect(waitForReceipt).toHaveBeenCalledWith('0xtransaction');
    expect(readPendingOperation).toHaveBeenCalledWith('0xoperation');
  });

  it('confirms scheduled withdrawal limit increases from the Core timelock operation', async () => {
      const targetPolicy = {
        ...defaultPolicy,
        maximumSingleWithdrawal: 60_000_000n,
        dailyOutflowCap: 160_000_000n,
      };
      const plan = buildPolicyMutationPlan(targetPolicy, defaultRisk, defaultBucket, defaultWithdrawalPolicy);
      const result = await submitAndVerifyPolicyMutationPlan(plan, targetPolicy, defaultRisk, defaultBucket, {
        submit: async (action) => {
          expect(action.functionName).toBe('setWithdrawalPolicy');
          expect(action.args).toEqual([60_000_000n, 160_000_000n]);
          return '0xtransaction';
        },
        waitForReceipt: async () => ({ status: 'success', logs: [] }),
        findScheduledOperation: (_receipt, action) => {
          expect(action.functionName).toBe('setWithdrawalPolicy');
          return '0xwithdrawaloperation';
        },
        readPendingOperation: async () => ({
          kind: 5,
          eta: 123_456n,
          value1: 60_000_000n,
          value2: 160_000_000n,
          bps: 0,
          bps2: 0,
          bps3: 0,
          bps4: 0,
        }),
        readPolicies: async () => ({
          riskPolicy: defaultRisk,
          bucketPolicy: defaultBucket,
          withdrawalPolicy: defaultWithdrawalPolicy,
        }),
      });
      expect(result).toEqual({
        status: 'SCHEDULED',
        pendingOperations: [{ operationId: '0xwithdrawaloperation', kind: 'WithdrawalPolicy', eta: 123_456n }],
      });
  });

  it('applies editable BPS and deployment limits through the existing POLICY_ADMIN schedule flow', async () => {
    const targetPolicy = {
      ...defaultPolicy,
      minimumLiquidReserveBps: 4_000,
      maximumTotalDeployed: 1_100_000_000n,
    };
    const plan = buildPolicyMutationPlan(targetPolicy, defaultRisk, defaultBucket);
    const submit = vi.fn(async (action: { readonly functionName: string; readonly args: readonly unknown[] }) => {
      expect(action.functionName).toBe('scheduleRiskPolicy');
      expect(action.args).toEqual([defaultRisk.minimumLiquidReserve, 4_000, 1_100_000_000n]);
      return '0xtransaction';
    });
    const result = await submitAndVerifyPolicyMutationPlan(plan, targetPolicy, defaultRisk, defaultBucket, {
      submit,
      waitForReceipt: async () => ({ status: 'success', logs: [] }),
      findScheduledOperation: () => '0xoperation',
      readPendingOperation: async () => ({
        kind: 0,
        eta: 123_456n,
        value1: defaultRisk.minimumLiquidReserve,
        value2: 1_100_000_000n,
        bps: 4_000,
        bps2: 0,
        bps3: 0,
        bps4: 0,
      }),
      readPolicies: async () => ({ riskPolicy: defaultRisk, bucketPolicy: defaultBucket }),
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SCHEDULED');
  });

  it('rejects a scheduled operation whose authoritative pending payload differs from the requested policy', async () => {
    const policy = { ...defaultPolicy, minimumLiquidReserve: 25_000_000n };
    const plan = buildPolicyMutationPlan(policy, defaultRisk, defaultBucket);
    await expect(submitAndVerifyPolicyMutationPlan(plan, policy, defaultRisk, defaultBucket, {
      submit: async () => '0xtransaction',
      waitForReceipt: async () => ({ status: 'success', logs: [] }),
      findScheduledOperation: () => '0xoperation',
      readPendingOperation: async () => ({
        kind: 0,
        eta: 123_456n,
        value1: 24_000_000n,
        value2: defaultRisk.maximumTotalDeployed,
        bps: defaultRisk.minimumLiquidReserveBps,
        bps2: 0,
        bps3: 0,
        bps4: 0,
      }),
      readPolicies: async () => ({ riskPolicy: defaultRisk, bucketPolicy: defaultBucket }),
    })).rejects.toThrow('not confirmed by Core pending-operation readback');
  });

  it('reports immediate policy application only after authoritative Core readback', async () => {
    const policy = { ...defaultPolicy, minimumLiquidReserve: 60_000_000n };
    const plan = buildPolicyMutationPlan(policy, defaultRisk, defaultBucket);
    const result = await submitAndVerifyPolicyMutationPlan(plan, policy, defaultRisk, defaultBucket, {
      submit: async () => '0xtransaction',
      waitForReceipt: async () => ({ status: 'success', logs: [] }),
      findScheduledOperation: () => { throw new Error('No schedule expected.'); },
      readPendingOperation: async () => { throw new Error('No pending operation expected.'); },
      readPolicies: async () => ({ riskPolicy: { ...defaultRisk, minimumLiquidReserve: 60_000_000n }, bucketPolicy: defaultBucket }),
    });
    expect(result).toEqual({ status: 'APPLIED', pendingOperations: [] });

    await expect(submitAndVerifyPolicyMutationPlan(plan, policy, defaultRisk, defaultBucket, {
      submit: async () => '0xtransaction',
      waitForReceipt: async () => ({ status: 'success', logs: [] }),
      findScheduledOperation: () => { throw new Error('No schedule expected.'); },
      readPendingOperation: async () => { throw new Error('No pending operation expected.'); },
      readPolicies: async () => ({ riskPolicy: defaultRisk, bucketPolicy: defaultBucket }),
    })).rejects.toThrow('Core risk policy readback');
  });

  it('surfaces reverted transactions and never calls them applied', async () => {
    const policy = { ...defaultPolicy, minimumLiquidReserve: 60_000_000n };
    const plan = buildPolicyMutationPlan(policy, defaultRisk, defaultBucket);
    await expect(submitAndVerifyPolicyMutationPlan(plan, policy, defaultRisk, defaultBucket, {
      submit: async () => '0xtransaction',
      waitForReceipt: async () => ({ status: 'reverted', logs: [] }),
      findScheduledOperation: () => { throw new Error('No schedule expected.'); },
      readPendingOperation: async () => { throw new Error('No pending operation expected.'); },
      readPolicies: async () => ({ riskPolicy: defaultRisk, bucketPolicy: defaultBucket }),
    })).rejects.toThrow('failed or was reverted');
  });

  it('reports a verified earlier policy schedule when the next wallet transaction is rejected', async () => {
    const policy = {
      ...defaultPolicy,
      minimumLiquidReserve: 25_000_000n,
      allocations: { operational_reserve: 4_000n, yield_strategy: 4_000n, swap_liquidity: 1_000n, automation_agent: 1_000n },
    };
    const plan = buildPolicyMutationPlan(policy, defaultRisk, defaultBucket);
    let submission = 0;
    await expect(submitAndVerifyPolicyMutationPlan(plan, policy, defaultRisk, defaultBucket, {
      submit: async () => {
        submission += 1;
        if (submission === 2) throw new Error('User rejected the request.');
        return '0xtransaction';
      },
      waitForReceipt: async () => ({ status: 'success', logs: [] }),
      findScheduledOperation: () => '0xoperation',
      readPendingOperation: async () => ({
        kind: 0,
        eta: 123_456n,
        value1: 25_000_000n,
        value2: defaultRisk.maximumTotalDeployed,
        bps: defaultRisk.minimumLiquidReserveBps,
        bps2: 0,
        bps3: 0,
        bps4: 0,
      }),
      readPolicies: async () => ({ riskPolicy: defaultRisk, bucketPolicy: defaultBucket }),
    })).rejects.toThrow('User rejected the request. Earlier policy change(s) were confirmed by authoritative Core readback. Verified pending operation(s): RiskPolicy 0xoperation (ETA 123456).');
  });
});
