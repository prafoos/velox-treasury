import { describe, expect, it, vi } from 'vitest';

import { confirmUserBalanceChange } from './userBalanceReadback';

describe('confirmUserBalanceChange', () => {
  it('confirms a deposit only after refresh and exact Core balance readback', async () => {
    const refresh = vi.fn(async () => undefined);
    const readCoreBalance = vi.fn(async () => 1_500_000n);

    await expect(confirmUserBalanceChange({
      previousBalance: 500_000n,
      amount: 1_000_000n,
      change: 'deposit',
      refresh,
      readCoreBalance,
    })).resolves.toBe(1_500_000n);
    expect(refresh).toHaveBeenCalledOnce();
    expect(readCoreBalance).toHaveBeenCalledOnce();
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(readCoreBalance.mock.invocationCallOrder[0]);
  });

  it('rejects a deposit when the Core balance readback differs from the expected balance', async () => {
    const reportSuccess = vi.fn();
    const confirmation = confirmUserBalanceChange({
      previousBalance: 500_000n,
      amount: 1_000_000n,
      change: 'deposit',
      refresh: async () => undefined,
      readCoreBalance: async () => 1_499_999n,
    }).then(reportSuccess);

    await expect(confirmation).rejects.toThrow('deposit Core balance readback mismatch');
    expect(reportSuccess).not.toHaveBeenCalled();
  });

  it('confirms a liquid withdrawal only after exact Core balance readback', async () => {
    const refresh = vi.fn(async () => undefined);
    const readCoreBalance = vi.fn(async () => 300_000n);

    await expect(confirmUserBalanceChange({
      previousBalance: 1_000_000n,
      amount: 700_000n,
      change: 'withdrawal',
      refresh,
      readCoreBalance,
    })).resolves.toBe(300_000n);
    expect(refresh).toHaveBeenCalledOnce();
    expect(readCoreBalance).toHaveBeenCalledOnce();
  });

  it('does not report a successful withdrawal if readback mismatches after receipt/event confirmation', async () => {
    const reportSuccess = vi.fn();
    const confirmation = confirmUserBalanceChange({
      previousBalance: 1_000_000n,
      amount: 700_000n,
      change: 'withdrawal',
      refresh: async () => undefined,
      readCoreBalance: async () => 299_999n,
    }).then(reportSuccess);

    await expect(confirmation).rejects.toThrow('withdrawal Core balance readback mismatch');
    expect(reportSuccess).not.toHaveBeenCalled();
  });

  it('does not confirm when refresh or authoritative Core readback fails', async () => {
    await expect(confirmUserBalanceChange({
      previousBalance: 500n,
      amount: 100n,
      change: 'deposit',
      refresh: async () => { throw new Error('refresh unavailable'); },
      readCoreBalance: async () => 600n,
    })).rejects.toThrow('refresh unavailable');

    await expect(confirmUserBalanceChange({
      previousBalance: 500n,
      amount: 100n,
      change: 'deposit',
      refresh: async () => undefined,
      readCoreBalance: async () => { throw new Error('Core read unavailable'); },
    })).rejects.toThrow('Core read unavailable');
  });
});
