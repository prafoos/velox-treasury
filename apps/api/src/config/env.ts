import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { ARC_MAINNET_EXECUTION_CONFIG, readConfiguredCoreAddress } from './arc-mainnet.js';

loadEnv();
try {
  loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
} catch {
  // Ignore fallback loading errors
}

const configuredAddress = (fallback: string) => z.preprocess(
  (value) => typeof value === 'string' && !value.trim() ? undefined : value,
  z.string().regex(/^0x[a-fA-F0-9]{40}$/).default(fallback),
);

export const envSchema = z.object({
  ARC_MAINNET_RPC_URL: z.string().url().default('https://rpc.mainnet.arc.io'),
  POSTGRES_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/velox_monitoring'),
  ARC_CHAIN_ID: z.coerce.number().refine((value) => value === 5042, {
    message: 'ARC_CHAIN_ID must be 5042 for Arc Mainnet.',
  }).default(5042),
  VELOX_TREASURY_CORE_ADDRESS: configuredAddress(ARC_MAINNET_EXECUTION_CONFIG.coreAddress),
  STEAKHOUSE_ADAPTER_ADDRESS: configuredAddress(ARC_MAINNET_EXECUTION_CONFIG.steakhouseAdapterAddress),
  GEMINI_API_KEY: z.string().min(1, { message: 'GEMINI_API_KEY is required.' }),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
});

export const env = envSchema.parse({
  ...process.env,
  VELOX_TREASURY_CORE_ADDRESS: readConfiguredCoreAddress(process.env),
});

export const arcConfig = {
  chainId: env.ARC_CHAIN_ID,
  rpcUrl: env.ARC_MAINNET_RPC_URL,
  coreAddress: env.VELOX_TREASURY_CORE_ADDRESS,
  steakhouseAdapterAddress: env.STEAKHOUSE_ADAPTER_ADDRESS || undefined,
};

export const geminiConfig = {
  model: env.GEMINI_MODEL,
};

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
  if (!key || !key.trim()) {
    throw new Error('GEMINI_API_KEY is required.');
  }
  return key.trim();
}
