import { afterEach, describe, expect, it } from 'vitest';
import { createAllocationBuckets, createDefaultPolicy, getPolicyBalanceWarning, loadTreasuryPolicy, policyToFormValues, saveTreasuryPolicy, validatePolicyExecutionLimits, validateTreasuryCorePolicyDraft, validateTreasuryPolicy } from './policyService';

const originalWindow = globalThis.window;
afterEach(() => Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow }));

function validValues() {
  return {
    ...policyToFormValues(createDefaultPolicy()),
    minimumLiquidReserve: '10',
    minimumLiquidReserveBps: '5000',
    maximumTotalDeployed: '1000',
    timelockDelaySeconds: '172800',
    valuationFreshnessBlocks: '100',
    surplusSweepThreshold: '20',
    dailyOutflowCap: '50',
    maximumSingleWithdrawal: '25',
    automatedSweepEnabled: true,
    allocations: { operational_reserve: '40', yield_strategy: '30', swap_liquidity: '20', automation_agent: '10' },
  };
}

const fixedCoreReadback = {
  minimumLiquidReserve: 10_000_000n,
  minimumLiquidReserveBps: 5_000,
  maximumTotalDeployed: 1_000_000_000n,
  timelockDelaySeconds: 172_800n,
  valuationFreshnessBlocks: 100n,
};

