import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import {
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
  getArcMainnetTreasuryAddress,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import { assertApprovedDepositCore } from '../services/depositPreflight';

export interface TreasuryBucketTargetState {
  readonly liquidOperationalReserveBps: bigint;
  readonly yieldStrategyBufferBps: bigint;
  readonly sweepLiquidityBufferBps: bigint;
  readonly automationAgentPoolBps: bigint;
  readonly liquidOperationalReserve: bigint;
  readonly yieldStrategyBuffer: bigint;
  readonly sweepLiquidityBuffer: bigint;
  readonly automationAgentPool: bigint;
  readonly totalManagedAssets: bigint;
  readonly totalDeployed: bigint;
  readonly blockNumber: bigint;
}

export function treasuryBucketTargetQueryKey(treasuryAddress: string | undefined) {
  return [
    'treasury-bucket-targets',
    ARC_MAINNET_CHAIN_ID,
    treasuryAddress?.toLowerCase() ?? null,
  ] as const;
}

export function useTreasuryBucketTargets(isAuthorizedAdmin: boolean) {
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const treasuryAddress = getArcMainnetTreasuryAddress();
  const enabled = Boolean(isAuthorizedAdmin && publicClient && treasuryAddress);
  const query = useQuery({
    queryKey: treasuryBucketTargetQueryKey(treasuryAddress ?? undefined),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
    queryFn: async (): Promise<TreasuryBucketTargetState> => {
      if (!publicClient || !treasuryAddress) {
        throw new Error('The approved current Core or Arc Mainnet RPC client is unavailable.');
      }
      assertApprovedDepositCore(treasuryAddress, APPROVED_ARC_MAINNET_CORE_ADDRESS);
      const bytecode = await withVerifiedArcMainnetPublicClient(
        publicClient,
        () => publicClient.getBytecode({ address: treasuryAddress }),
      );
      if (!bytecode || bytecode === '0x') {
        throw new Error('The approved current Core has no deployed bytecode on Arc Mainnet.');
      }
      const coreUsdc = await withVerifiedArcMainnetPublicClient(
        publicClient,
        () => publicClient.readContract({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: 'usdc',
        }),
      );
      if (coreUsdc.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) {
        throw new Error('The approved current Core does not use the approved Arc Mainnet USDC contract.');
      }
      const blockNumber = await withVerifiedArcMainnetPublicClient(
        publicClient,
        () => publicClient.getBlockNumber(),
      );
      const [policy, targets, totalManagedAssets, totalDeployed] = await withVerifiedArcMainnetPublicClient(
        publicClient,
        () => Promise.all([
          publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'bucketPolicy',
            blockNumber,
          }),
          publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'bucketTargets',
            blockNumber,
          }),
          publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'totalManagedAssets',
            blockNumber,
          }),
          publicClient.readContract({
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'totalDeployed',
            blockNumber,
          }),
        ]),
      );
      return {
        liquidOperationalReserveBps: BigInt(policy.liquidOperationalReserveBps),
        yieldStrategyBufferBps: BigInt(policy.yieldStrategyBufferBps),
        sweepLiquidityBufferBps: BigInt(policy.sweepLiquidityBufferBps),
        automationAgentPoolBps: BigInt(policy.automationAgentPoolBps),
        liquidOperationalReserve: targets[0],
        yieldStrategyBuffer: targets[1],
        sweepLiquidityBuffer: targets[2],
        automationAgentPool: targets[3],
        totalManagedAssets,
        totalDeployed,
        blockNumber,
      };
    },
  });
  return {
    targets: enabled && !query.error ? query.data ?? null : null,
    isLoading: enabled && (query.isLoading || query.isFetching),
    error: enabled
      ? query.error instanceof Error ? query.error : query.error ? new Error('Core bucket target reads failed.') : null
      : null,
    refetch: query.refetch,
  };
}
