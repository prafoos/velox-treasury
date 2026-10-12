import { useQuery } from '@tanstack/react-query';
import { getChainId, readContract } from 'viem/actions';
import { isAddress, type Address } from 'viem';
import { useConnectorClient } from 'wagmi';

import { ARC_MAINNET_CHAIN_ID, usdcReadAbi } from '../../../contracts/usdc';
import { useWalletStatus } from '../../../hooks/useWalletStatus';
import type { SwapToken } from '../types';

export function useKyberSwapAllowance(token: SwapToken, amountIn: bigint | null, spender: Address | null) {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const enabled = Boolean(isConnected && isArcMainnet && address && isAddress(address) && amountIn && spender);
  const { data: client } = useConnectorClient({ chainId: ARC_MAINNET_CHAIN_ID, query: { enabled } });
  const query = useQuery({
    queryKey: ['kyberswap-allowance', ARC_MAINNET_CHAIN_ID, address, token.address, spender, amountIn?.toString()],
    enabled: enabled && Boolean(client),
    queryFn: async () => {
      if (!client || !address || !spender || !amountIn) throw new Error('Wallet is unavailable.');
      if (await getChainId(client) !== ARC_MAINNET_CHAIN_ID) throw new Error('Approvals require Arc Mainnet (chain ID 5042).');
      const allowance = await readContract(client, { address: token.address, abi: usdcReadAbi, functionName: 'allowance', args: [address as Address, spender] });
      return { state: allowance >= amountIn ? 'READY' as const : 'APPROVAL_REQUIRED' as const, allowance, approvalAmount: amountIn, spender };
    },
  });
  return { assessment: query.data ?? null, refetch: query.refetch };
}
