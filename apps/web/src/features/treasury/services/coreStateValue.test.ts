import { describe, expect, it } from 'vitest';

import { isUnavailable, normalizeBigIntArray, normalizeBigIntValue } from './coreStateValue';

describe('Core state value normalization', () => {
  it('parses numeric Core values without converting them to the wrong type', () => {
    expect(normalizeBigIntValue('123', null)).toBe(123n);
    expect(normalizeBigIntValue(0, null)).toBe(0n);
  });

  it('preserves unavailable values instead of calling BigInt on them', () => {
    const unavailable = {
      unavailable: true,
      functionName: 'userFinancialState',
      error: 'The contract function "userFinancialState" reverted.',
    };

    expect(isUnavailable(unavailable)).toBe(true);
    expect(() => normalizeBigIntValue(unavailable, null)).not.toThrow();
    expect(normalizeBigIntValue(unavailable, null)).toBeNull();
    expect(normalizeBigIntArray(unavailable)).toBeNull();
  });

  it('treats genuine zero as zero and not unavailable', () => {
    expect(normalizeBigIntValue('0', null)).toBe(0n);
    expect(normalizeBigIntValue(0n, null)).toBe(0n);
    expect(normalizeBigIntArray([0n, 1n, 2n])).toEqual([0n, 1n, 2n]);
    expect(normalizeBigIntArray([0n, null, 2n])).toBeNull();
  });
});
