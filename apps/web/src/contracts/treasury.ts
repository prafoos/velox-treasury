import { getAddress, isAddress, keccak256, toBytes, zeroAddress, type Address } from 'viem';
import { ARC_MAINNET_CURRENT_LIVE_REFERENCES, isRetiredArcMainnetAddress } from '@velox/domain';

import { ARC_MAINNET_CHAIN_ID } from './usdc';

/** Project-approved Arc Mainnet Core; runtime configuration must explicitly select it. */
export const APPROVED_ARC_MAINNET_CORE_ADDRESS: Address =
  ARC_MAINNET_CURRENT_LIVE_REFERENCES.core as Address;
export const CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE: Address =
  ARC_MAINNET_CURRENT_LIVE_REFERENCES.adapter as Address;

export function resolveConfiguredMainnetAddress(
  value: string | undefined,
  currentReference: Address,
  name: string,
  requireFinalAddress = false,
): Address | null {
  const configuredValue = value?.trim();
  if (requireFinalAddress && !configuredValue) {
    throw new Error(`${name} must be explicitly configured with the final deployment address in production.`);
  }
  if (!configuredValue) return null;
  const candidate = configuredValue;
  if (!isAddress(candidate) || candidate.toLowerCase() === zeroAddress || isRetiredArcMainnetAddress(candidate)) {
    throw new Error(`${name} must be a valid non-zero EVM address.`);
  }
  if (candidate.toLowerCase() === currentReference.toLowerCase()) {
    throw new Error(`${name} cannot target the current live reference; use a labeled read-only reference context.`);
  }
  return getAddress(candidate);
}

export function resolveConfiguredMainnetCoreAddress(
  value: string | undefined,
  requireFinalAddress = false,
): Address | null {
  const configuredValue = value?.trim();
  if (requireFinalAddress && !configuredValue) {
    throw new Error('VITE_ARC_MAINNET_CORE_ADDRESS must be explicitly configured with the approved current Core in production.');
  }
  if (!configuredValue) return null;
  if (!isAddress(configuredValue) || configuredValue.toLowerCase() === zeroAddress || isRetiredArcMainnetAddress(configuredValue)) {
    throw new Error('VITE_ARC_MAINNET_CORE_ADDRESS must be the approved non-retired Arc Mainnet Core.');
  }
  if (configuredValue.toLowerCase() !== APPROVED_ARC_MAINNET_CORE_ADDRESS.toLowerCase()) {
    throw new Error('VITE_ARC_MAINNET_CORE_ADDRESS must match the approved current Arc Mainnet Core.');
  }
  return getAddress(configuredValue);
}

export const ARC_MAINNET_TREASURY_ADDRESS: Address | null = resolveConfiguredMainnetCoreAddress(
  import.meta.env.VITE_ARC_MAINNET_CORE_ADDRESS,
  import.meta.env.PROD,
);
export const ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS: Address | null = resolveConfiguredMainnetAddress(
  import.meta.env.VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS,
  CURRENT_LIVE_ARC_MAINNET_ADAPTER_REFERENCE,
  'VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS',
  import.meta.env.PROD,
);

export const POLICY_ADMIN_ROLE = keccak256(toBytes('POLICY_ADMIN_ROLE'));
export const TIMELOCK_EXECUTOR_ROLE = keccak256(toBytes('TIMELOCK_EXECUTOR_ROLE'));
export const AUTOMATION_ROLE = keccak256(toBytes('AUTOMATION_ROLE'));
export const EMERGENCY_ROLE = keccak256(toBytes('EMERGENCY_ROLE'));

export function getArcMainnetTreasuryAddress(): Address | null {
  const address = ARC_MAINNET_TREASURY_ADDRESS;
  if (!address || !isAddress(address) || address.toLowerCase() === zeroAddress) return null;
  return address;
}

