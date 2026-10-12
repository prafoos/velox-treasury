import type {
  EmergencyControlModel,
  TokenBalanceDescriptor,
  TreasuryAllocationModel,
  TreasuryBalanceModel,
  TreasuryRuleModel,
  TreasuryStatusBannerInfo,
  TreasurySummary,
} from '../types';
import type { TreasuryPolicyModel } from '@velox/domain';
import { createAllocationBuckets, createDefaultPolicy, createTreasuryRules } from './policyService';
import { formatUSDC } from '../../usdc/services/usdcService';

export interface WalletConnectionInfo {
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
  readonly address?: `0x${string}` | string;
  readonly chainName?: string;
}

function createBalanceDescriptor(
  wallet: WalletConnectionInfo,
): TokenBalanceDescriptor {
  if (!wallet.isConnected) {
    return {
      symbol: 'USDC',
      decimals: 6,
      rawAmount: null,
      formattedAmount: null,
      state: 'disconnected',
      message: 'Wallet not connected',
    };
  }

  if (!wallet.isArcMainnet) {
    return {
      symbol: 'USDC',
      decimals: 6,
      rawAmount: null,
      formattedAmount: null,
      state: 'wrong_network',
      message: 'Switch to Arc Mainnet to view',
    };
  }

  // Connected to Arc Mainnet: awaiting or initializing live contract query
  return {
    symbol: 'USDC',
    decimals: 6,
    rawAmount: null,
    formattedAmount: null,
    state: 'loading',
    message: 'Fetching USDC balance...',
  };
}

export function getTreasuryBalances(
  wallet: WalletConnectionInfo,
  treasuryBalance?: TokenBalanceDescriptor,
): TreasuryBalanceModel {
  const activeBalance = treasuryBalance ?? createBalanceDescriptor(wallet);

  const unavailableState: TokenBalanceDescriptor['state'] = !wallet.isConnected
    ? 'disconnected'
    : !wallet.isArcMainnet
      ? 'wrong_network'
      : 'pending_integration';
  const availableDescriptor: TokenBalanceDescriptor = {
    symbol: 'USDC',
    decimals: 6,
    rawAmount: null,
    formattedAmount: null,
    state: unavailableState,
    message: !wallet.isConnected
      ? 'Wallet not connected'
      : !wallet.isArcMainnet
        ? 'Switch to Arc Mainnet to view'
        : 'Reserve-aware Treasury liquidity is unavailable in this balance view.',
  };
  const allocatedDescriptor: TokenBalanceDescriptor = !wallet.isConnected
    ? {
        symbol: 'USDC',
        decimals: 6,
        rawAmount: null,
        formattedAmount: null,
        state: 'disconnected',
        message: 'Wallet not connected',
      }
    : !wallet.isArcMainnet
    ? {
        symbol: 'USDC',
        decimals: 6,
        rawAmount: null,
        formattedAmount: null,
        state: 'wrong_network',
        message: 'Switch to Arc Mainnet to view',
      }
    : {
        symbol: 'USDC',
        decimals: 6,
        rawAmount: null,
        formattedAmount: null,
        state: 'pending_integration',
        message: 'Allocated Treasury balance is unavailable from current Core data.',
      };

  return {
    total: activeBalance,
    available: availableDescriptor,
    allocated: allocatedDescriptor,
  };
}

export function getTreasuryAllocations(
  wallet: WalletConnectionInfo,
  policy: TreasuryPolicyModel = createDefaultPolicy(),
  bucketTargets?: readonly bigint[] | null,
  classifications?: readonly bigint[] | null,
): TreasuryAllocationModel {
  const allocationTotal = Object.values(policy.allocations).reduce((sum, value) => sum + value, 0n);
  const hasCompleteAllocationDraft = allocationTotal === 10_000n;
  let statusMessage: string;
  if (!wallet.isConnected) {
    statusMessage = 'Connect your wallet to inspect configured allocation buckets.';
  } else if (!wallet.isArcMainnet) {
    statusMessage = 'Switch your wallet to Arc Mainnet (Chain ID 5042) to view allocation status.';
  } else if (bucketTargets && bucketTargets.length >= 4) {
    statusMessage = 'Live Core bucket values are authoritative and are displayed from the Arc Mainnet treasury state.';
  } else {
    statusMessage = hasCompleteAllocationDraft
      ? 'Current Core does not expose live bucket values. Local policy drafts remain separate from the deployed on-chain state.'
      : 'Current Core bucket values and a complete Admin-selected allocation are unavailable.';
  }

  return {
    buckets: createAllocationBuckets(policy, bucketTargets, classifications),
    totalAllocatedPercentageBps: hasCompleteAllocationDraft ? allocationTotal : null,
    statusMessage,
  };
}

