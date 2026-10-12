import { describe, expect, it, vi } from 'vitest';
import type { Hash } from 'viem';

import { approveAndRefreshAllowance, executeSwapLifecycle, type SwapExecutionState } from './swapTransactionLifecycle';

const transactionHash = `0x${'1'.repeat(64)}` as Hash;

describe('swap transaction lifecycle', () => {
  it('waits for a successful approval receipt before refetching allowance', async () => {
    const events: string[] = [];
    await approveAndRefreshAllowance({
      submit: async () => { events.push('submitted'); return transactionHash; },
      waitForReceipt: async () => { events.push('receipt'); return { status: 'success' }; },
      refetchAllowance: async () => { events.push('allowance'); },
    });

    expect(events).toEqual(['submitted', 'receipt', 'allowance']);
  });

  it('does not refetch allowance or report approval success after a reverted receipt', async () => {
    const refetchAllowance = vi.fn();
    await expect(approveAndRefreshAllowance({
      submit: async () => transactionHash,
      waitForReceipt: async () => ({ status: 'reverted' }),
      refetchAllowance,
    })).rejects.toThrow('approval transaction reverted');
    expect(refetchAllowance).not.toHaveBeenCalled();
  });

  it('reports submitted state while waiting, then confirms after receipt and authoritative balance deltas', async () => {
    const states: SwapExecutionState[] = [];
    const waitForReceipt = vi.fn(async () => ({ status: 'success' as const }));
    await executeSwapLifecycle({
      amountIn: 100n,
      minimumAmountOut: 180n,
      readBalances: vi.fn()
        .mockResolvedValueOnce({ source: 500n, destination: 40n })
        .mockResolvedValueOnce({ source: 400n, destination: 225n }),
      submit: async () => transactionHash,
      waitForReceipt,
      onStateChange: (state) => states.push(state),
    });

    expect(states).toEqual([
      { status: 'SUBMITTED', hash: transactionHash },
      { status: 'CONFIRMED', hash: transactionHash },
    ]);
    expect(waitForReceipt).toHaveBeenCalledWith(transactionHash);
  });

  it('reports a reverted swap without performing post-swap balance readback', async () => {
    const states: SwapExecutionState[] = [];
    const readBalances = vi.fn(async () => ({ source: 500n, destination: 40n }));
    await expect(executeSwapLifecycle({
      amountIn: 100n,
      minimumAmountOut: 180n,
      readBalances,
      submit: async () => transactionHash,
      waitForReceipt: async () => ({ status: 'reverted' }),
      onStateChange: (state) => states.push(state),
    })).rejects.toThrow('Swap transaction reverted');

    expect(states).toEqual([{ status: 'SUBMITTED', hash: transactionHash }, { status: 'REVERTED', hash: transactionHash }]);
    expect(readBalances).toHaveBeenCalledOnce();
  });

  it('requires authoritative destination and source balance changes before full confirmation', async () => {
    const states: SwapExecutionState[] = [];
    const readBalances = vi.fn()
      .mockResolvedValueOnce({ source: 500n, destination: 40n })
      .mockResolvedValueOnce({ source: 401n, destination: 225n });
    await executeSwapLifecycle({
      amountIn: 100n,
      minimumAmountOut: 180n,
      readBalances,
      submit: async () => transactionHash,
      waitForReceipt: async () => ({ status: 'success' }),
      onStateChange: (state) => states.push(state),
    });

    expect(readBalances).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.status).toBe('CONFIRMED');
  });

  it('does not fully confirm if either source or destination balance mismatches', async () => {
    for (const after of [
      { source: 500n, destination: 225n },
      { source: 400n, destination: 219n },
      { source: 399n, destination: 225n },
    ]) {
      const states: SwapExecutionState[] = [];
      await expect(executeSwapLifecycle({
        amountIn: 100n,
        minimumAmountOut: 180n,
        readBalances: vi.fn()
          .mockResolvedValueOnce({ source: 500n, destination: 40n })
          .mockResolvedValueOnce(after),
        submit: async () => transactionHash,
        waitForReceipt: async () => ({ status: 'success' }),
        onStateChange: (state) => states.push(state),
      })).rejects.toThrow('balance changes did not match');
      expect(states.at(-1)?.status).toBe('READBACK_FAILED');
      expect(states.some((state) => state.status === 'CONFIRMED')).toBe(false);
    }
  });

  it('does not fully confirm when authoritative post-swap balance reads fail', async () => {
    const states: SwapExecutionState[] = [];
    await expect(executeSwapLifecycle({
      amountIn: 100n,
      minimumAmountOut: 180n,
      readBalances: vi.fn()
        .mockResolvedValueOnce({ source: 500n, destination: 40n })
        .mockRejectedValueOnce(new Error('RPC unavailable')),
      submit: async () => transactionHash,
      waitForReceipt: async () => ({ status: 'success' }),
      onStateChange: (state) => states.push(state),
    })).rejects.toThrow('authoritative token balance readback failed');
    expect(states.at(-1)?.status).toBe('READBACK_FAILED');
  });
});
