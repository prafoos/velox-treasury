import { useQuery } from '@tanstack/react-query';

import {
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
  getArcMainnetTreasuryAddress,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { arcMainnetReadClient, withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import { assertApprovedDepositCore } from '../services/depositPreflight';

export interface TreasuryAllocationPolicy {
  readonly operationalReserveBps: bigint;
  readonly yieldStrategyBps: bigint;
  readonly liquidityAvailabilityBps: bigint;
  readonly automationAndAiBps: bigint;
}

function parseAllocationPolicy(policy: {
  readonly liquidOperationalReserveBps: number;
  readonly yieldStrategyBufferBps: number;
  readonly sweepLiquidityBufferBps: number;
  readonly automationAgentPoolBps: number;
}): TreasuryAllocationPolicy {
  const values = [
    policy.liquidOperationalReserveBps,
    policy.yieldStrategyBufferBps,
    policy.sweepLiquidityBufferBps,
    policy.automationAgentPoolBps,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 10_000)
    || values.reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new Error('The active allocation values returned by Core are invalid.');
  }

  return {
    operationalReserveBps: BigInt(policy.liquidOperationalReserveBps),
    yieldStrategyBps: BigInt(policy.yieldStrategyBufferBps),
    liquidityAvailabilityBps: BigInt(policy.sweepLiquidityBufferBps),
    automationAndAiBps: BigInt(policy.automationAgentPoolBps),
  };
}

export function treasuryAllocationPolicyQueryKey(coreAddress: string | undefined) {
  return [
    'treasury-allocation-policy',
    ARC_MAINNET_CHAIN_ID,
    coreAddress?.toLowerCase() ?? null,
  ] as const;
}

export function useTreasuryAllocationPolicy(isArcMainnet: boolean) {
  const coreAddress = getArcMainnetTreasuryAddress();
  const enabled = Boolean(isArcMainnet && coreAddress);
  const query = useQuery({
    queryKey: treasuryAllocationPolicyQueryKey(coreAddress ?? undefined),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
    queryFn: async (): Promise<TreasuryAllocationPolicy> => {
      if (!coreAddress) {
        throw new Error('The approved current Core is unavailable.');
      }
      assertApprovedDepositCore(coreAddress, APPROVED_ARC_MAINNET_CORE_ADDRESS);
      const policy = await withVerifiedArcMainnetPublicClient(
        arcMainnetReadClient,
        () => arcMainnetReadClient.readContract({
          address: coreAddress,
          abi: veloxTreasuryAbi,
          functionName: 'bucketPolicy',
        }),
      );
      return parseAllocationPolicy(policy);
    },
  });

  return {
    policy: enabled && !query.error ? query.data ?? null : null,
    isLoading: enabled && query.isLoading,
    error: enabled
      ? query.error instanceof Error
        ? query.error
        : query.error
          ? new Error('The current allocation information could not be read.')
          : null
      : null,
    refetch: query.refetch,
  };
}
