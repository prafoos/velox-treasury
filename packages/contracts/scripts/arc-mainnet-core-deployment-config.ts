import { isAddress, ZeroAddress } from 'ethers';
import { isRetiredArcMainnetAddress, RETIRED_TREASURY_ADDRESS } from './address-safety.js';
import { ARC_MAINNET_CORE_ROLE_HOLDERS } from '../../../packages/domain/src/treasury-addresses.js';
export { RETIRED_TREASURY_ADDRESS } from './address-safety.js';
export { ARC_MAINNET_CORE_ROLE_HOLDERS };

export const ARC_MAINNET_CORE_NETWORK = 'arcMainnet' as const;
export const ARC_MAINNET_CORE_CHAIN_ID = 5_042n;
export const ARC_MAINNET_CORE_RPC = 'https://rpc.mainnet.arc.io';
export const ARC_MAINNET_CORE_EXPLORER = 'https://explorer.arc.io';
export const ARC_MAINNET_CORE_USDC = '0x3600000000000000000000000000000000000000';
export const ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV = 'ARC_MAINNET_CORE_VALUATION_FRESHNESS_BLOCKS';
export const ARC_MAINNET_CORE_TIMELOCK_DELAY_SECONDS = 2n * 24n * 60n * 60n;
const DEFAULT_INITIAL_RISK_POLICY = {
  minimumLiquidReserve: 0n,
  minimumLiquidReserveBps: 1_000,
  maximumTotalDeployed: 5_000_000_000_000n,
} as const;
const DEFAULT_VALUATION_FRESHNESS_BLOCKS = 1_200n;
export const ARC_MAINNET_CORE_INITIAL_POLICY_ENV = {
  minimumLiquidReserve: 'ARC_MAINNET_CORE_MINIMUM_LIQUID_RESERVE',
  minimumLiquidReserveBps: 'ARC_MAINNET_CORE_MINIMUM_LIQUID_RESERVE_BPS',
  maximumTotalDeployed: 'ARC_MAINNET_CORE_MAXIMUM_TOTAL_DEPLOYED',
  liquidOperationalReserveBps: 'ARC_MAINNET_CORE_BUCKET_LIQUID_OPERATIONAL_RESERVE_BPS',
  yieldStrategyBufferBps: 'ARC_MAINNET_CORE_BUCKET_YIELD_STRATEGY_BUFFER_BPS',
  sweepLiquidityBufferBps: 'ARC_MAINNET_CORE_BUCKET_SWEEP_LIQUIDITY_BUFFER_BPS',
  automationAgentPoolBps: 'ARC_MAINNET_CORE_BUCKET_AUTOMATION_AGENT_POOL_BPS',
} as const;
const MAX_UINT256 = (1n << 256n) - 1n;

export type PolicyConfigurationValue<T> =
  | { readonly status: 'CONFIGURED'; readonly value: T }
  | { readonly status: 'UNAVAILABLE'; readonly reason: string };

export type ExposureCapConfiguration = {
  readonly absoluteCap: bigint;
  readonly relativeCapBps: number;
};

export type InitialPolicyAssessment = {
  readonly status: 'CONFIGURED' | 'UNAVAILABLE' | 'INVALID';
  readonly unavailable: readonly string[];
  readonly invalid: readonly string[];
};

