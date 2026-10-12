import { describe, expect, it } from 'vitest';
import { ARC_MAINNET_RETIRED_ADDRESSES } from '@velox/domain';
import {
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
  CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
  resolveConfiguredMainnetAddress,
  resolveConfiguredMainnetCoreAddress,
} from './treasury';

const CONFIGURED_STEAKHOUSE_ADAPTER = '0x915E6ff43b4a0A8681bB7F646047873771D5798c' as const;

describe('Web Mainnet contract address configuration', () => {
  it('does not silently use a current live reference when no runtime override is supplied', () => {
    expect(resolveConfiguredMainnetCoreAddress(undefined)).toBeNull();
    expect(resolveConfiguredMainnetAddress(undefined, CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE, 'Adapter')).toBeNull();
    expect(() => resolveConfiguredMainnetAddress(
      CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
      CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
      'Adapter',
    )).toThrow('labeled read-only reference context');
  });

  it('accepts an explicit configured address', () => {
    expect(resolveConfiguredMainnetCoreAddress(APPROVED_ARC_MAINNET_CORE_ADDRESS))
      .toBe(APPROVED_ARC_MAINNET_CORE_ADDRESS);
  });

  it('accepts the configured Steakhouse Adapter address through the environment resolver', () => {
    expect(resolveConfiguredMainnetAddress(
      CONFIGURED_STEAKHOUSE_ADAPTER,
      CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
      'VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS',
    )).toBe(CONFIGURED_STEAKHOUSE_ADAPTER);
  });

  it('requires an explicit non-reference final address in production mode', () => {
    expect(() => resolveConfiguredMainnetCoreAddress(undefined, true))
      .toThrow('explicitly configured');
    expect(resolveConfiguredMainnetCoreAddress(APPROVED_ARC_MAINNET_CORE_ADDRESS, true))
      .toBe(APPROVED_ARC_MAINNET_CORE_ADDRESS);
    expect(() => resolveConfiguredMainnetAddress(
      undefined,
      CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
      'VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS',
      true,
    )).toThrow('explicitly configured');
    expect(() => resolveConfiguredMainnetAddress(
      CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
      CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
      'Adapter',
      true,
    )).toThrow('labeled read-only reference context');
  });

  it('rejects malformed and zero address overrides', () => {
    expect(() => resolveConfiguredMainnetCoreAddress('bad')).toThrow('approved non-retired');
    expect(() => resolveConfiguredMainnetCoreAddress('0x0000000000000000000000000000000000000000'))
      .toThrow('approved non-retired');
  });

  it('rejects every retired deployment address as the active Core', () => {
    for (const address of Object.values(ARC_MAINNET_RETIRED_ADDRESSES)) {
      expect(() => resolveConfiguredMainnetCoreAddress(address))
        .toThrow('approved non-retired');
    }
  });

  it('rejects a valid but unapproved Core address', () => {
    expect(() => resolveConfiguredMainnetCoreAddress('0x1111111111111111111111111111111111111111'))
      .toThrow('must match the approved current Arc Mainnet Core');
  });
});