import type { BalanceStateStatus, TokenBalanceDescriptor } from '@velox/domain';
import type { Address } from 'viem';

export type { BalanceStateStatus, TokenBalanceDescriptor };

export interface USDCTokenMetadata {
  readonly address: Address;
  readonly chainId: number;
  readonly symbol: 'USDC';
  readonly name: string;
  readonly decimals: 6;
}

export interface FormatUSDCOptions {
  readonly minDecimals?: number;
  readonly maxDecimals?: number;
  readonly includeCommas?: boolean;
}

export interface USDCBalanceState {
  readonly rawAmount: bigint | null;
  readonly formattedAmount: string | null;
  readonly descriptor: TokenBalanceDescriptor;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
}

export interface USDCBalanceResult extends USDCBalanceState {
  readonly refetch: () => Promise<unknown>;
}

export interface WalletUSDCQueryContext {
  readonly isConnected: boolean;
  readonly isArcMainnet: boolean;
  readonly address?: Address | string;
}
