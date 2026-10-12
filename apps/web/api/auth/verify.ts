import {
  assertRequestOrigin,
  createProductionWalletAuthDependencies,
  respondToWalletAuthError,
  serializeWalletSessionCookie,
  verifyWalletChallenge,
  type WalletAuthDependencies,
  type WalletAuthRequest,
  type WalletAuthResponse,
} from '../../server/wallet-auth';

export async function handleWalletAuthVerifyRequest(
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
    const body = request.body && typeof request.body === 'object'
      ? request.body as Record<string, unknown>
      : {};
    if (typeof body.nonce !== 'string' || typeof body.signature !== 'string') {
      response.status(400).json({ error: 'A challenge nonce and wallet signature are required.' });
      return;
    }
    const verified = await verifyWalletChallenge(body.nonce, body.signature, dependencies);
    const secure = dependencies.authOrigin.startsWith('https://');
    response.setHeader('Set-Cookie', serializeWalletSessionCookie(verified.sessionToken, secure));
    response.status(200).json({
      authenticatedWalletAddress: verified.context.authenticatedWalletAddress,
      expiresAt: verified.context.expiresAt,
    });
  } catch (error) {
    respondToWalletAuthError(error, response);
  }
}

export default function handler(request: WalletAuthRequest, response: WalletAuthResponse): Promise<void> {
  return handleWalletAuthVerifyRequest(request, response);
}