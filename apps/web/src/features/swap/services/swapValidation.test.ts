import { describe, expect, it } from 'vitest';

import { parseSwapAmount, sameSwapToken, validateSwapBalance, validateSwapInput } from './swapValidation';

const tokenIn = { address: '0x1111111111111111111111111111111111111111' as const, symbol: 'IN', decimals: 6 };
const tokenOut = { address: '0x2222222222222222222222222222222222222222' as const, symbol: 'OUT', decimals: 18 };
const input = { tokenIn, tokenOut, amountIn: 100n, slippageBps: 50n, chainId: 5042, nowSeconds: 100n };

describe('swapValidation', () => {
  it('accepts valid Arc Mainnet input', () => expect(() => validateSwapInput(input)).not.toThrow());
  it('rejects identical tokens and accepts the two configured directions', () => {
    expect(sameSwapToken(tokenIn, tokenIn)).toBe(true);
    expect(sameSwapToken(tokenIn, tokenOut)).toBe(false);
    expect(() => validateSwapInput({ ...input, tokenOut: tokenIn })).toThrow('different');
  });
  it('rejects wrong chain, non-positive amounts, invalid decimals, and excessive slippage', () => {
    expect(() => validateSwapInput({ ...input, chainId: 1 })).toThrow('Arc Mainnet');
    expect(() => validateSwapInput({ ...input, amountIn: 0n })).toThrow('greater than zero');
    expect(() => validateSwapInput({ ...input, slippageBps: 1_001n })).toThrow('between 0 and 10%');
    expect(() => validateSwapInput({ ...input, tokenOut: { ...tokenOut, decimals: 78 } })).toThrow('decimals');
  });
  it('rejects insufficient or unavailable balances', () => {
    expect(() => validateSwapBalance(101n, 100n)).toThrow('exceeds wallet balance');
    expect(() => validateSwapBalance(1n, null)).toThrow('unavailable');
  });
  it('parses exact token decimals without floating point', () => {
    expect(parseSwapAmount('1.123456', 6).amount).toBe(1_123_456n);
    expect(parseSwapAmount('1.1234567', 6).error).toContain('6 decimals');
    expect(parseSwapAmount('-1', 6).error).toContain('valid amount');
    expect(parseSwapAmount('0', 6).error).toContain('greater than zero');
  });
});
