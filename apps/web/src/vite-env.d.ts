/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REOWN_PROJECT_ID?: string;
  readonly VITE_ARC_MAINNET_CORE_ADDRESS?: string;
  readonly VITE_ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS?: string;
  readonly VITE_ARC_MAINNET_LOG_CHUNK_SIZE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
