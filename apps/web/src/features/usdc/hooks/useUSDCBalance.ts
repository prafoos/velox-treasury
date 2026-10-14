import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAddress, type Address } from 'viem';
import { getChainId, readContract } from 'viem/actions';
import { useConnectorClient } from 'wagmi';

import {
  ARC_MAINNET_CHAIN_ID,
  ARC_USDC_CONTRACT_ADDRESS,
  usdcReadAbi,
} from '../../../contracts/usdc';
import { arcMainnetReadClient, withVerifiedArcMainnetPublicClient } from '../../treasury/services/arcMainnetPublicClient';
import { useWalletStatus } from '../../../hooks/useWalletStatus';
import {
  createUSDCBalanceDescriptor,
  formatUSDC,
} from '../services/usdcService';
import type { USDCBalanceResult } from '../types';

/**
 * React hook that uses the connected wallet's EIP-1193 client to read the live
 * Native USDC ERC-20 balance on Arc Mainnet for the connected wallet.
 * 
 * Enforces strict read-only execution:
 * - Does not trigger any write transactions.
 * - Queries only when connected to Arc Mainnet.
 * - Does not guess or fabricate balance data.
 */
export function useUSDCBalance(): USDCBalanceResult {
  const { address, isArcMainnet, isConnected } = useWalletStatus();

  const isQueryEnabled = Boolean(
    isConnected && isArcMainnet && address && isAddress(address),
  );

  const { data: connectorClient } = useConnectorClient({
    chainId: ARC_MAINNET_CHAIN_ID,
    query: {
      enabled: isQueryEnabled,
    },
  });

  const {
    data: rawBalance,
    isLoading: isContractLoading,
    isError: isContractError,
    error: contractError,
    refetch,
  } = useQuery({
    queryKey: ['usdc-balance', ARC_MAINNET_CHAIN_ID, address],
    enabled: isQueryEnabled && Boolean(connectorClient),
    staleTime: 10_000,
    queryFn: async () => {
      if (!connectorClient || !address || !isAddress(address)) {
        throw new Error('Arc Mainnet wallet client is not available');
      }

      const activeChainId = await getChainId(connectorClient);
      if (activeChainId !== ARC_MAINNET_CHAIN_ID) {
        throw new Error('USDC balance reads require Arc Mainnet (Chain ID 5042)');
      }

      return withVerifiedArcMainnetPublicClient(
        arcMainnetReadClient,
        () => readContract(arcMainnetReadClient, {
          address: ARC_USDC_CONTRACT_ADDRESS,
          abi: usdcReadAbi,
          functionName: 'balanceOf',
          args: [address as Address],
        }),
      );
    },
  });

  const isLoading = isQueryEnabled && isContractLoading;
  const isError = isQueryEnabled && isContractError;
  const rawAmount = typeof rawBalance === 'bigint' ? rawBalance : null;
  const formattedAmount = rawAmount !== null ? formatUSDC(rawAmount) : null;

  const descriptor = useMemo(() => {
    return createUSDCBalanceDescriptor({
      isConnected,
      isArcMainnet,
      isLoading,
      error: isError ? contractError : null,
      rawAmount: isConnected && isArcMainnet && !isLoading && !isError ? rawAmount : null,
    });
  }, [isConnected, isArcMainnet, isLoading, isError, contractError, rawAmount]);

  return {
    rawAmount,
    formattedAmount,
    descriptor,
    isLoading,
    isError,
    error: (contractError as Error | null) ?? null,
    isConnected,
    isArcMainnet,
    refetch,
  };
}
