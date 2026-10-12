import { describe, expect, it } from 'vitest';

import {
  createUSDCBalanceDescriptor,
  formatUSDC,
  getUSDCTokenMetadata,
  parseUSDC,
  validateArcNetwork,
  validateUSDCAddress,
} from './usdcService';

describe('usdcService', () => {
  describe('getUSDCTokenMetadata', () => {
    it('returns officially verified Arc Mainnet USDC metadata', () => {
      const metadata = getUSDCTokenMetadata();
      expect(metadata.address).toBe('0x3600000000000000000000000000000000000000');
      expect(metadata.chainId).toBe(5042);
      expect(metadata.symbol).toBe('USDC');
      expect(metadata.decimals).toBe(6);
    });
  });

  describe('validateArcNetwork', () => {
    it('returns true for Arc Mainnet (5042)', () => {
      expect(validateArcNetwork(5042)).toBe(true);
    });

    it('returns false for non-Arc chain IDs or undefined', () => {
      expect(validateArcNetwork(1)).toBe(false);
      expect(validateArcNetwork(5041)).toBe(false);
      expect(validateArcNetwork(undefined)).toBe(false);
    });
  });

  describe('validateUSDCAddress', () => {
    it('returns true for the verified native USDC address', () => {
      expect(validateUSDCAddress('0x3600000000000000000000000000000000000000')).toBe(true);
    });

    it('returns false for unverified, incorrect or malformed addresses', () => {
      expect(validateUSDCAddress('0x0000000000000000000000000000000000000000')).toBe(false);
      expect(validateUSDCAddress('0x1234')).toBe(false);
      expect(validateUSDCAddress(undefined)).toBe(false);
    });
  });

  describe('formatUSDC', () => {
    it('formats null or undefined to null without fabricating numbers', () => {
      expect(formatUSDC(null)).toBeNull();
    });

    it('formats 0n with standard 2 decimal padding', () => {
      expect(formatUSDC(0n)).toBe('0.00');
    });

    it('formats 1 USDC (1,000,000 units with 6 decimals)', () => {
      expect(formatUSDC(1_000_000n)).toBe('1.00');
    });

    it('formats fractional amounts precisely', () => {
      expect(formatUSDC(1_500_000n)).toBe('1.50');
      expect(formatUSDC(1n)).toBe('0.000001');
      expect(formatUSDC(123_456n)).toBe('0.123456');
    });

    it('formats large values with digit groupings', () => {
      // 1,234,567.89 USDC
      expect(formatUSDC(1_234_567_890_000n)).toBe('1,234,567.89');
    });

    it('respects formatting options without float loss', () => {
      expect(formatUSDC(1_000_000n, { minDecimals: 4 })).toBe('1.0000');
      expect(formatUSDC(1_234_567n, { maxDecimals: 2 })).toBe('1.23');
      expect(formatUSDC(1_000_000_000n, { includeCommas: false })).toBe('1000.00');
    });

    it('throws when passed negative amounts', () => {
      expect(() => formatUSDC(-1n)).toThrow('USDC amount cannot be negative');
    });
  });

  describe('parseUSDC', () => {
    it('parses valid integer USDC string', () => {
      expect(parseUSDC('1')).toBe(1_000_000n);
      expect(parseUSDC('100')).toBe(100_000_000n);
    });

    it('parses fractional USDC strings up to 6 decimals', () => {
      expect(parseUSDC('1.5')).toBe(1_500_000n);
      expect(parseUSDC('0.000001')).toBe(1n);
      expect(parseUSDC('1,000.25')).toBe(1_000_250_000n);
    });

    it('throws on invalid or excessively granular input', () => {
      expect(() => parseUSDC('')).toThrow();
      expect(() => parseUSDC('-5')).toThrow();
      expect(() => parseUSDC('1.1234567')).toThrow(); // 7 decimals
      expect(() => parseUSDC('abc')).toThrow();
    });
  });

  describe('createUSDCBalanceDescriptor', () => {
    it('creates disconnected descriptor when wallet is not connected', () => {
      const descriptor = createUSDCBalanceDescriptor({
        isConnected: false,
        isArcMainnet: false,
      });

      expect(descriptor.state).toBe('disconnected');
      expect(descriptor.rawAmount).toBeNull();
      expect(descriptor.formattedAmount).toBeNull();
      expect(descriptor.decimals).toBe(6);
      expect(descriptor.symbol).toBe('USDC');
      expect(descriptor.message).toBe('Wallet not connected');
    });

    it('creates wrong_network descriptor when connected to an unsupported chain', () => {
      const descriptor = createUSDCBalanceDescriptor({
        isConnected: true,
        isArcMainnet: false,
      });

      expect(descriptor.state).toBe('wrong_network');
      expect(descriptor.rawAmount).toBeNull();
      expect(descriptor.formattedAmount).toBeNull();
      expect(descriptor.decimals).toBe(6);
      expect(descriptor.message).toBe('Switch to Arc Mainnet to view');
    });

    it('creates loading descriptor when fetching balance on Arc Mainnet', () => {
      const descriptor = createUSDCBalanceDescriptor({
        isConnected: true,
        isArcMainnet: true,
        isLoading: true,
      });

      expect(descriptor.state).toBe('loading');
      expect(descriptor.rawAmount).toBeNull();
      expect(descriptor.formattedAmount).toBeNull();
      expect(descriptor.message).toBe('Fetching USDC balance...');
    });

    it('creates error descriptor when an RPC or contract read error occurs', () => {
      const descriptor = createUSDCBalanceDescriptor({
        isConnected: true,
        isArcMainnet: true,
        isLoading: false,
        error: new Error('RPC connection timeout'),
      });

      expect(descriptor.state).toBe('error');
      expect(descriptor.rawAmount).toBeNull();
      expect(descriptor.formattedAmount).toBeNull();
      expect(descriptor.message).toBe('RPC connection timeout');
    });

    it('creates synced descriptor with correct 6-decimal formatted amount', () => {
      const descriptor = createUSDCBalanceDescriptor({
        isConnected: true,
        isArcMainnet: true,
        isLoading: false,
        rawAmount: 25_500_000n, // 25.5 USDC
      });

      expect(descriptor.state).toBe('synced');
      expect(descriptor.rawAmount).toBe(25_500_000n);
      expect(descriptor.formattedAmount).toBe('25.50');
      expect(descriptor.decimals).toBe(6);
      expect(descriptor.symbol).toBe('USDC');
    });
  });
});
