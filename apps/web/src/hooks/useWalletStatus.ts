import { useAccount, useChainId, useDisconnect } from 'wagmi';

import { arcMainnet } from '../config/arc';

export function useWalletStatus() {
  const account = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();

  return {
    address: account.address,
    chain: account.chain,
    disconnect,
    isArcMainnet: account.isConnected && chainId === arcMainnet.id,
    isConnected: account.isConnected,
  };
}
