import { createGeminiAdapter, createVeloxAiService } from '../agent/index.js';
import type { AdminAiInput, UserAiInput } from '../agent/types.js';
import type { AuthenticatedAdminApprovalContext } from '../policy/index.js';
import { requireAuthenticatedWallet, WalletAuthError, type WalletAuthRequest } from '../../../web/server/wallet-auth.js';

export interface AiRouteResponse {
  status(code: number): AiRouteResponse;
  setHeader(name: string, value: string): AiRouteResponse;
  json(body: unknown): void;
}

export interface AiRouteDependencies {
  readonly createService?: () => {
    readonly generateUserAnalysis: (input: UserAiInput, userQuery?: string) => Promise<string>;
    readonly generateAdminRecommendation: (
      projection: AdminAiInput,
      authContext: AuthenticatedAdminApprovalContext,
      options?: { readonly prompt?: string; readonly recommendationId?: string; readonly createdAt?: Date | string | number; },
    ) => Promise<unknown>;
  };
  readonly resolveUserProjection?: (walletAddress: `0x${string}`) => Promise<UserAiInput>;
  readonly resolveAdminProjection?: (walletAddress: `0x${string}`) => Promise<AdminAiInput>;
}

function normalizePrompt(body: unknown): string {
  if (body && typeof body === 'object') {
    const candidate = (body as Record<string, unknown>).prompt
      ?? (body as Record<string, unknown>).question
      ?? (body as Record<string, unknown>).message
      ?? (body as Record<string, unknown>).query;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.trim();
  }
  throw new WalletAuthError(400, 'A non-empty AI prompt is required.');
}

function respondUnauthorizedOrUnavailable(error: unknown, response: AiRouteResponse): void {
  if (error instanceof WalletAuthError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }
  response.status(503).json({ error: 'AI request is temporarily unavailable.' });
}

export async function handleUserAiRequest(
  request: WalletAuthRequest,
  response: AiRouteResponse,
  dependencies: AiRouteDependencies = {},
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method && request.method.toUpperCase() !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let walletAddress: `0x${string}`;
  try {
    walletAddress = requireAuthenticatedWallet(request).authenticatedWalletAddress as `0x${string}`;
  } catch (error) {
    respondUnauthorizedOrUnavailable(error, response);
    return;
  }

  let prompt: string;
  try {
    prompt = normalizePrompt(request.body);
  } catch (error) {
    respondUnauthorizedOrUnavailable(error, response);
    return;
  }

  try {
    const resolveUserProjection = dependencies.resolveUserProjection ?? (async (account: `0x${string}`) => {
      if (account.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new WalletAuthError(403, 'Requested account does not match the authenticated wallet.');
      }
      throw new Error('User AI projection resolver is not configured.');
    });

    const projection = await resolveUserProjection(walletAddress);
    const service = dependencies.createService ?? (() => createVeloxAiService(createGeminiAdapter({
      apiKey: process.env.GEMINI_API_KEY,
    })));

    const answer = await service().generateUserAnalysis(projection, prompt);
    response.status(200).json({
      scope: 'USER',
      walletAddress,
      answer,
    });
  } catch (error) {
    if (error instanceof WalletAuthError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'User AI request failed.';
    response.status(500).json({ error: message });
  }
}

export async function handleAdminAiRequest(
  request: WalletAuthRequest,
  response: AiRouteResponse,
  dependencies: AiRouteDependencies = {},
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method && request.method.toUpperCase() !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let walletAddress: `0x${string}`;
  try {
    walletAddress = requireAuthenticatedWallet(request).authenticatedWalletAddress as `0x${string}`;
  } catch (error) {
    respondUnauthorizedOrUnavailable(error, response);
    return;
  }

  let prompt: string;
  try {
    prompt = normalizePrompt(request.body);
  } catch (error) {
    respondUnauthorizedOrUnavailable(error, response);
    return;
  }

  try {
    const resolveAdminProjection = dependencies.resolveAdminProjection ?? (async (account: `0x${string}`) => {
      if (account.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new WalletAuthError(403, 'Requested account does not match the authenticated wallet.');
      }
      throw new Error('Admin AI projection resolver is not configured.');
    });

    const projection = await resolveAdminProjection(walletAddress);
    const service = dependencies.createService ?? (() => createVeloxAiService(createGeminiAdapter({
      apiKey: process.env.GEMINI_API_KEY,
    })));

    const recommendation = await service().generateAdminRecommendation(projection, {
      authenticatedWalletAddress: walletAddress,
      chainId: 5042,
      policyAdminRoleVerified: true,
    }, { prompt });

    response.status(200).json({
      scope: 'ADMIN',
      walletAddress,
      recommendation,
    });
  } catch (error) {
    if (error instanceof WalletAuthError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Admin AI request failed.';
    response.status(500).json({ error: message });
  }
}
