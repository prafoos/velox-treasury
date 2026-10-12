import type { Address } from 'viem';
import { createServerClient, readUserProjection, resolveUserAccount, serializeApiData } from './core-state';
import {
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  type WalletAuthRequest,
} from '../server/wallet-auth';

export interface UserFinancialStateRequest extends WalletAuthRequest {}

export interface UserFinancialStateResponse {
  status(code: number): UserFinancialStateResponse;
  setHeader(name: string, value: string): UserFinancialStateResponse;
  json(body: unknown): void;
}

export function readUserFinancialState(client: Parameters<typeof readUserProjection>[0], account: Address) {
  return readUserProjection(client, account);
}

export async function handleUserFinancialStateRequest(
  request: UserFinancialStateRequest,
  response: UserFinancialStateResponse,
  clientFactory: () => Parameters<typeof readUserProjection>[0] = createServerClient,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let account: Address;
  try {
    const identity = requireAuthenticatedWallet(request).authenticatedWalletAddress;
    account = resolveUserAccount(identity, request.query?.account);
  } catch (error) {
    respondToWalletAuthError(error, response);
    return;
  }

  try {
    const state = await readUserFinancialState(clientFactory(), account);
    response.status(200).json(serializeApiData(state));
  } catch {
    response.status(500).json({ error: 'User financial state is temporarily unavailable.' });
  }
}

export default function handler(request: UserFinancialStateRequest, response: UserFinancialStateResponse): Promise<void> {
  return handleUserFinancialStateRequest(request, response);
}
