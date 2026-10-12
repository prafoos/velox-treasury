import { isAddress, zeroAddress, type Address } from 'viem';

import { parseUSDC } from '../../usdc/services/usdcService';

export interface WithdrawalPolicyLimits {
  readonly minimumLiquidReserve: bigint;
  readonly dailyOutflowCap: bigint;
  readonly maximumSingleWithdrawal: bigint;
}

export interface WithdrawalValidationInput {
  readonly recipient: string;
  readonly amount: string;
  readonly policy: WithdrawalPolicyLimits;
  readonly treasuryBalance: bigint;
  readonly rollingOutflow: bigint;
}

export interface ValidatedWithdrawal {
  readonly recipient: Address;
  readonly amount: bigint;
}

export interface ImmediateWithdrawalPreflight {
  readonly amount: bigint;
  readonly userBalance: bigint;
  readonly immediatelyWithdrawableValue: bigint;
  readonly paused: boolean;
}

export interface ImmediateWithdrawalCallInput extends ImmediateWithdrawalPreflight {
  readonly recipient: string;
  readonly walletAddress: string;
}

export function buildImmediateWithdrawalCall(
  input: ImmediateWithdrawalCallInput,
): { readonly functionName: 'withdraw'; readonly args: readonly [bigint, Address] } {
  if (!isAddress(input.recipient) || input.recipient.toLowerCase() === zeroAddress) {
    throw new Error('Enter a valid non-zero recipient address');
  }
  if (!isAddress(input.walletAddress) || input.recipient.toLowerCase() !== input.walletAddress.toLowerCase()) {
    throw new Error('Withdrawal recipient must match the connected wallet');
  }
  validateImmediateWithdrawal(input);
  return { functionName: 'withdraw', args: [input.amount, input.recipient] };
}

export function validateImmediateWithdrawal(input: ImmediateWithdrawalPreflight): void {
  if (input.paused) throw new Error('Treasury withdrawals are paused.');
  if (input.amount > input.userBalance) throw new Error('Withdrawal exceeds your Treasury balance');
  if (input.amount > input.immediatelyWithdrawableValue) {
    throw new Error('Withdrawal exceeds immediately withdrawable USDC. Use the strategy deallocation withdrawal path; no transaction was submitted.');
  }
}

export function validateWithdrawal(input: WithdrawalValidationInput): ValidatedWithdrawal {
  if (!isAddress(input.recipient) || input.recipient.toLowerCase() === zeroAddress) {
    throw new Error('Enter a valid non-zero recipient address');
  }

  let amount: bigint;
  try {
    amount = parseUSDC(input.amount);
  } catch {
    throw new Error('Enter a valid USDC amount with up to 6 decimal places');
  }
  if (amount <= 0n) throw new Error('Enter a USDC amount greater than zero');
  if (amount > input.policy.maximumSingleWithdrawal) {
    throw new Error('Withdrawal exceeds the maximum single withdrawal policy');
  }

  const remainingDailyCapacity = input.policy.dailyOutflowCap > input.rollingOutflow
    ? input.policy.dailyOutflowCap - input.rollingOutflow
    : 0n;
  if (amount > remainingDailyCapacity) {
    throw new Error('Withdrawal exceeds the remaining 24-hour outflow policy capacity');
  }
  if (amount > input.treasuryBalance) throw new Error('Treasury USDC balance is insufficient');
  if (input.treasuryBalance - amount < input.policy.minimumLiquidReserve) {
    throw new Error('Withdrawal would breach the Treasury minimum reserve policy');
  }

  return { recipient: input.recipient as Address, amount };
}