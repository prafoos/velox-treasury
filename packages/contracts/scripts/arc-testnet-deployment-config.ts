import { isAddress, ZeroAddress } from 'ethers';

export const ARC_TESTNET_DEPLOYMENT = {
  network: 'arc-testnet',
  chainId: 5_042_002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.io',
  usdc: {
    address: '0x3600000000000000000000000000000000000000',
    decimals: 6,
    symbol: 'USDC',
  },
  roles: {
    governance: '0x37ab81b0b9C326F91426E57aa2E2D9273EF16F06',
    policyAdmin: '0xfD1906C220D0BABb14d98e88624c08b1DD912F6c',
    pauser: '0xeE55Baf61e6727FC48b141a10f0AB7A14aE0E9Df',
    withdrawer: '0x616647825Fc3cf69E5e7c5E474fF49a71FFB2596',
  },
  constructor: {
    usdc: '0x3600000000000000000000000000000000000000',
    governance: '0x37ab81b0b9C326F91426E57aa2E2D9273EF16F06',
    policyAdmin: '0xfD1906C220D0BABb14d98e88624c08b1DD912F6c',
    pauser: '0xeE55Baf61e6727FC48b141a10f0AB7A14aE0E9Df',
    withdrawer: '0x616647825Fc3cf69E5e7c5E474fF49a71FFB2596',
  },
  policy: {
    minimumLiquidReserve: 10_000_000n,
    surplusSweepThreshold: 50_000_000n,
    dailyOutflowCap: 100_000_000n,
    maximumSingleWithdrawal: 50_000_000n,
    automatedSweepEnabled: true,
  },
  allocations: {
    liquidOperationalReserveBps: 2500,
    yieldStrategyBufferBps: 2500,
    swapLiquidityBufferBps: 2500,
    automationAgentPoolBps: 2500,
  },
} as const;

export function validateArcTestnetDeploymentConfig(config: typeof ARC_TESTNET_DEPLOYMENT): typeof ARC_TESTNET_DEPLOYMENT {
  if (config.network !== 'arc-testnet') {
    throw new Error('Arc Testnet deployment configuration is restricted to arc-testnet; Mainnet is not permitted.');
  }
  if (config.chainId !== 5_042_002) {
    throw new Error('Arc Testnet deployment configuration requires chain ID 5042002.');
  }
  if (config.rpcUrl !== 'https://rpc.testnet.arc.io') {
    throw new Error('Arc Testnet deployment configuration requires the official Arc Testnet RPC URL.');
  }
  if (config.explorerUrl !== 'https://explorer.testnet.arc.io') {
    throw new Error('Arc Testnet deployment configuration requires the official Arc Testnet explorer URL.');
  }
  if (config.usdc.address !== '0x3600000000000000000000000000000000000000') {
    throw new Error('Arc Testnet deployment configuration requires the official Arc Testnet USDC address.');
  }
  if (config.usdc.decimals !== 6) {
    throw new Error('Arc Testnet deployment configuration requires six-decimal USDC policy values.');
  }

  for (const [role, holder] of Object.entries(config.roles)) {
    if (!isAddress(holder) || holder.toLowerCase() === ZeroAddress) {
      throw new Error(`Invalid deployment role holder: ${role}`);
    }
  }
  if (new Set(Object.values(config.roles).map((value) => value.toLowerCase())).size !== 4) {
    throw new Error('The four Arc Testnet deployment role holders must be distinct.');
  }

  if (config.constructor.usdc !== config.usdc.address) {
    throw new Error('Constructor USDC address mismatch.');
  }
  if (
    config.constructor.governance !== config.roles.governance
    || config.constructor.policyAdmin !== config.roles.policyAdmin
    || config.constructor.pauser !== config.roles.pauser
    || config.constructor.withdrawer !== config.roles.withdrawer
  ) {
    throw new Error('Constructor role order or values do not match the validated Testnet role map.');
  }

  if (config.policy.maximumSingleWithdrawal > config.policy.dailyOutflowCap) {
    throw new Error('The single withdrawal cap cannot exceed the daily outflow cap.');
  }
  if (config.policy.automatedSweepEnabled && config.policy.surplusSweepThreshold < config.policy.minimumLiquidReserve) {
    throw new Error('The sweep threshold cannot fall below the reserve while automation is enabled.');
  }

  const allocationTotal =
    config.allocations.liquidOperationalReserveBps
    + config.allocations.yieldStrategyBufferBps
    + config.allocations.swapLiquidityBufferBps
    + config.allocations.automationAgentPoolBps;
  if (allocationTotal !== 10_000) {
    throw new Error('Arc Testnet deployment allocations must total exactly 10000 bps.');
  }

  return config;
}
