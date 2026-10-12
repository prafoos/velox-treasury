import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { getAddress, isAddress, zeroAddress, type Address } from 'viem';
import {
  ARC_MAINNET_CURRENT_LIVE_REFERENCES,
  isRetiredArcMainnetAddress,
} from '@velox/domain';

loadEnv();
try {
  const configDirectory = dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: resolve(configDirectory, '../../../web/.env') });
  if (process.env.NODE_ENV !== 'test') {
    loadEnv({ path: resolve(configDirectory, '../../../web/.env.local') });
  }
  loadEnv({ path: resolve(configDirectory, '../../.env') });
} catch {
  // Ignore fallback loading errors.
}

export const APPROVED_ARC_MAINNET_CORE_ADDRESS = ARC_MAINNET_CURRENT_LIVE_REFERENCES.core;
export const CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE = ARC_MAINNET_CURRENT_LIVE_REFERENCES.adapter;
export const ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS =
  '0x915E6ff43b4a0A8681bB7F646047873771D5798c' as const;
export const ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS = '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298' as const;

export type ArcMainnetExecutionConfig = {
  readonly chainId: 5042;
  readonly coreAddress: Address;
  readonly steakhouseAdapterAddress: Address;
  readonly usdcAddress: '0x3600000000000000000000000000000000000000';
  readonly protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450';
  readonly mode: 'FINAL_DEPLOYMENT' | 'READ_ONLY_REFERENCE';
};

function isProduction(environment: NodeJS.ProcessEnv): boolean {
  return environment.NODE_ENV === 'production' || environment.VERCEL_ENV === 'production';
}

export function createArcMainnetExecutionConfig(environment: NodeJS.ProcessEnv = process.env): ArcMainnetExecutionConfig {
  const configuredCoreAddress = environment.VELIX_TREASURY_CORE_ADDRESS?.trim();
  const configuredAdapterAddress = environment.STEAKHOUSE_ADAPTER_ADDRESS?.trim();
  if (!configuredCoreAddress) {
    throw new Error('VELIX_TREASURY_CORE_ADDRESS must be explicitly configured with the final Core address.');
  }
  if (!configuredAdapterAddress) {
    throw new Error('STEAKHOUSE_ADAPTER_ADDRESS must be explicitly configured with the final Adapter address.');
  }
  const coreAddress = configuredCoreAddress;
  const steakhouseAdapterAddress = configuredAdapterAddress;
  for (const [name, address] of Object.entries({ coreAddress, steakhouseAdapterAddress })) {
    if (!isAddress(address) || address.toLowerCase() === zeroAddress.toLowerCase() || isRetiredArcMainnetAddress(address)) {
      throw new Error(`${name} must be a valid non-zero Arc Mainnet address.`);
    }
  }
  if (coreAddress.toLowerCase() !== APPROVED_ARC_MAINNET_CORE_ADDRESS.toLowerCase()) {
    throw new Error('Core runtime must target the approved current Arc Mainnet Core.');
  }
  if (steakhouseAdapterAddress.toLowerCase() === CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE.toLowerCase()) {
    throw new Error('Adapter runtime cannot target the current live reference; use a labeled read-only reference context.');
  }

  return {
    chainId: 5042,
    coreAddress: coreAddress as Address,
    steakhouseAdapterAddress: steakhouseAdapterAddress as Address,
    usdcAddress: '0x3600000000000000000000000000000000000000',
    protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
    mode: 'FINAL_DEPLOYMENT',
  } as const;
}

export function createArcMainnetRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): ArcMainnetExecutionConfig {
  const hasCore = Boolean(environment.VELIX_TREASURY_CORE_ADDRESS?.trim());
  const hasAdapter = Boolean(environment.STEAKHOUSE_ADAPTER_ADDRESS?.trim());
  const configuredWebCoreAddress = environment.VITE_ARC_MAINNET_CORE_ADDRESS?.trim();
  const configuredCoreAddress = environment.VELIX_TREASURY_CORE_ADDRESS?.trim();
  if (configuredCoreAddress && configuredWebCoreAddress
    && configuredCoreAddress.toLowerCase() !== configuredWebCoreAddress.toLowerCase()) {
    throw new Error('The API Core address must match VITE_ARC_MAINNET_CORE_ADDRESS.');
  }
  if (hasCore || hasAdapter || isProduction(environment)) return createArcMainnetExecutionConfig(environment);

  if (configuredWebCoreAddress) {
    if (!isAddress(configuredWebCoreAddress)
      || configuredWebCoreAddress.toLowerCase() === zeroAddress
      || isRetiredArcMainnetAddress(configuredWebCoreAddress)) {
      throw new Error('VITE_ARC_MAINNET_CORE_ADDRESS must be a valid non-zero Arc Mainnet address.');
    }
    if (configuredWebCoreAddress.toLowerCase() !== APPROVED_ARC_MAINNET_CORE_ADDRESS.toLowerCase()) {
      throw new Error('VITE_ARC_MAINNET_CORE_ADDRESS must match the approved current Arc Mainnet Core.');
    }
    return {
      chainId: 5042,
      coreAddress: getAddress(configuredWebCoreAddress),
      steakhouseAdapterAddress: ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS,
      usdcAddress: '0x3600000000000000000000000000000000000000',
      protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
      mode: 'READ_ONLY_REFERENCE',
    } as const;
  }

  return {
    chainId: 5042,
    coreAddress: APPROVED_ARC_MAINNET_CORE_ADDRESS,
    steakhouseAdapterAddress: ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS,
    usdcAddress: '0x3600000000000000000000000000000000000000',
    protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
    mode: 'READ_ONLY_REFERENCE',
  };
}

export const ARC_MAINNET_EXECUTION_CONFIG = {
  ...createArcMainnetRuntimeConfig(),
};