export const veloxTreasuryAbi = [
  {
    type: 'function', name: 'deposit', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [],
  },
  {
    type: 'function', name: 'withdraw', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }, { name: 'recipient', type: 'address' }], outputs: [],
  },
  {
    type: 'function', name: 'withdrawWithDeallocation', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'strategiesToUnwind', type: 'address[]' },
      { name: 'sharesToUnwind', type: 'uint256[]' },
    ], outputs: [],
  },
  {
    type: 'function', name: 'usdc', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'userBalance', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'userStrategyPosition', stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'strategy', type: 'address' },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'position', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'userFinancialState', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [
      { name: 'principal', type: 'uint256' },
      { name: 'currentValue', type: 'uint256' },
      { name: 'unrealizedPnl', type: 'int256' },
      { name: 'realizedPnl', type: 'int256' },
      { name: 'totalPnl', type: 'int256' },
      { name: 'immediatelyWithdrawableValue', type: 'uint256' },
    ] }],
  },
  {
    type: 'function', name: 'immediatelyWithdrawableValue', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalUserLiabilities', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalDeployed', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'riskPolicy', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'minimumLiquidReserve', type: 'uint256' }, { name: 'minimumLiquidReserveBps', type: 'uint16' },
      { name: 'maximumTotalDeployed', type: 'uint256' },
    ] }],
  },
  {
    type: 'function', name: 'maximumSingleWithdrawal', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'dailyOutflowCap', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'setWithdrawalPolicy', stateMutability: 'nonpayable',
    inputs: [
      { name: 'newMaximumSingleWithdrawal', type: 'uint256' },
      { name: 'newDailyOutflowCap', type: 'uint256' },
    ],
    outputs: [{ name: 'operationId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'scheduleRiskPolicy', stateMutability: 'nonpayable',
    inputs: [
      { name: 'minimumLiquidReserve', type: 'uint256' },
      { name: 'minimumLiquidReserveBps', type: 'uint16' },
      { name: 'maximumTotalDeployed', type: 'uint256' },
    ],
    outputs: [{ name: 'operationId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'executeRiskPolicy', stateMutability: 'nonpayable',
    inputs: [{ name: 'operationId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'reduceRiskPolicy', stateMutability: 'nonpayable',
    inputs: [
      { name: 'minimumLiquidReserve', type: 'uint256' },
      { name: 'minimumLiquidReserveBps', type: 'uint16' },
      { name: 'maximumTotalDeployed', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'bucketPolicy', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'liquidOperationalReserveBps', type: 'uint16' },
      { name: 'yieldStrategyBufferBps', type: 'uint16' },
      { name: 'sweepLiquidityBufferBps', type: 'uint16' },
      { name: 'automationAgentPoolBps', type: 'uint16' },
    ] }],
  },
  {
    type: 'function', name: 'pendingOperations', stateMutability: 'view',
    inputs: [{ name: 'operationId', type: 'bytes32' }],
    outputs: [
      { name: 'kind', type: 'uint8' },
      { name: 'eta', type: 'uint64' },
      { name: 'subject', type: 'address' },
      { name: 'secondary', type: 'bytes32' },
      { name: 'tertiary', type: 'address' },
      { name: 'value1', type: 'uint256' },
      { name: 'value2', type: 'uint256' },
      { name: 'bps', type: 'uint16' },
      { name: 'bps2', type: 'uint16' },
      { name: 'bps3', type: 'uint16' },
      { name: 'bps4', type: 'uint16' },
    ],
  },
  {
    type: 'function', name: 'TIMELOCK_DELAY', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function', name: 'valuationFreshnessBlocks', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event', name: 'TimelockScheduled',
    inputs: [
      { name: 'operationId', type: 'bytes32', indexed: true },
      { name: 'kind', type: 'uint8', indexed: true },
      { name: 'eta', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'function', name: 'scheduleBucketPolicy', stateMutability: 'nonpayable',
    inputs: [{ name: 'newPolicy', type: 'tuple', components: [
      { name: 'liquidOperationalReserveBps', type: 'uint16' },
      { name: 'yieldStrategyBufferBps', type: 'uint16' },
      { name: 'sweepLiquidityBufferBps', type: 'uint16' },
      { name: 'automationAgentPoolBps', type: 'uint16' },
    ] }],
    outputs: [{ name: 'operationId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'executeBucketPolicy', stateMutability: 'nonpayable',
    inputs: [{ name: 'operationId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'reduceBucketPolicy', stateMutability: 'nonpayable',
    inputs: [{ name: 'newPolicy', type: 'tuple', components: [
      { name: 'liquidOperationalReserveBps', type: 'uint16' },
      { name: 'yieldStrategyBufferBps', type: 'uint16' },
      { name: 'sweepLiquidityBufferBps', type: 'uint16' },
      { name: 'automationAgentPoolBps', type: 'uint16' },
    ] }],
    outputs: [],
  },
  {
    type: 'function', name: 'bucketTargets', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'liquidOperationalReserve', type: 'uint256' },
      { name: 'yieldStrategyBuffer', type: 'uint256' },
      { name: 'sweepLiquidityBuffer', type: 'uint256' },
      { name: 'automationAgentPool', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'yieldStrategyBufferCapacity', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'liquidBucketClassifications', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'liquidOperationalReserve', type: 'uint256' },
      { name: 'sweepLiquidityBuffer', type: 'uint256' },
      { name: 'automationAgentPool', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'paused', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'hasRole', stateMutability: 'view',
    inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'configureProtocolVault', stateMutability: 'nonpayable',
    inputs: [{ name: 'protocol', type: 'bytes32' }, { name: 'vaultAddress', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'scheduleProtocolApproval', stateMutability: 'nonpayable',
    inputs: [
      { name: 'protocol', type: 'bytes32' },
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
    ],
    outputs: [{ name: 'operationId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'scheduleAssetApproval', stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
    ],
    outputs: [{ name: 'operationId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'scheduleStrategyApproval', stateMutability: 'nonpayable',
    inputs: [
      { name: 'strategy', type: 'address' },
      { name: 'protocol', type: 'bytes32' },
      { name: 'asset', type: 'address' },
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
    ],
    outputs: [{ name: 'operationId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'executeProtocolApproval', stateMutability: 'nonpayable',
    inputs: [{ name: 'operationId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'executeAssetApproval', stateMutability: 'nonpayable',
    inputs: [{ name: 'operationId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'executeStrategyApproval', stateMutability: 'nonpayable',
    inputs: [{ name: 'operationId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'protocolVaults', stateMutability: 'view',
    inputs: [{ name: 'protocol', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'protocolCaps', stateMutability: 'view',
    inputs: [{ name: 'protocol', type: 'bytes32' }],
    outputs: [
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'assetCaps', stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'DEFAULT_ADMIN_ROLE', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'POLICY_ADMIN_ROLE', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'TIMELOCK_EXECUTOR_ROLE', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'AUTOMATION_ROLE', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'EMERGENCY_ROLE', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'liquidUSDC', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'requiredLiquidReserve', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'availableLiquidity', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalManagedAssets', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'approvedProtocolCount', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'approvedAssetCount', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'approvedStrategyCount', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'protocolCaps', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: 'absoluteCap', type: 'uint256' }, { name: 'relativeCapBps', type: 'uint16' }, { name: 'approved', type: 'bool' }, { name: 'enabled', type: 'bool' }],
  },
  {
    type: 'function', name: 'assetCaps', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: 'absoluteCap', type: 'uint256' }, { name: 'relativeCapBps', type: 'uint16' }, { name: 'approved', type: 'bool' }, { name: 'enabled', type: 'bool' }],
  },
  {
    type: 'function', name: 'strategies', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'protocol', type: 'bytes32' }, { name: 'asset', type: 'address' }, { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' }, { name: 'principal', type: 'uint256' }, { name: 'shares', type: 'uint256' },
      { name: 'position', type: 'uint256' }, { name: 'realizedYield', type: 'uint256' }, { name: 'realizedLoss', type: 'uint256' },
      { name: 'feesAccrued', type: 'uint256' }, { name: 'withdrawalShortfall', type: 'uint256' }, { name: 'lastValuationBlock', type: 'uint256' },
      { name: 'valuationSource', type: 'address' }, { name: 'valuationStatus', type: 'uint8' }, { name: 'approved', type: 'bool' }, { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'TIMELOCK_DELAY', stateMutability: 'view', inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'event', name: 'Deposit', anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false },
      { name: 'userBalance', type: 'uint256', indexed: false }, { name: 'totalLiabilities', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Withdrawal', anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true }, { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false }, { name: 'userBalance', type: 'uint256', indexed: false },
      { name: 'totalLiabilities', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'UserFinancialStateChanged', anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true }, { name: 'principal', type: 'uint256', indexed: false },
      { name: 'currentValue', type: 'uint256', indexed: false }, { name: 'unrealizedPnl', type: 'int256', indexed: false },
      { name: 'realizedPnl', type: 'int256', indexed: false }, { name: 'totalPnl', type: 'int256', indexed: false },
      { name: 'immediatelyWithdrawableValue', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'TreasuryNAVChanged', anonymous: false,
    inputs: [
      { name: 'totalManagedAssets', type: 'uint256', indexed: false }, { name: 'totalUserLiabilities', type: 'uint256', indexed: false },
      { name: 'totalDeployed', type: 'uint256', indexed: false }, { name: 'liquidUSDC', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const treasuryContractConfig = {
  address: getArcMainnetTreasuryAddress(),
  abi: veloxTreasuryAbi,
  chainId: ARC_MAINNET_CHAIN_ID,
} as const;