describe('validateTreasuryPolicy', () => {
  it('accepts a valid policy using exact USDC and basis-point values', () => {
    const result = validateTreasuryPolicy(validValues());
    expect(result.isValid).toBe(true);
    expect(result.policy?.minimumLiquidReserve).toBe(10_000_000n);
    expect(result.policy?.allocations.operational_reserve).toBe(4_000n);
  });

  describe('validateTreasuryCorePolicyDraft', () => {
    it('accepts explicitly entered Core risk and bucket values while retaining fixed Core readback', () => {
      const result = validateTreasuryCorePolicyDraft(validValues(), fixedCoreReadback);
      expect(result.errors).toEqual({});
      expect(result.draft).toEqual({
        minimumLiquidReserve: 10_000_000n,
        minimumLiquidReserveBps: 5_000,
        maximumTotalDeployed: 1_000_000_000n,
        timelockDelaySeconds: 172_800n,
        valuationFreshnessBlocks: 100n,
        allocations: {
          operational_reserve: 4_000n,
          yield_strategy: 3_000n,
          swap_liquidity: 2_000n,
          automation_agent: 1_000n,
        },
      });
    });

    it('includes withdrawal limits only when both authoritative Core getters are available', () => {
      const values = validValues();
      const localValues = validateTreasuryCorePolicyDraft(values, fixedCoreReadback);
      expect(localValues.draft?.maximumSingleWithdrawal).toBeUndefined();
      expect(localValues.draft?.dailyOutflowCap).toBeUndefined();

      const result = validateTreasuryCorePolicyDraft(values, {
        ...fixedCoreReadback,
        maximumSingleWithdrawal: 25_000_000n,
        dailyOutflowCap: 50_000_000n,
      });
      expect(result.errors).toEqual({});
      expect(result.draft?.maximumSingleWithdrawal).toBe(25_000_000n);
      expect(result.draft?.dailyOutflowCap).toBe(50_000_000n);
    });

    it('rejects incomplete editable values without requiring Core-fixed read-only values', () => {
      const values = validValues();
      values.minimumLiquidReserveBps = '';
      expect(validateTreasuryCorePolicyDraft(values, fixedCoreReadback).errors.minimumLiquidReserveBps).toContain('required');
      const unavailableReadback = {
        ...fixedCoreReadback,
        timelockDelaySeconds: null,
        valuationFreshnessBlocks: null,
      };
      const result = validateTreasuryCorePolicyDraft(validValues(), unavailableReadback);
      expect(result.errors).toEqual({});
      expect(result.draft).toBeUndefined();
    });

    it('does not report an editable validation error when the fixed timelock is unavailable', () => {
      const result = validateTreasuryCorePolicyDraft(validValues(), {
        ...fixedCoreReadback,
        timelockDelaySeconds: null,
      });
      expect(result.errors).toEqual({});
      expect(result.draft).toBeUndefined();
    });

    it('does not report an editable validation error when fixed valuation freshness is unavailable', () => {
      const result = validateTreasuryCorePolicyDraft(validValues(), {
        ...fixedCoreReadback,
        valuationFreshnessBlocks: null,
      });
      expect(result.errors).toEqual({});
      expect(result.draft).toBeUndefined();
    });

    it('requires the bucket values to total exactly 10,000 BPS', () => {
      const values = validValues();
      values.allocations = { ...values.allocations, automation_agent: '9.99' };
      expect(validateTreasuryCorePolicyDraft(values, fixedCoreReadback).errors.allocations).toContain('exactly 100%');
    });

    it('accepts explicitly entered zero values without synthesizing a default allocation', () => {
      const values = {
        ...validValues(),
        minimumLiquidReserve: '0',
        minimumLiquidReserveBps: '0',
        maximumTotalDeployed: '0',
        allocations: { operational_reserve: '0', yield_strategy: '100', swap_liquidity: '0', automation_agent: '0' },
      };
      const result = validateTreasuryCorePolicyDraft(values, {
        ...fixedCoreReadback,
        minimumLiquidReserve: 0n,
        minimumLiquidReserveBps: 0,
        maximumTotalDeployed: 0n,
      });
      expect(result.errors).toEqual({});
      expect(result.draft?.allocations).toEqual({
        operational_reserve: 0n,
        yield_strategy: 10_000n,
        swap_liquidity: 0n,
        automation_agent: 0n,
      });

      const untouched = policyToFormValues(createDefaultPolicy());
      expect(untouched.minimumLiquidReserve).toBe('');
      expect(untouched.allocations).toEqual({
        operational_reserve: '',
        yield_strategy: '',
        swap_liquidity: '',
        automation_agent: '',
      });
      expect(validateTreasuryCorePolicyDraft(untouched, fixedCoreReadback).draft).toBeUndefined();
    });

    it('uses the authoritative fixed freshness and timelock values rather than validating read-only form text', () => {
      const zeroFreshness = validValues();
      zeroFreshness.valuationFreshnessBlocks = 'Unavailable';
      zeroFreshness.timelockDelaySeconds = 'Unavailable';
      const result = validateTreasuryCorePolicyDraft(zeroFreshness, fixedCoreReadback);
      expect(result.errors).toEqual({});
      expect(result.draft?.timelockDelaySeconds).toBe(fixedCoreReadback.timelockDelaySeconds);
      expect(result.draft?.valuationFreshnessBlocks).toBe(fixedCoreReadback.valuationFreshnessBlocks);
    });
  });

  it('rejects negative token values', () => {
    const values = validValues(); values.minimumLiquidReserve = '-1';
    expect(validateTreasuryPolicy(values).errors.minimumLiquidReserve).toContain('non-negative');
  });

  it('rejects allocations outside 0 to 100 and totals other than 100', () => {
    const values = validValues(); values.allocations.yield_strategy = '101';
    expect(validateTreasuryPolicy(values).errors['allocations.yield_strategy']).toContain('between 0 and 100');
    const wrongTotal = validValues(); wrongTotal.allocations.automation_agent = '9.99';
    expect(validateTreasuryPolicy(wrongTotal).errors.allocations).toContain('exactly 100%');
  });

  it('supports a small balance when its limits preserve the configured reserve', () => {
    const values = validValues(); values.minimumLiquidReserve = '2'; values.surplusSweepThreshold = '5'; values.dailyOutflowCap = '6'; values.maximumSingleWithdrawal = '4';
    expect(validateTreasuryPolicy(values).isValid).toBe(true);
  });

  it('supports large balances without numeric precision loss', () => {
    const values = validValues(); values.minimumLiquidReserve = '1000000000000.000001'; values.surplusSweepThreshold = '1000000000001'; values.dailyOutflowCap = '1999999999999'; values.maximumSingleWithdrawal = '1000000000000';
    expect(validateTreasuryPolicy(values).isValid).toBe(true);
  });

  it('rejects unsafe structural limit combinations', () => {
    const maxOverDaily = validValues(); maxOverDaily.maximumSingleWithdrawal = '51';
    expect(validateTreasuryPolicy(maxOverDaily).errors.maximumSingleWithdrawal).toContain('cannot exceed');
    const sweepBelowReserve = validValues(); sweepBelowReserve.surplusSweepThreshold = '9';
    expect(validateTreasuryPolicy(sweepBelowReserve).errors.surplusSweepThreshold).toContain('at least');
  });

  it('allows a future policy at zero balance but keeps execution-time balance safety checks', () => {
    const result = validateTreasuryPolicy(validValues());
    expect(result.isValid).toBe(true);
    expect(validatePolicyExecutionLimits(result.policy!, 0n).dailyOutflowCap).toContain('spendable');
    expect(getPolicyBalanceWarning(result.policy!, 0n)).toContain('does not prevent saving');
  });

  it('accepts zero boundary values', () => {
    const values = {
      ...policyToFormValues(createDefaultPolicy()),
      minimumLiquidReserve: '0',
      surplusSweepThreshold: '0',
      dailyOutflowCap: '0',
      maximumSingleWithdrawal: '0',
      allocations: { operational_reserve: '0', yield_strategy: '100', swap_liquidity: '0', automation_agent: '0' },
    };
    expect(validateTreasuryPolicy(values).isValid).toBe(true);
  });

  it('does not invent a valid bucket allocation when no local Admin decision exists', () => {
    const values = policyToFormValues(createDefaultPolicy());
    expect(values.allocations).toEqual({
      operational_reserve: '',
      yield_strategy: '',
      swap_liquidity: '',
      automation_agent: '',
    });
    expect(validateTreasuryPolicy(values).isValid).toBe(false);
    expect(validateTreasuryPolicy(values).errors['allocations.operational_reserve']).toContain('percentage');
  });

  it('persists a valid future policy through the local storage reload path', () => {
    const values = validValues();
    const policy = validateTreasuryPolicy(values).policy!;
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } },
    });
    saveTreasuryPolicy(policy);
    expect(policyToFormValues(loadTreasuryPolicy())).toEqual({
      ...values,
      minimumLiquidReserveBps: '',
      maximumTotalDeployed: '',
      timelockDelaySeconds: 'Unavailable',
      valuationFreshnessBlocks: 'Unavailable',
    });
  });

  it('labels unavailable bucket state as unavailable instead of pending or zero', () => {
    const buckets = createAllocationBuckets(createDefaultPolicy(), null, null);
    expect(buckets[0].targetStage).toContain('Unavailable');
    expect(buckets[0].description).toContain('Admin-selected allocation are unavailable');
    expect(buckets[0].targetPercentageBps).toBeNull();
    expect(buckets[0].currentAmount).toBeNull();
  });

  it('preserves explicitly configured zero bucket targets in a complete Admin-selected policy', () => {
    const policy = {
      ...createDefaultPolicy(),
      allocations: {
        operational_reserve: 0n,
        yield_strategy: 10_000n,
        swap_liquidity: 0n,
        automation_agent: 0n,
      },
    };
    const buckets = createAllocationBuckets(policy, null, null);
    expect(buckets.map((bucket) => bucket.targetPercentageBps)).toEqual([0n, 10_000n, 0n, 0n]);
  });

  it('keeps genuine zero bucket values as zero and not unavailable', () => {
    const buckets = createAllocationBuckets(createDefaultPolicy(), [0n, 0n, 0n, 0n], [0n, 0n, 0n]);
    expect(buckets[0].currentAmount).toBe('0.00');
    expect(buckets[0].targetStage).toContain('Zero Core classification');
    expect(buckets[0].description).toContain('zero according to Core');
  });
});
