import { createPublicClient, defineChain, http } from 'viem';
import { ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';

const arcMainnetReadChain = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['/api/chain-read'] } },
});

export const arcMainnetReadClient = createPublicClient({
  chain: arcMainnetReadChain,
  transport: http('/api/chain-read', { retryCount: 0, timeout: 10_000 }),
});

type PublicClientChainReader = {
  readonly getChainId?: () => Promise<unknown>;
} | null | undefined;

export async function withVerifiedArcMainnetPublicClient<T>(
  client: PublicClientChainReader,
  read: () => Promise<T>,
): Promise<T> {
  if (!client || typeof client.getChainId !== 'function') {
    throw new Error('Arc Mainnet RPC chain ID is unavailable.');
  }

  let chainId: unknown;
  try {
    chainId = await client.getChainId();
  } catch (cause) {
    throw new Error('Arc Mainnet RPC chain ID could not be verified.', { cause });
  }
  if (typeof chainId !== 'number' || !Number.isSafeInteger(chainId) || chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('Treasury reads require an RPC connected to Arc Mainnet (Chain ID 5042).');
  }

  return read();
}
