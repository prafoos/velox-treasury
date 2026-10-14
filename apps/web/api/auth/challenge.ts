import {
  assertRequestOrigin,
  createProductionWalletAuthDependencies,
  issueWalletChallenge,
  respondToWalletAuthError,
  type WalletAuthDependencies,
  type WalletAuthRequest,
  type WalletAuthResponse,
} from '../../server/wallet-auth.js';

export async function handleWalletAuthChallengeRequest(
  request: WalletAuthRequest,
  response: WalletAuthResponse,
  dependenciesFactory: () => WalletAuthDependencies = createProductionWalletAuthDependencies,
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const dependencies = dependenciesFactory();
    assertRequestOrigin(request, dependencies.authOrigin);
    const address = request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>).address
      : undefined;
    const challenge = await issueWalletChallenge(address, dependencies);
    response.status(200).json({ nonce: challenge.nonce, message: challenge.message, expiresAt: challenge.expiresAt.toISOString() });
  } catch (error) {
    respondToWalletAuthError(error, response);
  }
}

export default function handler(request: WalletAuthRequest, response: WalletAuthResponse): Promise<void> {
  return handleWalletAuthChallengeRequest(request, response);
}