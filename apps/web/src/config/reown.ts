import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';

import { arcMainnet, supportedNetworks } from './arc';

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

if (!projectId) {
  throw new Error('VITE_REOWN_PROJECT_ID must be configured before starting the web app.');
}

export const wagmiAdapter = new WagmiAdapter({
  networks: supportedNetworks,
  projectId,
  ssr: false,
});

createAppKit({
  adapters: [wagmiAdapter],
  defaultNetwork: arcMainnet,
  metadata: {
    name: 'Velox Treasury',
    description: 'Programmable USDC treasury',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://velox.treasury',
    icons: [],
  },
  networks: supportedNetworks,
  projectId,
});