export type ArcMainnetCoreDeploymentConfig = {
  readonly network: typeof ARC_MAINNET_CORE_NETWORK;
  readonly chainId: bigint;
  readonly rpcUrl: typeof ARC_MAINNET_CORE_RPC;
  readonly explorerUrl: typeof ARC_MAINNET_CORE_EXPLORER;
  readonly usdc: typeof ARC_MAINNET_CORE_USDC;
  readonly roles: {
    readonly governance: string;
    readonly policyAdmin: string;
    readonly timelockExecutor: string;
    readonly automationExecutor: string;
    readonly emergency: string;
  };
  readonly roleConstructorArgs: readonly [string, string, string, string, string, string];
  readonly initialState: {
    readonly minimumLiquidReserve: PolicyConfigurationValue<bigint>;
    readonly minimumLiquidReserveBps: PolicyConfigurationValue<number>;
    readonly maximumTotalDeployed: PolicyConfigurationValue<bigint>;
    readonly timelockDelay: PolicyConfigurationValue<bigint>;
    readonly bucketPolicy: {
      readonly liquidOperationalReserveBps: PolicyConfigurationValue<number>;
      readonly yieldStrategyBufferBps: PolicyConfigurationValue<number>;
      readonly sweepLiquidityBufferBps: PolicyConfigurationValue<number>;
      readonly automationAgentPoolBps: PolicyConfigurationValue<number>;
    };
    readonly valuationFreshnessBlocks: PolicyConfigurationValue<bigint>;
    readonly exposureCaps: {
      readonly strategy: PolicyConfigurationValue<ExposureCapConfiguration>;
      readonly protocol: PolicyConfigurationValue<ExposureCapConfiguration>;
      readonly asset: PolicyConfigurationValue<ExposureCapConfiguration>;
    };
  };
};

function configuredBigInt(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue?: bigint,
): PolicyConfigurationValue<bigint> {
  const input = environment[name]?.trim();
  if (!input) {
    return defaultValue === undefined
      ? { status: 'UNAVAILABLE', reason: `Explicit Admin value required: ${name}.` }
      : { status: 'CONFIGURED', value: defaultValue };
  }
  if (!/^\d+$/.test(input)) throw new Error(`${name} must be an explicitly supplied non-negative integer.`);
  const value = BigInt(input);
  if (value > MAX_UINT256) throw new Error(`${name} exceeds the Core uint256 range.`);
  return { status: 'CONFIGURED', value };
}