export function getTreasuryRules(policy: TreasuryPolicyModel = createDefaultPolicy()): readonly TreasuryRuleModel[] {
  return createTreasuryRules(policy);
}

export function getEmergencyControls(policy: TreasuryPolicyModel = createDefaultPolicy()): EmergencyControlModel {
  return {
    status: 'standby',
    isPaused: false,
    limits: [
      { id: 'limit-single-tx', label: 'Max Single Withdrawal (legacy local preview)', configuredValue: `${formatUSDC(policy.maximumSingleWithdrawal)} USDC`, description: 'Application-only preview; the final Core does not enforce a per-withdrawal cap.', status: 'pre_activation' },
      { id: 'limit-daily-outflow', label: '24-Hour Outflow Spending Cap (legacy local preview)', configuredValue: `${formatUSDC(policy.dailyOutflowCap)} USDC`, description: 'Application-only preview; the final Core does not enforce a rolling 24-hour cap.', status: 'pre_activation' },
    ],
    statusNotice: 'These values are legacy application-only previews, not final Core policy. The Core has an on-chain emergency pause; its live state is shown in Core State.',
    targetStage: 'Pending on-chain enforcement',
  };
}

export function getTreasuryStatusBanner(
  wallet: WalletConnectionInfo,
  treasuryBalance?: TokenBalanceDescriptor,
): TreasuryStatusBannerInfo {
  if (!wallet.isConnected) {
    return {
      type: 'warning',
      title: 'Wallet Not Connected',
      message:
        'Connect your wallet to Arc Mainnet (Chain ID 5042) to monitor and manage the Velox Treasury.',
    };
  }

  if (!wallet.isArcMainnet) {
    return {
      type: 'warning',
      title: 'Wrong Network Detected',
      message:
        'Velox Treasury operates strictly on Arc Mainnet (Chain ID 5042). Please switch networks in your wallet.',
    };
  }

  if (treasuryBalance?.state === 'not_configured') {
    return { type: 'warning', title: 'Treasury Not Deployed / Configured', message: 'No verified VeloxTreasury address is configured for Arc Mainnet. Wallet USDC is shown separately and is not Treasury capital.' };
  }
  if (treasuryBalance?.state === 'error') {
    return {
      type: 'warning',
      title: 'USDC Balance Read Error',
      message:
        treasuryBalance.message || 'Failed to read the on-chain Treasury USDC balance from Arc Mainnet. Please verify RPC connection.',
    };
  }

  if (treasuryBalance?.state === 'loading') {
    return {
      type: 'info',
      title: 'Syncing USDC Balance',
      message:
        'Reading the configured Treasury vault balance from the official Native USDC contract on Arc Mainnet...',
    };
  }

  if (treasuryBalance?.state === 'synced') {
    return {
      type: 'notice',
      title: 'Treasury Live on Arc Mainnet',
      message:
        'Connected to Arc Mainnet. Treasury USDC balance is synchronized separately from the connected wallet balance.',
    };
  }

  if (treasuryBalance?.state === 'pending_integration') {
    return {
      type: 'info',
      title: 'User-scoped Treasury view',
      message: 'Treasury-wide balances and shared strategy accounting are not included in this user view.',
    };
  }

  return {
    type: 'info',
    title: 'Treasury Core Active (USDC Reading Mode)',
    message:
      'USDC management foundation is active. Live Native USDC contract queries are connected on Arc Mainnet. All actions are transaction-free.',
  };
}

export function getTreasurySummary(
  wallet: WalletConnectionInfo,
  treasuryBalance?: TokenBalanceDescriptor,
  policy: TreasuryPolicyModel = createDefaultPolicy(),
  bucketTargets?: readonly bigint[] | null,
  classifications?: readonly bigint[] | null,
): TreasurySummary {
  return {
    balances: getTreasuryBalances(wallet, treasuryBalance),
    allocations: getTreasuryAllocations(wallet, policy, bucketTargets, classifications),
    rules: getTreasuryRules(policy),
    emergency: getEmergencyControls(policy),
    isConnected: wallet.isConnected,
    isArcMainnet: wallet.isArcMainnet,
    address: wallet.address,
    chainName: wallet.chainName,
    statusBanner: getTreasuryStatusBanner(wallet, treasuryBalance),
  };
}
