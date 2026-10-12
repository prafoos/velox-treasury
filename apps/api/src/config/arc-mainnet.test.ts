import { describe, expect, it } from 'vitest';
import {
  ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS,
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
  CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
  createArcMainnetExecutionConfig,
  createArcMainnetRuntimeConfig,
} from './arc-mainnet.js';
import { ARC_MAINNET_RETIRED_ADDRESSES } from '@velox/domain';

describe('Arc Mainnet runtime address configuration', () => {
  it('requires explicit final addresses instead of defaulting to current live references', () => {
    expect(() => createArcMainnetExecutionConfig({})).toThrow('explicitly configured with the final Core address');
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
    })).toThrow('explicitly configured with the final Adapter address');
  });

  it('initializes local API reads with the existing Core and configured Adapter in read-only mode', () => {
    const config = createArcMainnetRuntimeConfig({ NODE_ENV: 'development' });
    expect(config.mode).toBe('READ_ONLY_REFERENCE');
    expect(config.coreAddress).toBe(APPROVED_ARC_MAINNET_CORE_ADDRESS);
    expect(config.steakhouseAdapterAddress).toBe('0x915E6ff43b4a0A8681bB7F646047873771D5798c');
    expect(config.steakhouseAdapterAddress).toBe(ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS);
  });

  it('uses the explicitly configured web Core for local read-only API projections', () => {
    const config = createArcMainnetRuntimeConfig({
      NODE_ENV: 'development',
      VITE_ARC_MAINNET_CORE_ADDRESS: APPROVED_ARC_MAINNET_CORE_ADDRESS,
    });
    expect(config.mode).toBe('READ_ONLY_REFERENCE');
    expect(config.coreAddress).toBe(APPROVED_ARC_MAINNET_CORE_ADDRESS);
    expect(config.steakhouseAdapterAddress).toBe(ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS);
  });

  it('rejects invalid or retired web Core configuration', () => {
    expect(() => createArcMainnetRuntimeConfig({
      NODE_ENV: 'development',
      VITE_ARC_MAINNET_CORE_ADDRESS: 'invalid',
    })).toThrow('valid non-zero Arc Mainnet address');
    expect(() => createArcMainnetRuntimeConfig({
      NODE_ENV: 'development',
      VITE_ARC_MAINNET_CORE_ADDRESS: ARC_MAINNET_RETIRED_ADDRESSES.core,
    })).toThrow('valid non-zero Arc Mainnet address');
  });

  it('rejects mismatched API and web Core configuration', () => {
    expect(() => createArcMainnetRuntimeConfig({
      NODE_ENV: 'development',
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
      VITE_ARC_MAINNET_CORE_ADDRESS: APPROVED_ARC_MAINNET_CORE_ADDRESS,
    })).toThrow('API Core address must match VITE_ARC_MAINNET_CORE_ADDRESS');
  });

  it('does not use local reference mode when either explicit runtime address is supplied', () => {
    expect(() => createArcMainnetRuntimeConfig({
      NODE_ENV: 'development',
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
    })).toThrow('final Adapter address');
  });

  it('accepts the approved current Core and rejects the current Adapter reference as an execution target', () => {
    expect(createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: APPROVED_ARC_MAINNET_CORE_ADDRESS,
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    }).coreAddress).toBe(APPROVED_ARC_MAINNET_CORE_ADDRESS);
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: APPROVED_ARC_MAINNET_CORE_ADDRESS,
      STEAKHOUSE_ADAPTER_ADDRESS: CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
    })).toThrow('current live reference');
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    })).toThrow('approved current Arc Mainnet Core');
  });

  it('rejects an unapproved Core while accepting the approved Core and explicit Adapter value', () => {
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    })).toThrow('approved current Arc Mainnet Core');
    const config = createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: APPROVED_ARC_MAINNET_CORE_ADDRESS,
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    });
    expect(config.coreAddress).toBe(APPROVED_ARC_MAINNET_CORE_ADDRESS);
    expect(config.steakhouseAdapterAddress).toBe('0x2222222222222222222222222222222222222222');
  });

  it('rejects malformed and zero address overrides', () => {
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: 'bad',
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    })).toThrow('coreAddress');
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
      STEAKHOUSE_ADAPTER_ADDRESS: '0x0000000000000000000000000000000000000000',
    })).toThrow('steakhouseAdapterAddress');
  });

  it('rejects retired Core and Adapter overrides', () => {
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: ARC_MAINNET_RETIRED_ADDRESSES.core,
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    })).toThrow('coreAddress');
    expect(() => createArcMainnetExecutionConfig({
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
      STEAKHOUSE_ADAPTER_ADDRESS: ARC_MAINNET_RETIRED_ADDRESSES.adapter,
    })).toThrow('steakhouseAdapterAddress');
  });

  it('requires final Core and Adapter addresses explicitly in production mode', () => {
    expect(() => createArcMainnetExecutionConfig({ NODE_ENV: 'production' })).toThrow('final Core address');
    expect(() => createArcMainnetExecutionConfig({
      NODE_ENV: 'production',
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
    })).toThrow('final Adapter address');
    expect(() => createArcMainnetExecutionConfig({
      NODE_ENV: 'production',
      VELIX_TREASURY_CORE_ADDRESS: APPROVED_ARC_MAINNET_CORE_ADDRESS,
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    })).not.toThrow();
    expect(() => createArcMainnetExecutionConfig({
      NODE_ENV: 'production',
      VELIX_TREASURY_CORE_ADDRESS: APPROVED_ARC_MAINNET_CORE_ADDRESS,
      STEAKHOUSE_ADAPTER_ADDRESS: CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
    })).toThrow('current live reference');
    expect(() => createArcMainnetRuntimeConfig({
      NODE_ENV: 'production',
      VELIX_TREASURY_CORE_ADDRESS: ARC_MAINNET_RETIRED_ADDRESSES.core,
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    })).toThrow('coreAddress');
    expect(() => createArcMainnetRuntimeConfig({
      NODE_ENV: 'production',
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
      STEAKHOUSE_ADAPTER_ADDRESS: ARC_MAINNET_RETIRED_ADDRESSES.adapter,
    })).toThrow('steakhouseAdapterAddress');
    expect(() => createArcMainnetExecutionConfig({
      NODE_ENV: 'production',
      VELIX_TREASURY_CORE_ADDRESS: '0x1111111111111111111111111111111111111111',
      STEAKHOUSE_ADAPTER_ADDRESS: '0x2222222222222222222222222222222222222222',
    })).toThrow('approved current Arc Mainnet Core');
  });
});