import type { Hash } from 'viem';

export type SwapTransactionReceipt = { readonly status: 'success' | 'reverted' };
export type SwapExecutionStatus = 'IDLE' | 'SUBMITTED' | 'CONFIRMED' | 'REVERTED' | 'FAILED' | 'READBACK_FAILED';

export interface SwapExecutionBalances {
  readonly source: bigint;
  readonly destination: bigint;
}

export interface SwapExecutionState {
  readonly status: SwapExecutionStatus;
  readonly hash?: Hash;
}

export const swapBalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export async function approveAndRefreshAllowance(input: {
  readonly submit: () => Promise<Hash>;
  readonly waitForReceipt: (hash: Hash) => Promise<SwapTransactionReceipt>;
  readonly refetchAllowance: () => Promise<unknown>;
}): Promise<Hash> {
  const hash = await input.submit();
  const receipt = await input.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error('Token approval transaction reverted.');
  await input.refetchAllowance();
  return hash;
}

export async function executeSwapLifecycle(input: {
  readonly amountIn: bigint;
  readonly minimumAmountOut: bigint;
  readonly readBalances: () => Promise<SwapExecutionBalances>;
  readonly submit: () => Promise<Hash>;
  readonly waitForReceipt: (hash: Hash) => Promise<SwapTransactionReceipt>;
  readonly onStateChange: (state: SwapExecutionState) => void;
}): Promise<Hash> {
  let hash: Hash | undefined;
  const currentStatus: { value: SwapExecutionStatus } = { value: 'IDLE' };
  const updateStatus = (state: SwapExecutionState) => {
    currentStatus.value = state.status;
    input.onStateChange(state);
  };
  try {
    const balancesBefore = await input.readBalances();
    hash = await input.submit();
    updateStatus({ status: 'SUBMITTED', hash });

    const receipt = await input.waitForReceipt(hash);
    if (receipt.status !== 'success') {
      updateStatus({ status: 'REVERTED', hash });
      throw new Error('Swap transaction reverted.');
    }

    let balancesAfter: SwapExecutionBalances;
    try {
      balancesAfter = await input.readBalances();
    } catch (cause) {
      updateStatus({ status: 'READBACK_FAILED', hash });
      throw new Error('Swap transaction succeeded, but authoritative token balance readback failed.', { cause });
    }

    const sourceSpent = balancesBefore.source - balancesAfter.source;
    const destinationReceived = balancesAfter.destination - balancesBefore.destination;
    if (
      sourceSpent <= 0n
      || sourceSpent > input.amountIn
      || destinationReceived < input.minimumAmountOut
    ) {
      updateStatus({ status: 'READBACK_FAILED', hash });
      throw new Error('Swap transaction succeeded, but authoritative token balance changes did not match the executed swap.');
    }

    updateStatus({ status: 'CONFIRMED', hash });
    return hash;
  } catch (cause) {
    if (currentStatus.value !== 'REVERTED' && currentStatus.value !== 'READBACK_FAILED') {
      updateStatus({ status: 'FAILED', ...(hash ? { hash } : {}) });
    }
    throw cause;
  }
}
