import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

process.env.VELOX_TREASURY_CORE_ADDRESS ??= '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';
process.env.STEAKHOUSE_ADAPTER_ADDRESS ??= '0x8888888888888888888888888888888888888888';

export default mergeConfig(viteConfig, defineConfig({
  define: {
    'import.meta.env.VITE_ARC_MAINNET_CORE_ADDRESS': JSON.stringify('0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7'),
    'import.meta.env.VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS': JSON.stringify('0x8888888888888888888888888888888888888888'),
  },
}));
