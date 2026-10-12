import { useQuery } from '@tanstack/react-query';
import { getChainId, readContract } from 'viem/actions';
import { isAddress, type Address } from 'viem';
import { useConnectorClient } from 'wagmi';

import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { useWalletStatus } from '../../../hooks/useWalletStatus';
import type { SwapToken } from '../types';

const balanceAbi = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const;

export function useSwapTokenBalance(token: SwapToken) {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const enabled = Boolean(isConnected && isArcMainnet && address && isAddress(address));
  const { data: client } = useConnectorClient({ chainId: ARC_MAINNET_CHAIN_ID, query: { enabled } });
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['swap-token-balance', ARC_MAINNET_CHAIN_ID, address, token.address],
    enabled: enabled && Boolean(client),
    queryFn: async () => {
      if (!address || !isAddress(address)) throw new Error('Wallet address is unavailable.');
      if (!client) throw new Error('Arc Mainnet wallet client is unavailable.');
      if (await getChainId(client) !== ARC_MAINNET_CHAIN_ID) throw new Error('Wallet must be on Arc Mainnet.');
      return readContract(client, { address: token.address, abi: balanceAbi, functionName: 'balanceOf', args: [address as Address] });
    },
  });
  return { rawAmount: typeof data === 'bigint' ? data : null, isLoading: enabled && isLoading, isError: enabled && isError, error: (error as Error | null) ?? null, refetch, isConnected, isArcMainnet };
}
