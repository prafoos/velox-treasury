import { describe, expect, it } from 'vitest';

import { buildImmediateWithdrawalCall, validateImmediateWithdrawal, validateWithdrawal } from './withdrawalValidation';

const policy = {
  minimumLiquidReserve: 1_000_000n,
  dailyOutflowCap: 1_000_000n,
  maximumSingleWithdrawal: 1_000_000n,
};

const validInput = {
  recipient: '0x1111111111111111111111111111111111111111',
  amount: '1',
  policy,
  treasuryBalance: 2_000_000n,
  rollingOutflow: 0n,
};

describe('validateWithdrawal', () => {
  it('converts six-decimal USDC and accepts a policy-compliant withdrawal', () => {
    expect(validateWithdrawal(validInput).amount).toBe(1_000_000n);
  });

  describe('validateImmediateWithdrawal', () => {
    it('allows a supported withdrawal within the user and immediately withdrawable values', () => {
      expect(() => validateImmediateWithdrawal({
        amount: 500_000n,
        userBalance: 1_000_000n,
        immediatelyWithdrawableValue: 600_000n,
        paused: false,
      })).not.toThrow();
    });

    describe('buildImmediateWithdrawalCall', () => {
      it('selects only the supported direct Core withdrawal for immediately liquid value', () => {
        expect(buildImmediateWithdrawalCall({
          recipient: '0x1111111111111111111111111111111111111111',
          walletAddress: '0x1111111111111111111111111111111111111111',
          amount: 500_000n,
          userBalance: 1_000_000n,
          immediatelyWithdrawableValue: 600_000n,
          paused: false,
        })).toEqual({
          functionName: 'withdraw',
          args: [500_000n, '0x1111111111111111111111111111111111111111'],
        });
      });

      it('preserves caller-only self-withdrawal and directs strategy-backed withdrawals to the unwind path', () => {
        const input = {
          recipient: '0x1111111111111111111111111111111111111111',
          walletAddress: '0x1111111111111111111111111111111111111111',
          amount: 500_000n,
          userBalance: 1_000_000n,
          immediatelyWithdrawableValue: 600_000n,
          paused: false,
        };
        expect(() => buildImmediateWithdrawalCall({ ...input, walletAddress: '0x2222222222222222222222222222222222222222' }))
          .toThrow('recipient must match');
        expect(() => buildImmediateWithdrawalCall({ ...input, amount: 700_000n }))
          .toThrow('Use the strategy deallocation withdrawal path');
      });
    });

    it('fails closed for paused Core, excess entitlement, and directs strategy-backed withdrawals to the unwind path', () => {
      const base = {
        amount: 500_000n,
        userBalance: 1_000_000n,
        immediatelyWithdrawableValue: 600_000n,
        paused: false,
      };
      expect(() => validateImmediateWithdrawal({ ...base, paused: true })).toThrow('paused');
      expect(() => validateImmediateWithdrawal({ ...base, amount: 1_000_001n })).toThrow('Treasury balance');
      expect(() => validateImmediateWithdrawal({ ...base, amount: 700_000n }))
        .toThrow('Use the strategy deallocation withdrawal path');
    });
  });

  it('rejects invalid recipients, policy limits, and insufficient balance', () => {
    expect(() => validateWithdrawal({ ...validInput, recipient: '0x0' })).toThrow('recipient');
    expect(() => validateWithdrawal({ ...validInput, amount: '1.000001' })).toThrow('maximum single');
    expect(() => validateWithdrawal({ ...validInput, rollingOutflow: 1_000_000n })).toThrow('24-hour');
    expect(() => validateWithdrawal({ ...validInput, treasuryBalance: 1_500_000n })).toThrow('minimum reserve');
  });
});