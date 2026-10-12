import { isAddress, ZeroAddress } from 'ethers';
import { isRetiredArcMainnetAddress } from './address-safety';

const ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000';
const ARC_MAINNET_RPC = 'https://rpc.mainnet.arc.io';
const ARC_MAINNET_EXPLORER = 'https://explorer.arc.io';
const ARC_MAINNET_CHAIN_ID = 5_042;
const USDC = 10n ** 6n;
const LEGACY_DEPLOYMENT_OPT_IN = 'ALLOW_LEGACY_MAINNET_DEPLOYMENT';

export function assertLegacyMainnetDeploymentOptIn(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment[LEGACY_DEPLOYMENT_OPT_IN] !== '1') {
    throw new Error(`Refusing legacy VeloxTreasury Mainnet deployment. Set ${LEGACY_DEPLOYMENT_OPT_IN}=1 only for deliberate historical/test deployment use.`);
  }
}

export type ArcMainnetDeploymentConfig = {
  network: 'arc-mainnet';
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  usdc: { address: string; decimals: number; symbol: 'USDC' };
  roles: { governance: string; policyAdmin: string; pauser: string; withdrawer: string };
  constructor: { usdc: string; governance: string; policyAdmin: string; pauser: string; withdrawer: string };
  policy: {
    minimumLiquidReserve: bigint;
    surplusSweepThreshold: bigint;
    dailyOutflowCap: bigint;
    maximumSingleWithdrawal: bigint;
    automatedSweepEnabled: boolean;
  };
  allocations: {
    liquidOperationalReserveBps: number;
    yieldStrategyBufferBps: number;
    swapLiquidityBufferBps: number;
    automationAgentPoolBps: number;
  };
};

/**
 * Mainnet authority holders are intentionally required at execution time rather
 * than embedded in source control. Missing values fail validation before deploy.
 */
export function loadArcMainnetDeploymentConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ArcMainnetDeploymentConfig {
  const roles = {
    governance: environment.ARC_MAINNET_GOVERNANCE ?? ZeroAddress,
    policyAdmin: environment.ARC_MAINNET_POLICY_ADMIN ?? ZeroAddress,
    pauser: environment.ARC_MAINNET_PAUSER ?? ZeroAddress,
    withdrawer: environment.ARC_MAINNET_WITHDRAWER ?? ZeroAddress,
  };

  return validateArcMainnetDeploymentConfig({
    network: 'arc-mainnet',
    chainId: ARC_MAINNET_CHAIN_ID,
    rpcUrl: ARC_MAINNET_RPC,
    explorerUrl: ARC_MAINNET_EXPLORER,
    usdc: { address: ARC_MAINNET_USDC, decimals: 6, symbol: 'USDC' },
    roles,
    constructor: { usdc: ARC_MAINNET_USDC, ...roles },
    // Preserve the human-readable limits in USDC's six-decimal ERC-20 units.
    policy: {
      minimumLiquidReserve: 10n * USDC,
      surplusSweepThreshold: 50n * USDC,
      dailyOutflowCap: 100n * USDC,
      maximumSingleWithdrawal: 50n * USDC,
      automatedSweepEnabled: true,
    },
    allocations: {
      liquidOperationalReserveBps: 2500,
      yieldStrategyBufferBps: 2500,
      swapLiquidityBufferBps: 2500,
      automationAgentPoolBps: 2500,
    },
  });
}

export function validateArcMainnetDeploymentConfig(
  config: ArcMainnetDeploymentConfig,
): ArcMainnetDeploymentConfig {
  if (config.network !== 'arc-mainnet') throw new Error('Arc Mainnet deployment configuration requires arc-mainnet.');
  if (config.chainId !== ARC_MAINNET_CHAIN_ID) throw new Error('Arc Mainnet deployment configuration requires chain ID 5042.');
  if (config.rpcUrl !== ARC_MAINNET_RPC) throw new Error('Arc Mainnet deployment configuration requires the official Arc Mainnet RPC URL.');
  if (config.explorerUrl !== ARC_MAINNET_EXPLORER) throw new Error('Arc Mainnet deployment configuration requires the official Arc Mainnet explorer URL.');
  if (config.usdc.address !== ARC_MAINNET_USDC) throw new Error('Arc Mainnet deployment configuration requires the official Arc Mainnet USDC address.');
  if (config.usdc.decimals !== 6) throw new Error('Arc Mainnet deployment configuration requires 6-decimal ERC-20 USDC policy values.');

  for (const [role, holder] of Object.entries(config.roles)) {
    if (!isAddress(holder) || holder.toLowerCase() === ZeroAddress) {
      throw new Error(`Invalid Arc Mainnet deployment role holder: ${role}.`);
    }
    if (isRetiredArcMainnetAddress(holder)) throw new Error(`Retired deployment address cannot hold Mainnet role ${role}.`);
  }
  if (new Set(Object.values(config.roles).map((value) => value.toLowerCase())).size !== 4) {
    throw new Error('The four Arc Mainnet deployment role holders must be distinct.');
  }

  if (config.constructor.usdc !== config.usdc.address) throw new Error('Constructor USDC address mismatch.');
  if (
    config.constructor.governance !== config.roles.governance
    || config.constructor.policyAdmin !== config.roles.policyAdmin
    || config.constructor.pauser !== config.roles.pauser
    || config.constructor.withdrawer !== config.roles.withdrawer
  ) throw new Error('Constructor role order or values do not match the validated Mainnet role map.');

  if (config.policy.maximumSingleWithdrawal > config.policy.dailyOutflowCap) {
    throw new Error('The single withdrawal cap cannot exceed the daily outflow cap.');
  }
  if (config.policy.automatedSweepEnabled && config.policy.surplusSweepThreshold < config.policy.minimumLiquidReserve) {
    throw new Error('The sweep threshold cannot fall below the reserve while automation is enabled.');
  }

  const allocationTotal = config.allocations.liquidOperationalReserveBps
    + config.allocations.yieldStrategyBufferBps
    + config.allocations.swapLiquidityBufferBps
    + config.allocations.automationAgentPoolBps;
  if (allocationTotal !== 10_000) throw new Error('Arc Mainnet deployment allocations must total exactly 10000 bps.');

  return config;
}
