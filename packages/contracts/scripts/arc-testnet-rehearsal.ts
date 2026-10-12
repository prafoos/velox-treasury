import { isAddress, ZeroAddress } from 'ethers';

/** Official Arc Testnet values. Source: https://docs.arc.io/arc/references/connect-to-arc */
export const ARC_TESTNET = {
  network: 'arc-testnet',
  chainId: 5_042_002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.io',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  // The ERC-20 interface has six decimals, unlike native USDC gas accounting.
  usdc: { address: '0x3600000000000000000000000000000000000000', decimals: 6, symbol: 'USDC' },
} as const;

/**
 * Public Arc Testnet rehearsal role holders only. These are not signers, private
 * keys, deployed-contract addresses, or production/Mainnet configuration.
 */
export const ARC_TESTNET_REHEARSAL_ROLES = {
  governance: '0x37ab81b0b9C326F91426E57aa2E2D9273EF16F06',
  policyAdmin: '0xfD1906C220D0BABb14d98e88624c08b1DD912F6c',
  pauser: '0xeE55Baf61e6727FC48b141a10f0AB7A14aE0E9Df',
  withdrawer: '0x616647825Fc3cf69E5e7c5E474fF49a71FFB2596',
} as const;

export interface RehearsalRoles {
  readonly governance: string;
  readonly policyAdmin: string;
  readonly pauser: string;
  readonly withdrawer: string;
}

export interface ArcTestnetRehearsalConfig {
  readonly network: typeof ARC_TESTNET;
  readonly roles: RehearsalRoles;
  /** All amounts are six-decimal USDC ERC-20 base units, never 18-decimal gas units. */
  readonly policy: {
    readonly minimumLiquidReserve: bigint;
    readonly surplusSweepThreshold: bigint;
    readonly dailyOutflowCap: bigint;
    readonly maximumSingleWithdrawal: bigint;
    readonly automatedSweepEnabled: boolean;
  };
  readonly allocations: {
    readonly liquidOperationalReserveBps: number;
    readonly yieldStrategyBufferBps: number;
    readonly swapLiquidityBufferBps: number;
    readonly automationAgentPoolBps: number;
  };
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`Missing required rehearsal value: ${name}`);
  return value;
}

function integer(environment: Environment, name: string): bigint {
  const value = required(environment, name);
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be a non-negative integer in six-decimal USDC base units`);
  return BigInt(value);
}

function bps(environment: Environment, name: string): number {
  const value = Number(integer(environment, name));
  if (!Number.isSafeInteger(value) || value > 10_000) throw new Error(`${name} must be an integer from 0 through 10000`);
  return value;
}

function boolean(environment: Environment, name: string): boolean {
  const value = required(environment, name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be exactly true or false`);
}

/** Verifies the four explicit public role holders before they can be used in a rehearsal plan. */
export function validateArcTestnetRehearsalRoles(roles: RehearsalRoles): RehearsalRoles {
  for (const [role, holder] of Object.entries(roles)) {
    if (!isAddress(holder) || holder.toLowerCase() === ZeroAddress) {
      throw new Error(`Invalid controlled rehearsal address: ${role}`);
    }
  }
  if (new Set(Object.values(roles).map((value) => value.toLowerCase())).size !== 4) {
    throw new Error('The four controlled rehearsal role addresses must be distinct.');
  }
  return roles;
}

/**
 * Validates only a future rehearsal plan. It has no provider, signer, private-key,
 * contract-address, deployment, or transaction capability.
 */
export function loadArcTestnetRehearsalConfig(environment: Environment): ArcTestnetRehearsalConfig {
  if (required(environment, 'ARC_REHEARSAL_NETWORK') !== ARC_TESTNET.network) {
    throw new Error('Rehearsal is restricted to arc-testnet; Mainnet is not permitted.');
  }
  if (required(environment, 'ARC_REHEARSAL_CHAIN_ID') !== String(ARC_TESTNET.chainId)) {
    throw new Error('ARC_REHEARSAL_CHAIN_ID must be the official Arc Testnet chain ID.');
  }
  if (required(environment, 'ARC_REHEARSAL_RPC_URL') !== ARC_TESTNET.rpcUrl) {
    throw new Error('ARC_REHEARSAL_RPC_URL must be the official Arc Testnet RPC URL, never a Mainnet endpoint.');
  }

  const roles = validateArcTestnetRehearsalRoles(ARC_TESTNET_REHEARSAL_ROLES);

  const policy = {
    minimumLiquidReserve: integer(environment, 'ARC_REHEARSAL_MINIMUM_LIQUID_RESERVE'),
    surplusSweepThreshold: integer(environment, 'ARC_REHEARSAL_SURPLUS_SWEEP_THRESHOLD'),
    dailyOutflowCap: integer(environment, 'ARC_REHEARSAL_DAILY_OUTFLOW_CAP'),
    maximumSingleWithdrawal: integer(environment, 'ARC_REHEARSAL_MAXIMUM_SINGLE_WITHDRAWAL'),
    automatedSweepEnabled: boolean(environment, 'ARC_REHEARSAL_AUTOMATED_SWEEP_ENABLED'),
  };
  if (policy.maximumSingleWithdrawal > policy.dailyOutflowCap) {
    throw new Error('ARC_REHEARSAL_MAXIMUM_SINGLE_WITHDRAWAL cannot exceed ARC_REHEARSAL_DAILY_OUTFLOW_CAP.');
  }
  if (policy.automatedSweepEnabled && policy.surplusSweepThreshold < policy.minimumLiquidReserve) {
    throw new Error('ARC_REHEARSAL_SURPLUS_SWEEP_THRESHOLD cannot be below the reserve when automated sweep is enabled.');
  }

  const allocations = {
    liquidOperationalReserveBps: bps(environment, 'ARC_REHEARSAL_LIQUID_OPERATIONAL_RESERVE_BPS'),
    yieldStrategyBufferBps: bps(environment, 'ARC_REHEARSAL_YIELD_STRATEGY_BUFFER_BPS'),
    swapLiquidityBufferBps: bps(environment, 'ARC_REHEARSAL_SWAP_LIQUIDITY_BUFFER_BPS'),
    automationAgentPoolBps: bps(environment, 'ARC_REHEARSAL_AUTOMATION_AGENT_POOL_BPS'),
  };
  const allocationTotal = Object.values(allocations).reduce((total, value) => total + value, 0);
  if (allocationTotal !== 10_000) throw new Error('Arc Testnet rehearsal allocations must total exactly 10000 bps.');

  return { network: ARC_TESTNET, roles, policy, allocations };
}
