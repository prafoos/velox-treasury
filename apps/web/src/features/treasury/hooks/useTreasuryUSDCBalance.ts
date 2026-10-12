import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getChainId, readContract } from 'viem/actions';
import { useConnectorClient } from 'wagmi';

import { getArcMainnetTreasuryAddress } from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS, usdcReadAbi } from '../../../contracts/usdc';
import { createUSDCBalanceDescriptor, formatUSDC } from '../../usdc/services/usdcService';

/** Reads the vault's USDC balance only. It never falls back to the wallet balance. */
export function useTreasuryUSDCBalance(isConnected: boolean, isArcMainnet: boolean) {
  const treasuryAddress = getArcMainnetTreasuryAddress();
  const enabled = Boolean(isConnected && isArcMainnet && treasuryAddress);
  const { data: connectorClient } = useConnectorClient({ chainId: ARC_MAINNET_CHAIN_ID, query: { enabled } });
  const query = useQuery({
    queryKey: ['treasury-usdc-balance', ARC_MAINNET_CHAIN_ID, treasuryAddress],
    enabled: enabled && Boolean(connectorClient),
    staleTime: 10_000,
    queryFn: async () => {
      if (!connectorClient || !treasuryAddress) throw new Error('Treasury contract is not configured on Arc Mainnet');
      if (await getChainId(connectorClient) !== ARC_MAINNET_CHAIN_ID) throw new Error('Treasury reads require Arc Mainnet (Chain ID 5042)');
      return readContract(connectorClient, { address: ARC_USDC_CONTRACT_ADDRESS, abi: usdcReadAbi, functionName: 'balanceOf', args: [treasuryAddress] });
    },
  });
  const rawAmount = typeof query.data === 'bigint' ? query.data : null;
  const descriptor = useMemo(() => {
    if (!treasuryAddress) return { symbol: 'USDC' as const, decimals: 6, rawAmount: null, formattedAmount: null, state: 'not_configured' as const, message: 'Treasury not deployed/configured on Arc Mainnet' };
    return createUSDCBalanceDescriptor({ isConnected, isArcMainnet, isLoading: enabled && query.isLoading, error: query.isError ? query.error : null, rawAmount: enabled && !query.isLoading && !query.isError ? rawAmount : null });
  }, [treasuryAddress, isConnected, isArcMainnet, enabled, query.isLoading, query.isError, query.error, rawAmount]);
  return { treasuryAddress, rawAmount, formattedAmount: rawAmount === null ? null : formatUSDC(rawAmount), descriptor, isLoading: query.isLoading, isError: query.isError, error: query.error, refetch: query.refetch };
}
