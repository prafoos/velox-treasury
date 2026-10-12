import { formatUnits, isAddress, parseUnits } from 'viem';

import {
  ARC_MAINNET_CHAIN_ID,
  ARC_USDC_CONTRACT_ADDRESS,
  ARC_USDC_DECIMALS,
  ARC_USDC_NAME,
  ARC_USDC_SYMBOL,
} from '../../../contracts/usdc';
import type {
  FormatUSDCOptions,
  TokenBalanceDescriptor,
  USDCTokenMetadata,
} from '../types';

/**
 * Returns static verified metadata for Native USDC on Arc Mainnet.
 */
export function getUSDCTokenMetadata(): USDCTokenMetadata {
  return {
    address: ARC_USDC_CONTRACT_ADDRESS,
    chainId: ARC_MAINNET_CHAIN_ID,
    symbol: ARC_USDC_SYMBOL,
    name: ARC_USDC_NAME,
    decimals: ARC_USDC_DECIMALS,
  };
}

/**
 * Validates that the active chain is Arc Mainnet (5042).
 */
export function validateArcNetwork(chainId: number | undefined): boolean {
  return chainId === ARC_MAINNET_CHAIN_ID;
}

/**
 * Validates that an address matches the verified native Arc USDC contract address.
 */
export function validateUSDCAddress(address: string | undefined): boolean {
  if (!address || !isAddress(address)) {
    return false;
  }
  return address.toLowerCase() === ARC_USDC_CONTRACT_ADDRESS.toLowerCase();
}

/**
 * Formats a raw 6-decimal USDC bigint amount into a user-friendly string
 * using strict integer and string operations without floating-point arithmetic.
 *
 * Examples:
 * - 0n -> "0.00"
 * - 1000000n -> "1.00"
 * - 1234567890n -> "1,234.56789"
 * - null -> null
 */
export function formatUSDC(
  rawAmount: bigint | null,
  options?: FormatUSDCOptions,
): string | null {
  if (rawAmount === null || rawAmount === undefined) {
    return null;
  }

  const minDecimals = options?.minDecimals ?? 2;
  const maxDecimals = options?.maxDecimals ?? ARC_USDC_DECIMALS;
  const includeCommas = options?.includeCommas ?? true;

  if (rawAmount < 0n) {
    throw new Error('USDC amount cannot be negative');
  }

  // formatUnits produces e.g. "1234.56789" or "0" or "0.000001"
  const formatted = formatUnits(rawAmount, ARC_USDC_DECIMALS);
  const parts = formatted.split('.');
  const integerPart = parts[0] ?? '0';
  let fractionalPart = parts[1] ?? '';

  // Add commas to integer part using string regex (avoiding float formatting)
  const integerWithCommas = includeCommas
    ? integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : integerPart;

  // Trim to maxDecimals
  if (fractionalPart.length > maxDecimals) {
    fractionalPart = fractionalPart.slice(0, maxDecimals);
  }

  // Pad to minDecimals
  while (fractionalPart.length < minDecimals) {
    fractionalPart += '0';
  }

  return `${integerWithCommas}.${fractionalPart}`;
}

/**
 * Parses a decimal string representation of USDC into raw 6-decimal bigint.
 * Validates formatting and ensures no loss of precision.
 */
export function parseUSDC(displayAmount: string): bigint {
  const sanitized = displayAmount.replace(/,/g, '').trim();

  if (!sanitized) {
    throw new Error('Amount cannot be empty');
  }

  // Strict regex: integer or decimal with up to 6 decimal places
  if (!/^\d+(\.\d{1,6})?$/.test(sanitized)) {
    throw new Error(
      `Invalid USDC amount format: "${displayAmount}". Must be a non-negative number with up to 6 decimal places.`,
    );
  }

  return parseUnits(sanitized, ARC_USDC_DECIMALS);
}

export interface CreateUSDCDescriptorParams {
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
  readonly isLoading?: boolean;
  readonly error?: Error | string | null;
  readonly rawAmount?: bigint | null;
}

/**
 * Pure function that generates a strongly typed TokenBalanceDescriptor
 * based on wallet, network, and RPC states.
 * Guarantees that fake or speculative balances are never emitted.
 */
export function createUSDCBalanceDescriptor(
  params: CreateUSDCDescriptorParams,
): TokenBalanceDescriptor {
  const { isConnected, isArcMainnet, isLoading, error, rawAmount } = params;

  if (!isConnected) {
    return {
      symbol: ARC_USDC_SYMBOL,
      decimals: ARC_USDC_DECIMALS,
      rawAmount: null,
      formattedAmount: null,
      state: 'disconnected',
      message: 'Wallet not connected',
    };
  }

  if (!isArcMainnet) {
    return {
      symbol: ARC_USDC_SYMBOL,
      decimals: ARC_USDC_DECIMALS,
      rawAmount: null,
      formattedAmount: null,
      state: 'wrong_network',
      message: 'Switch to Arc Mainnet to view',
    };
  }

  if (isLoading) {
    return {
      symbol: ARC_USDC_SYMBOL,
      decimals: ARC_USDC_DECIMALS,
      rawAmount: null,
      formattedAmount: null,
      state: 'loading',
      message: 'Fetching USDC balance...',
    };
  }

  if (error) {
    const message =
      typeof error === 'string'
        ? error
        : error.message || 'Failed to read USDC balance from Arc Mainnet';

    return {
      symbol: ARC_USDC_SYMBOL,
      decimals: ARC_USDC_DECIMALS,
      rawAmount: null,
      formattedAmount: null,
      state: 'error',
      message,
    };
  }

  if (rawAmount !== undefined && rawAmount !== null) {
    return {
      symbol: ARC_USDC_SYMBOL,
      decimals: ARC_USDC_DECIMALS,
      rawAmount,
      formattedAmount: formatUSDC(rawAmount),
      state: 'synced',
      message: 'Live Arc Mainnet balance',
    };
  }

  return {
    symbol: ARC_USDC_SYMBOL,
    decimals: ARC_USDC_DECIMALS,
    rawAmount: null,
    formattedAmount: null,
    state: 'loading',
    message: 'Initializing USDC balance...',
  };
}
