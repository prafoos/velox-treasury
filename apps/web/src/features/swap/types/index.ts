import type { Address } from 'viem';

export interface SwapToken {
  readonly chainId?: number;
  readonly address: Address;
  readonly symbol: string;
  readonly name?: string;
  readonly decimals: number;
  readonly logoUri?: string;
}

export type SwapQuoteStatus = 'IDLE' | 'VALIDATING' | 'QUOTING' | 'QUOTE_AVAILABLE' | 'QUOTE_EXPIRED' | 'QUOTE_UNAVAILABLE' | 'ERROR';
