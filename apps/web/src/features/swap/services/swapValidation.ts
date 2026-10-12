import { formatUnits, isAddress, parseUnits } from 'viem';

import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import type { SwapToken } from '../types';

const MAX_SLIPPAGE_BPS = 1_000n;

export interface AmountValidationResult {
  readonly amount: bigint | null;
  readonly error?: string;
}

export function parseSwapAmount(value: string, decimals: number): AmountValidationResult {
  if (!value.trim()) return { amount: null, error: 'Enter an amount.' };
  const normalized = value.trim();
  const decimalPart = normalized.split('.')[1] ?? '';
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || decimalPart.length > decimals) {
    return { amount: null, error: `Enter a valid amount with up to ${decimals} decimals.` };
  }
  try {
    const amount = parseUnits(normalized, decimals);
    return amount > 0n ? { amount } : { amount: null, error: 'Amount must be greater than zero.' };
  } catch {
    return { amount: null, error: `Enter a valid amount with up to ${decimals} decimals.` };
  }
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}

export function validateSwapTokens(tokenIn: SwapToken, tokenOut: SwapToken): void {
  for (const token of [tokenIn, tokenOut]) {
    if (!isAddress(token.address)) throw new Error('Token address is invalid.');
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 77) throw new Error('Token decimals are invalid.');
  }
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) throw new Error('Input and output tokens must be different.');
}

export function validateSwapInput(input: { tokenIn: SwapToken; tokenOut: SwapToken; amountIn: bigint; slippageBps: bigint; chainId: number }): void {
  if (input.chainId !== ARC_MAINNET_CHAIN_ID) throw new Error('Swaps require Arc Mainnet (chain ID 5042).');
  validateSwapTokens(input.tokenIn, input.tokenOut);
  if (input.amountIn <= 0n) throw new Error('Swap amount must be greater than zero.');
  if (input.slippageBps < 0n || input.slippageBps > MAX_SLIPPAGE_BPS) throw new Error('Slippage must be between 0 and 10%.');
}

export function validateSwapBalance(amountIn: bigint, balance: bigint | null): void {
  if (balance === null) throw new Error('Wallet balance is unavailable.');
  if (amountIn > balance) throw new Error('Swap amount exceeds wallet balance.');
}

export function sameSwapToken(tokenIn: SwapToken, tokenOut: SwapToken): boolean {
  return tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase();
}
