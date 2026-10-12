export type UserBalanceChange = 'deposit' | 'withdrawal';

export async function confirmUserBalanceChange(input: {
  readonly previousBalance: bigint;
  readonly amount: bigint;
  readonly change: UserBalanceChange;
  readonly refresh: () => Promise<unknown>;
  readonly readCoreBalance: () => Promise<bigint>;
}): Promise<bigint> {
  if (input.amount <= 0n) throw new Error('Balance change amount must be greater than zero');

  const expectedBalance = input.change === 'deposit'
    ? input.previousBalance + input.amount
    : input.previousBalance - input.amount;
  if (expectedBalance < 0n) throw new Error('Expected Core user balance cannot be negative');

  await input.refresh();
  const actualBalance = await input.readCoreBalance();
  if (actualBalance !== expectedBalance) {
    throw new Error(
      `Treasury ${input.change} Core balance readback mismatch: expected ${expectedBalance}, received ${actualBalance}`,
    );
  }

  return actualBalance;
}
