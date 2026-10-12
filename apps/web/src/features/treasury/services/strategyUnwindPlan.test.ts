import { describe, expect, it, vi } from 'vitest';
import { buildStrategyUnwindPlan } from './strategyUnwindPlan';

describe('buildStrategyUnwindPlan', () => {
  it('selects the smallest authoritative share amount that covers the liquid shortfall', async () => {
    const previewRedeem = vi.fn(async (shares: bigint) => shares * 2n);

    await expect(buildStrategyUnwindPlan({
      availableShares: 10n,
      requiredAssets: 7n,
      previewRedeem,
    })).resolves.toBe(4n);

    expect(await previewRedeem(3n)).toBe(6n);
  });

  it('does not request more than the authoritative user strategy shares', async () => {
    await expect(buildStrategyUnwindPlan({
      availableShares: 3n,
      requiredAssets: 7n,
      previewRedeem: async (shares) => shares * 2n,
    })).rejects.toThrow('cannot cover the required liquidity');
  });

  it('rejects unavailable user strategy shares rather than using aggregate shares', async () => {
    const previewRedeem = vi.fn();

    await expect(buildStrategyUnwindPlan({
      availableShares: 0n,
      requiredAssets: 1n,
      previewRedeem,
    })).rejects.toThrow('No authoritative user strategy shares');
    expect(previewRedeem).not.toHaveBeenCalled();
  });
});