function configuredBps(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue?: number,
): PolicyConfigurationValue<number> {
  const input = environment[name]?.trim();
  if (!input) {
    return defaultValue === undefined
      ? { status: 'UNAVAILABLE', reason: `Explicit Admin value required: ${name}.` }
      : { status: 'CONFIGURED', value: defaultValue };
  }
  if (!/^\d+$/.test(input)) throw new Error(`${name} must be an explicitly supplied non-negative integer BPS value.`);
  const value = Number(input);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer BPS value.`);
  return { status: 'CONFIGURED', value };
}

export function createArcMainnetCoreDeploymentConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ArcMainnetCoreDeploymentConfig {
  const valuationFreshnessBlocks = configuredBigInt(
    environment,
    ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV,
    DEFAULT_VALUATION_FRESHNESS_BLOCKS,
  );
  const roles = {
    governance: environment.ARC_MAINNET_CORE_GOVERNANCE ?? ARC_MAINNET_CORE_ROLE_HOLDERS.governance,
    policyAdmin: environment.ARC_MAINNET_CORE_POLICY_ADMIN ?? ARC_MAINNET_CORE_ROLE_HOLDERS.policyAdmin,
    timelockExecutor: environment.ARC_MAINNET_CORE_TIMELOCK_EXECUTOR ?? ARC_MAINNET_CORE_ROLE_HOLDERS.timelockExecutor,
    automationExecutor: environment.ARC_MAINNET_CORE_AUTOMATION_EXECUTOR ?? ARC_MAINNET_CORE_ROLE_HOLDERS.automationExecutor,
    emergency: environment.ARC_MAINNET_CORE_EMERGENCY ?? ARC_MAINNET_CORE_ROLE_HOLDERS.emergency,
  };

  return {
    network: ARC_MAINNET_CORE_NETWORK,
    chainId: ARC_MAINNET_CORE_CHAIN_ID,
    rpcUrl: ARC_MAINNET_CORE_RPC,
    explorerUrl: ARC_MAINNET_CORE_EXPLORER,
    usdc: ARC_MAINNET_CORE_USDC,
    roles,
    roleConstructorArgs: [
      ARC_MAINNET_CORE_USDC,
      roles.governance,
      roles.policyAdmin,
      roles.timelockExecutor,
      roles.automationExecutor,
      roles.emergency,
    ],
    initialState: {
      minimumLiquidReserve: configuredBigInt(
        environment,
        ARC_MAINNET_CORE_INITIAL_POLICY_ENV.minimumLiquidReserve,
        DEFAULT_INITIAL_RISK_POLICY.minimumLiquidReserve,
      ),
      minimumLiquidReserveBps: configuredBps(
        environment,
        ARC_MAINNET_CORE_INITIAL_POLICY_ENV.minimumLiquidReserveBps,
        DEFAULT_INITIAL_RISK_POLICY.minimumLiquidReserveBps,
      ),
      maximumTotalDeployed: configuredBigInt(
        environment,
        ARC_MAINNET_CORE_INITIAL_POLICY_ENV.maximumTotalDeployed,
        DEFAULT_INITIAL_RISK_POLICY.maximumTotalDeployed,
      ),
      timelockDelay: { status: 'CONFIGURED', value: ARC_MAINNET_CORE_TIMELOCK_DELAY_SECONDS },
      bucketPolicy: {
        liquidOperationalReserveBps: configuredBps(environment, ARC_MAINNET_CORE_INITIAL_POLICY_ENV.liquidOperationalReserveBps),
        yieldStrategyBufferBps: configuredBps(environment, ARC_MAINNET_CORE_INITIAL_POLICY_ENV.yieldStrategyBufferBps),
        sweepLiquidityBufferBps: configuredBps(environment, ARC_MAINNET_CORE_INITIAL_POLICY_ENV.sweepLiquidityBufferBps),
        automationAgentPoolBps: configuredBps(environment, ARC_MAINNET_CORE_INITIAL_POLICY_ENV.automationAgentPoolBps),
      },
      valuationFreshnessBlocks,
      exposureCaps: {
        strategy: { status: 'CONFIGURED', value: { absoluteCap: 0n, relativeCapBps: 0 } },
        protocol: { status: 'CONFIGURED', value: { absoluteCap: 0n, relativeCapBps: 0 } },
        asset: { status: 'CONFIGURED', value: { absoluteCap: 0n, relativeCapBps: 0 } },
      },
    },
  };
}

export function loadArcMainnetCoreDeploymentConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ArcMainnetCoreDeploymentConfig {
  return validateArcMainnetCoreDeploymentConfig(createArcMainnetCoreDeploymentConfig(environment));
}

export function assessInitialPolicyConfiguration(
  initialState: ArcMainnetCoreDeploymentConfig['initialState'],
): InitialPolicyAssessment {
  const unavailable: string[] = [];
  const invalid: string[] = [];
  const values: [string, PolicyConfigurationValue<unknown>][] = [
    ['minimumLiquidReserve', initialState.minimumLiquidReserve],
    ['minimumLiquidReserveBps', initialState.minimumLiquidReserveBps],
    ['maximumTotalDeployed', initialState.maximumTotalDeployed],
    ['timelockDelay', initialState.timelockDelay],
    ['bucketPolicy.liquidOperationalReserveBps', initialState.bucketPolicy.liquidOperationalReserveBps],
    ['bucketPolicy.yieldStrategyBufferBps', initialState.bucketPolicy.yieldStrategyBufferBps],
    ['bucketPolicy.sweepLiquidityBufferBps', initialState.bucketPolicy.sweepLiquidityBufferBps],
    ['bucketPolicy.automationAgentPoolBps', initialState.bucketPolicy.automationAgentPoolBps],
    ['valuationFreshnessBlocks', initialState.valuationFreshnessBlocks],
  ];

  for (const [name, configured] of values) {
    if (configured.status === 'UNAVAILABLE') unavailable.push(name);
  }
  if (initialState.minimumLiquidReserve.status === 'CONFIGURED' && initialState.minimumLiquidReserve.value < 0n) {
    invalid.push('minimumLiquidReserve');
  }
  if (initialState.minimumLiquidReserve.status === 'CONFIGURED' && initialState.minimumLiquidReserve.value > MAX_UINT256) {
    invalid.push('minimumLiquidReserve');
  }
  if (initialState.maximumTotalDeployed.status === 'CONFIGURED' && initialState.maximumTotalDeployed.value < 0n) {
    invalid.push('maximumTotalDeployed');
  }
  if (initialState.maximumTotalDeployed.status === 'CONFIGURED' && initialState.maximumTotalDeployed.value === 0n) {
    invalid.push('maximumTotalDeployed');
  }
  if (initialState.maximumTotalDeployed.status === 'CONFIGURED' && initialState.maximumTotalDeployed.value > MAX_UINT256) {
    invalid.push('maximumTotalDeployed');
  }
  if (initialState.timelockDelay.status === 'CONFIGURED' && initialState.timelockDelay.value < 0n) {
    invalid.push('timelockDelay');
  }

  const configuredValue = <T>(configured: PolicyConfigurationValue<T>): T | undefined =>
    configured.status === 'CONFIGURED' ? configured.value : undefined;
  const bpsValues = [
    configuredValue(initialState.minimumLiquidReserveBps),
    configuredValue(initialState.bucketPolicy.liquidOperationalReserveBps),
    configuredValue(initialState.bucketPolicy.yieldStrategyBufferBps),
    configuredValue(initialState.bucketPolicy.sweepLiquidityBufferBps),
    configuredValue(initialState.bucketPolicy.automationAgentPoolBps),
  ];
  if (bpsValues.some((value) => value !== undefined && (!Number.isInteger(value) || value < 0 || value > 10_000))) {
    invalid.push('basisPoints');
  }

  const bucketValues = [
    configuredValue(initialState.bucketPolicy.liquidOperationalReserveBps),
    configuredValue(initialState.bucketPolicy.yieldStrategyBufferBps),
    configuredValue(initialState.bucketPolicy.sweepLiquidityBufferBps),
    configuredValue(initialState.bucketPolicy.automationAgentPoolBps),
  ];
  if (bucketValues.every((value) => value !== undefined) && bucketValues.reduce<number>((sum, value) => sum + value, 0) !== 10_000) {
    invalid.push('bucketPolicy.totalBps');
  }

  const freshness = configuredValue(initialState.valuationFreshnessBlocks);
  if (freshness !== undefined && (freshness <= 0n || freshness > MAX_UINT256)) invalid.push('valuationFreshnessBlocks');
  if (initialState.timelockDelay.status === 'CONFIGURED' && initialState.timelockDelay.value !== 2n * 24n * 60n * 60n) {
    invalid.push('timelockDelay');
  }
  for (const [name, cap] of Object.entries(initialState.exposureCaps)) {
    if (cap.status === 'CONFIGURED' && (
      cap.value.absoluteCap < 0n
      || !Number.isInteger(cap.value.relativeCapBps)
      || cap.value.relativeCapBps < 0
      || cap.value.relativeCapBps > 10_000
    )) invalid.push(`exposureCaps.${name}`);
  }

  return {
    status: invalid.length > 0 ? 'INVALID' : unavailable.length > 0 ? 'UNAVAILABLE' : 'CONFIGURED',
    unavailable,
    invalid,
  };
}

export function requireConfiguredInitialPolicyValue<T>(
  name: string,
  configured: PolicyConfigurationValue<T>,
): T {
  if (configured.status === 'UNAVAILABLE') throw new Error(`Initial Core policy is UNAVAILABLE: ${name}. ${configured.reason}`);
  return configured.value;
}

export function validateArcMainnetCoreDeploymentConfig(
  config: ArcMainnetCoreDeploymentConfig,
): ArcMainnetCoreDeploymentConfig {
  if (config.network !== ARC_MAINNET_CORE_NETWORK) throw new Error('New Treasury deployment requires Arc Mainnet.');
  if (config.chainId !== ARC_MAINNET_CORE_CHAIN_ID) throw new Error('New Treasury deployment requires chain ID 5042.');
  if (config.rpcUrl !== ARC_MAINNET_CORE_RPC) throw new Error('New Treasury deployment requires the official Arc Mainnet RPC URL.');
  if (config.explorerUrl !== ARC_MAINNET_CORE_EXPLORER) throw new Error('New Treasury deployment requires the official Arc Mainnet explorer URL.');
  if (config.usdc.toLowerCase() !== ARC_MAINNET_CORE_USDC.toLowerCase()) throw new Error('New Treasury deployment requires the official Arc Mainnet USDC address.');
  if (config.roleConstructorArgs[0].toLowerCase() !== ARC_MAINNET_CORE_USDC.toLowerCase()) throw new Error('Constructor USDC must be the official Arc Mainnet USDC address.');
  const initialPolicy = assessInitialPolicyConfiguration(config.initialState);
  const unavailableDeploymentValues = initialPolicy.unavailable.filter((name) => !name.startsWith('bucketPolicy.'));
  if (initialPolicy.invalid.length > 0 || unavailableDeploymentValues.length > 0) {
    const unavailable = unavailableDeploymentValues.length ? ` Unavailable: ${unavailableDeploymentValues.join(', ')}.` : '';
    const invalid = initialPolicy.invalid.length ? ` Invalid: ${initialPolicy.invalid.join(', ')}.` : '';
    const status = initialPolicy.invalid.length > 0 ? 'INVALID' : 'UNAVAILABLE';
    const freshnessRequirement = config.initialState.valuationFreshnessBlocks.status === 'UNAVAILABLE'
      ? ` ${config.initialState.valuationFreshnessBlocks.reason}`
      : '';
    throw new Error(`Initial Core policy is ${status}.${unavailable}${invalid}${freshnessRequirement}`);
  }
  const maximumTotalDeployed = requireConfiguredInitialPolicyValue('maximumTotalDeployed', config.initialState.maximumTotalDeployed);
  const timelockDelay = requireConfiguredInitialPolicyValue('timelockDelay', config.initialState.timelockDelay);
  if (maximumTotalDeployed === 0n) throw new Error('Initial deployment requires a positive Admin-defined maximum total deployed.');
  if (timelockDelay !== 2n * 24n * 60n * 60n) throw new Error('Initial deployment timelock delay must be two days.');

  const roleValues = Object.values(config.roles);
  for (const [role, holder] of Object.entries(config.roles)) {
    if (!isAddress(holder) || holder.toLowerCase() === ZeroAddress) throw new Error(`Invalid or missing new Treasury role holder: ${role}.`);
    if (isRetiredArcMainnetAddress(holder)) throw new Error(`Role holder ${role} cannot be a retired deployment address.`);
  }
  if (new Set(roleValues.map((value) => value.toLowerCase())).size !== roleValues.length) {
    throw new Error('New Treasury governance, policy, timelock, automation, and emergency role holders must be distinct.');
  }

  const expectedArgs = [
    config.usdc,
    config.roles.governance,
    config.roles.policyAdmin,
    config.roles.timelockExecutor,
    config.roles.automationExecutor,
    config.roles.emergency,
  ].map((value) => value.toLowerCase());
  if (config.roleConstructorArgs.length !== 6 || config.roleConstructorArgs.some((value, index) => value.toLowerCase() !== expectedArgs[index])) {
    throw new Error('VeloxTreasuryCore constructor arguments do not match the validated Mainnet configuration.');
  }

  return config;
}
