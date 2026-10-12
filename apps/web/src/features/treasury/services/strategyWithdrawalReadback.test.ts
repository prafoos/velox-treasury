import { describe, expect, it } from 'vitest';
import { verifyStrategyWithdrawalReadback, type StrategyWithdrawalReadback } from './strategyWithdrawalReadback';

function readback(overrides: Partial<StrategyWithdrawalReadback> = {}): StrategyWithdrawalReadback {
  return {
    requestedAmount: 800n,
    preWithdrawalBalance: 1_000n,
    eventAmount: 800n,
    eventUserBalance: 200n,
    actualUserBalance: 200n,
    preUserStrategyShares: 500n,
    postUserStrategyShares: 300n,
    preUserStrategyPosition: 450n,
    postUserStrategyPosition: 280n,
    unwindShares: 200n,
    preAggregateStrategyShares: 1_000n,
    postAggregateStrategyShares: 800n,
    preAggregateStrategyPosition: 900n,
    postAggregateStrategyPosition: 700n,
    preTotalDeployed: 1_200n,
    postTotalDeployed: 1_000n,
    ...overrides,
  };
}

describe('verifyStrategyWithdrawalReadback', () => {
  it('accepts exact user balance, user strategy shares, and aggregate reconciliation', () => {
    expect(() => verifyStrategyWithdrawalReadback(readback())).not.toThrow();
  });

  it('rejects user balance readback that disagrees with the Core withdrawal event', () => {
    expect(() => verifyStrategyWithdrawalReadback(readback({ actualUserBalance: 201n })))
      .toThrow('Core balance readback mismatch');
  });

  it('rejects an incorrect user-specific or aggregate share readback', () => {
    expect(() => verifyStrategyWithdrawalReadback(readback({ postUserStrategyShares: 501n })))
      .toThrow('User strategy share position increased');
    expect(() => verifyStrategyWithdrawalReadback(readback({ postAggregateStrategyShares: 799n })))
      .toThrow('Aggregate strategy share readback');
  });

  it('rejects a user strategy value that increased or remains after a full withdrawal', () => {
    expect(() => verifyStrategyWithdrawalReadback(readback({ postUserStrategyPosition: 451n })))
      .toThrow('User strategy share position increased');
    expect(() => verifyStrategyWithdrawalReadback(readback({
      requestedAmount: 1_000n,
      preWithdrawalBalance: 1_000n,
      eventAmount: 1_000n,
      eventUserBalance: 0n,
      actualUserBalance: 0n,
      postUserStrategyShares: 0n,
      postUserStrategyPosition: 1n,
    }))).toThrow('Full Treasury withdrawal did not clear');
  });

  it('rejects aggregate position that does not reconcile with totalDeployed', () => {
    expect(() => verifyStrategyWithdrawalReadback(readback({ postTotalDeployed: 999n })))
      .toThrow('does not reconcile');
  });

  it('requires a full withdrawal to clear the Core user balance', () => {
    expect(() => verifyStrategyWithdrawalReadback(readback({
      requestedAmount: 1_000n,
      preWithdrawalBalance: 1_000n,
      eventAmount: 1_000n,
      actualUserBalance: 1n,
      eventUserBalance: 1n,
    }))).toThrow('Full Treasury withdrawal');
  });
});
