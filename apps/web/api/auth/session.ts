import {
  requireAuthenticatedWallet,
  respondToWalletAuthError,
  type WalletAuthRequest,
  type WalletAuthResponse,
} from '../../server/wallet-auth.js';

export async function handleWalletAuthSessionRequest(
  request: WalletAuthRequest,
  response: WalletAuthResponse,
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  try {
    const context = requireAuthenticatedWallet(request);
    response.status(200).json(context);
  } catch (error) {
    respondToWalletAuthError(error, response);
  }
}

export default function handler(request: WalletAuthRequest, response: WalletAuthResponse): Promise<void> {
  return handleWalletAuthSessionRequest(request, response);
}