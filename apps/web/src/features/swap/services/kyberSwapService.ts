import { isAddress, type Address, type Hex } from 'viem';

import { KYBERSWAP_API_URL, KYBERSWAP_CHAIN_ID, KYBERSWAP_CHAIN_SLUG, KYBERSWAP_CLIENT_ID, isKyberSwapTokenSupported } from '../config/kyberSwap';
import type { SwapToken } from '../types';
import { validateSwapInput } from './swapValidation';

const QUOTE_VALIDITY_SECONDS = 120n;

export interface KyberSwapQuoteInput {
  readonly tokenIn: SwapToken;
  readonly tokenOut: SwapToken;
  readonly amountIn: bigint;
  readonly slippageBps: bigint;
  readonly sender: Address;
  readonly recipient: Address;
  readonly nowSeconds: bigint;
}

export interface KyberSwapQuote {
  readonly tokenIn: SwapToken;
  readonly tokenOut: SwapToken;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly minimumAmountOut: bigint;
  readonly expiresAt: bigint;
  readonly spender: Address;
  readonly transaction: { readonly to: Address; readonly data: Hex; readonly value: bigint };
}

interface KyberRouteResponse {
  readonly code?: number;
  readonly message?: string;
  readonly data?: { readonly routeSummary?: { readonly amountOut?: string; readonly amountOutMin?: string } };
}

interface KyberBuildResponse {
  readonly code?: number;
  readonly message?: string;
  readonly data?: {
    readonly routerAddress?: string;
    /** KyberSwap Aggregator v1 transaction calldata. */
    readonly data?: string;
    readonly transactionValue?: string;
  };
}

function headers(): HeadersInit {
  return {
    accept: 'application/json',
    ...(KYBERSWAP_CLIENT_ID ? { 'x-client-id': KYBERSWAP_CLIENT_ID } : {}),
  };
}

async function kyberFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...headers(), ...init?.headers } });
  const payload = await response.json().catch(() => null) as T & { message?: string } | null;
  if (!response.ok || !payload) throw new Error(payload?.message ?? `KyberSwap request failed (${response.status}).`);
  return payload;
}

function parsePositiveInteger(value: string | undefined, field: string): bigint {
  if (!value || !/^\d+$/.test(value)) throw new Error(`KyberSwap ${field} is invalid.`);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`KyberSwap ${field} must be greater than zero.`);
  return parsed;
}

export async function requestKyberSwapQuote(input: KyberSwapQuoteInput): Promise<KyberSwapQuote> {
  validateSwapInput({ ...input, chainId: KYBERSWAP_CHAIN_ID });
  if (!isAddress(input.sender) || !isAddress(input.recipient)) throw new Error('Connected wallet address is invalid.');
  if (!isKyberSwapTokenSupported(input.tokenIn) || !isKyberSwapTokenSupported(input.tokenOut)) {
    throw new Error('Swap token is not supported.');
  }

  const parameters = new URLSearchParams({
    tokenIn: input.tokenIn.address,
    tokenOut: input.tokenOut.address,
    amountIn: input.amountIn.toString(),
    saveGas: 'false',
    gasInclude: 'true',
  });
  const apiBaseUrl = `${KYBERSWAP_API_URL}/${KYBERSWAP_CHAIN_SLUG}/api/v1`;
  const routeResponse = await kyberFetch<KyberRouteResponse>(`${apiBaseUrl}/routes?${parameters}`);
  const routeSummary = routeResponse.data?.routeSummary;
  if (routeResponse.code !== 0 || !routeSummary) throw new Error(routeResponse.message ?? 'KyberSwap route unavailable.');

  const buildResponse = await kyberFetch<KyberBuildResponse>(`${apiBaseUrl}/route/build`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      routeSummary,
      sender: input.sender,
      recipient: input.recipient,
      slippageTolerance: Number(input.slippageBps) / 100,
    }),
  });
  const transaction = buildResponse.data;
  const routerAddress = transaction?.routerAddress ?? '';
  const callData = transaction?.data ?? '';
  if (buildResponse.code !== 0 || !transaction || !isAddress(routerAddress) || !/^0x[\da-fA-F]*$/.test(callData)) {
    throw new Error(buildResponse.message ?? 'KyberSwap transaction build failed.');
  }

  const amountOut = parsePositiveInteger(routeSummary.amountOut, 'output');
  const minimumAmountOut = routeSummary.amountOutMin === undefined
    ? amountOut * (10_000n - input.slippageBps) / 10_000n
    : parsePositiveInteger(routeSummary.amountOutMin, 'minimum output');
  if (minimumAmountOut > amountOut) throw new Error('KyberSwap minimum output exceeds quoted output.');
  const value = transaction.transactionValue === undefined || transaction.transactionValue === '' ? 0n : BigInt(transaction.transactionValue);
  if (value < 0n) throw new Error('KyberSwap transaction value is invalid.');

  return {
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
    amountOut,
    minimumAmountOut,
    expiresAt: input.nowSeconds + QUOTE_VALIDITY_SECONDS,
    spender: routerAddress as Address,
    transaction: { to: routerAddress as Address, data: callData as Hex, value },
  };
}

export function validateKyberSwapQuote(quote: KyberSwapQuote, nowSeconds: bigint): void {
  if (quote.expiresAt <= nowSeconds) throw new Error('KyberSwap quote has expired. Get a new quote.');
  if (quote.amountIn <= 0n || quote.amountOut <= 0n || quote.minimumAmountOut <= 0n || quote.minimumAmountOut > quote.amountOut) {
    throw new Error('KyberSwap quote is invalid.');
  }
  if (!isAddress(quote.spender) || !isAddress(quote.transaction.to)) throw new Error('KyberSwap transaction target is invalid.');
}
