import { isAddress, ZeroAddress } from 'ethers';
import { CURRENT_LIVE_ARC_MAINNET_REFERENCES, isRetiredArcMainnetAddress } from './address-safety';

export const ARC_MAINNET_STEAKHOUSE_ADAPTER_NETWORK = 'arcMainnet' as const;
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_CHAIN_ID = 5_042n;
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_RPC = 'https://rpc.mainnet.arc.io';
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_EXPLORER = 'https://explorer.arc.io';
export const CURRENT_LIVE_CORE_REFERENCE = CURRENT_LIVE_ARC_MAINNET_REFERENCES.core;
export const CURRENT_LIVE_ADAPTER_REFERENCE = CURRENT_LIVE_ARC_MAINNET_REFERENCES.adapter;
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_USDC = '0x3600000000000000000000000000000000000000';
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_VAULT = '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298';
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_PROTOCOL_ID = '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450';

export type AdapterCorePurpose = 'PRODUCTION' | 'REFERENCE';

export type ArcMainnetSteakhouseAdapterDeploymentConfig = {
  readonly network: typeof ARC_MAINNET_STEAKHOUSE_ADAPTER_NETWORK;
  readonly chainId: bigint;
  readonly rpcUrl: typeof ARC_MAINNET_STEAKHOUSE_ADAPTER_RPC;
  readonly explorerUrl: typeof ARC_MAINNET_STEAKHOUSE_ADAPTER_EXPLORER;
  readonly purpose: AdapterCorePurpose;
  readonly vault: string;
  readonly core: string;
  readonly protocolId: string;
  readonly usdc: string;
  readonly constructorArgs: readonly [string, string, string, string];
};

export function createArcMainnetSteakhouseAdapterDeploymentConfig(input: {
  readonly coreAddress: string | undefined;
  readonly purpose?: AdapterCorePurpose;
}): ArcMainnetSteakhouseAdapterDeploymentConfig {
  if (!input.coreAddress?.trim()) {
    throw new Error('ARC_MAINNET_FINAL_CORE_ADDRESS is required; no Core address fallback is configured.');
  }

  const purpose = input.purpose ?? 'PRODUCTION';
  return validateArcMainnetSteakhouseAdapterDeploymentConfig({
    network: ARC_MAINNET_STEAKHOUSE_ADAPTER_NETWORK,
    chainId: ARC_MAINNET_STEAKHOUSE_ADAPTER_CHAIN_ID,
    rpcUrl: ARC_MAINNET_STEAKHOUSE_ADAPTER_RPC,
    explorerUrl: ARC_MAINNET_STEAKHOUSE_ADAPTER_EXPLORER,
    purpose,
    vault: ARC_MAINNET_STEAKHOUSE_ADAPTER_VAULT,
    core: input.coreAddress.trim(),
    protocolId: ARC_MAINNET_STEAKHOUSE_ADAPTER_PROTOCOL_ID,
    usdc: ARC_MAINNET_STEAKHOUSE_ADAPTER_USDC,
    constructorArgs: [
      ARC_MAINNET_STEAKHOUSE_ADAPTER_VAULT,
      input.coreAddress.trim(),
      ARC_MAINNET_STEAKHOUSE_ADAPTER_PROTOCOL_ID,
      ARC_MAINNET_STEAKHOUSE_ADAPTER_USDC,
    ],
  });
}

export function loadArcMainnetSteakhouseAdapterDeploymentConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ArcMainnetSteakhouseAdapterDeploymentConfig {
  return createArcMainnetSteakhouseAdapterDeploymentConfig({
    coreAddress: environment.ARC_MAINNET_FINAL_CORE_ADDRESS,
    purpose: 'PRODUCTION',
  });
}

export function validateArcMainnetSteakhouseAdapterDeploymentConfig(
  config: ArcMainnetSteakhouseAdapterDeploymentConfig,
): ArcMainnetSteakhouseAdapterDeploymentConfig {
  if (config.network !== ARC_MAINNET_STEAKHOUSE_ADAPTER_NETWORK) {
    throw new Error('Steakhouse adapter deployment requires Arc Mainnet.');
  }
  if (config.chainId !== ARC_MAINNET_STEAKHOUSE_ADAPTER_CHAIN_ID) {
    throw new Error('Steakhouse adapter deployment requires chain ID 5042.');
  }
  if (config.rpcUrl !== ARC_MAINNET_STEAKHOUSE_ADAPTER_RPC) {
    throw new Error('Steakhouse adapter deployment requires the official Arc Mainnet RPC URL.');
  }
  if (config.explorerUrl !== ARC_MAINNET_STEAKHOUSE_ADAPTER_EXPLORER) {
    throw new Error('Steakhouse adapter deployment requires the official Arc Mainnet explorer URL.');
  }
  if (config.purpose !== 'PRODUCTION' && config.purpose !== 'REFERENCE') {
    throw new Error('Steakhouse adapter Core purpose must be PRODUCTION or REFERENCE.');
  }

  for (const [name, address] of Object.entries({ vault: config.vault, core: config.core, usdc: config.usdc })) {
    if (!isAddress(address) || address.toLowerCase() === ZeroAddress.toLowerCase()) {
      throw new Error(`Invalid or missing ${name} address: ${address}`);
    }
  }
  if (isRetiredArcMainnetAddress(config.core)) throw new Error('A retired deployment address cannot be an Adapter Core target.');
  if (config.purpose === 'PRODUCTION' && config.core.toLowerCase() === CURRENT_LIVE_CORE_REFERENCE.toLowerCase()) {
    throw new Error('The current live Core is reference-only; production requires the explicit future final Core address.');
  }

  if (config.vault.toLowerCase() !== ARC_MAINNET_STEAKHOUSE_ADAPTER_VAULT.toLowerCase()) {
    throw new Error('Vault address does not match the verified Steakhouse Prime USDC vault.');
  }
  if (config.usdc.toLowerCase() !== ARC_MAINNET_STEAKHOUSE_ADAPTER_USDC.toLowerCase()) {
    throw new Error('USDC address does not match the official Arc Mainnet USDC.');
  }
  if (config.protocolId.toLowerCase() !== ARC_MAINNET_STEAKHOUSE_ADAPTER_PROTOCOL_ID.toLowerCase()) {
    throw new Error('Protocol ID does not match the deterministic Steakhouse protocol identity.');
  }

  const expectedArgs = [config.vault, config.core, config.protocolId, config.usdc].map((value) => value.toLowerCase());
  if (config.constructorArgs.length !== 4 || config.constructorArgs.some((value, index) => value.toLowerCase() !== expectedArgs[index])) {
    throw new Error('SteakhousePrimeUSDCAdapter constructor arguments do not match the validated Arc Mainnet configuration.');
  }

  return config;
}

export type AdapterDeploymentReadback = {
  readonly core: string;
  readonly asset: string;
  readonly vault: string;
  readonly protocolId: string;
};

export function assertAdapterDeploymentReadbackMatchesConfig(
  config: ArcMainnetSteakhouseAdapterDeploymentConfig,
  readback: AdapterDeploymentReadback,
): void {
  if (readback.core.toLowerCase() !== config.core.toLowerCase()) throw new Error('Adapter immutable Core does not match the supplied final Core.');
  if (readback.asset.toLowerCase() !== config.usdc.toLowerCase()) throw new Error('Adapter USDC readback mismatch.');
  if (readback.vault.toLowerCase() !== config.vault.toLowerCase()) throw new Error('Adapter vault readback mismatch.');
  if (readback.protocolId.toLowerCase() !== config.protocolId.toLowerCase()) throw new Error('Adapter protocol ID readback mismatch.');
}