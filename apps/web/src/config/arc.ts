import { defineChain } from '@reown/appkit/networks';

export const arcMainnet = defineChain({
  id: 5042,
  caipNetworkId: 'eip155:5042',
  chainNamespace: 'eip155',
  name: 'Arc',
  nativeCurrency: {
    decimals: 18,
    name: 'USDC',
    symbol: 'USDC',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.mainnet.arc.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.arc.io',
    },
  },
});

export const supportedNetworks = [arcMainnet] as [typeof arcMainnet];
