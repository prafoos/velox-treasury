import 'dotenv/config';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from 'viem';

const { Client } = pg;

export const WALLET_AUTH_COOKIE = 'velox_session';
export const WALLET_AUTH_CHAIN_ID = 5042;
export const WALLET_AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const WALLET_AUTH_SESSION_TTL_SECONDS = 15 * 60;

export interface WalletAuthRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  auth?: WalletAuthContext;
}

export interface WalletAuthResponse {
  status(code: number): WalletAuthResponse;
  setHeader(name: string, value: string): WalletAuthResponse;
  json(body: unknown): void;
}

export interface WalletAuthContext {
  readonly authenticatedWalletAddress: Address;
  readonly expiresAt: string;
}

export interface WalletChallenge {
  readonly nonce: string;
  readonly address: Address;
  readonly message: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt?: Date | null;
}

export interface WalletChallengeStore {
  create(challenge: WalletChallenge): Promise<void>;
  get(nonce: string): Promise<WalletChallenge | null>;
  consume(nonce: string, address: Address, now: Date): Promise<boolean>;
}

export interface WalletAuthDependencies {
  readonly authOrigin: string;
  readonly sessionSecret: string;
  readonly store: WalletChallengeStore;
  readonly now?: () => Date;
  readonly createNonce?: () => string;
}

export class WalletAuthError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'WalletAuthError';
  }
}

export class WalletAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletAuthConfigurationError';
  }
}

function canonicalAddress(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
    throw new WalletAuthError(400, 'A valid wallet address is required.');
  }
  return getAddress(value.toLowerCase() as Address);
}

function validateSessionSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new WalletAuthConfigurationError('Wallet session authentication is not configured.');
  }
}

function validateOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new WalletAuthConfigurationError('Wallet authentication origin is not configured.');
  }
  const isLocalHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.origin !== origin || (parsed.protocol !== 'https:' && !isLocalHttp)) {
    throw new WalletAuthConfigurationError('Wallet authentication origin is not configured.');
  }
  return parsed.origin;
}

function getHeader(request: WalletAuthRequest, name: string): string | undefined {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function assertRequestOrigin(request: WalletAuthRequest, authOrigin: string): void {
  if (getHeader(request, 'origin') !== validateOrigin(authOrigin)) {
    throw new WalletAuthError(403, 'Request origin is not allowed.');
  }
}

function getCookie(request: WalletAuthRequest, name: string): string | undefined {
  const cookieHeader = getHeader(request, 'cookie');
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function hmac(value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

function createSession(secret: string, address: Address, now: Date): { token: string; context: WalletAuthContext } {
  validateSessionSecret(secret);
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAt + WALLET_AUTH_SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({
    issuer: 'velox-treasury-api',
    address,
    issuedAt,
    expiresAt: expiresAtSeconds,
  })).toString('base64url');
  const token = `${payload}.${hmac(payload, secret).toString('base64url')}`;
  return {
    token,
    context: {
      authenticatedWalletAddress: address,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    },
  };
}

export function createWalletSessionToken(address: string, secret: string, now = new Date()): string {
  return createSession(secret, canonicalAddress(address), now).token;
}

export function serializeWalletSessionCookie(token: string, secure: boolean): string {
  return `${WALLET_AUTH_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${WALLET_AUTH_SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

export function requireAuthenticatedWallet(
  request: WalletAuthRequest,
  sessionSecret = process.env.AUTH_SESSION_SECRET,
  now = new Date(),
): WalletAuthContext {
  if (!sessionSecret) throw new WalletAuthConfigurationError('Wallet session authentication is not configured.');
  validateSessionSecret(sessionSecret);

  const token = getCookie(request, WALLET_AUTH_COOKIE);
  if (!token || token.length > 2048) throw new WalletAuthError(401, 'Authentication required.');
  const [payload, encodedSignature, extra] = token.split('.');
  if (!payload || !encodedSignature || extra !== undefined) throw new WalletAuthError(401, 'Authentication required.');

  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    throw new WalletAuthError(401, 'Authentication required.');
  }
  const expectedSignature = hmac(payload, sessionSecret);
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new WalletAuthError(401, 'Authentication required.');
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      issuer?: unknown;
      address?: unknown;
      issuedAt?: unknown;
      expiresAt?: unknown;
    };
    const address = canonicalAddress(session.address);
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (session.issuer !== 'velox-treasury-api'
      || typeof session.issuedAt !== 'number'
      || typeof session.expiresAt !== 'number'
      || session.issuedAt > nowSeconds
      || session.expiresAt <= nowSeconds
      || session.expiresAt - session.issuedAt > WALLET_AUTH_SESSION_TTL_SECONDS) {
      throw new WalletAuthError(401, 'Authentication required.');
    }
    const context = {
      authenticatedWalletAddress: address,
      expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    };
    request.auth = context;
    return context;
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    throw new WalletAuthError(401, 'Authentication required.');
  }
}

function authOriginFromEnvironment(): string {
  const origin = process.env.AUTH_ORIGIN;
  if (!origin) throw new WalletAuthConfigurationError('Wallet authentication origin is not configured.');
  return validateOrigin(origin);
}

function sessionSecretFromEnvironment(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new WalletAuthConfigurationError('Wallet session authentication is not configured.');
  validateSessionSecret(secret);
  return secret;
}

async function withPostgresClient<T>(connectionString: string, run: (client: InstanceType<typeof Client>) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export function createPostgresWalletChallengeStore(connectionString = process.env.POSTGRES_URL): WalletChallengeStore {
  if (!connectionString) throw new WalletAuthConfigurationError('Wallet challenge storage is not configured.');
  return {
    async create(challenge) {
      await withPostgresClient(connectionString, async (client) => {
        await client.query('DELETE FROM wallet_auth_challenges WHERE expires_at <= NOW()');
        await client.query(
          `INSERT INTO wallet_auth_challenges (nonce, wallet_address, message, issued_at, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [challenge.nonce, challenge.address, challenge.message, challenge.issuedAt, challenge.expiresAt],
        );
      });
    },
    async get(nonce) {
      return withPostgresClient(connectionString, async (client) => {
        const result = await client.query<{
          nonce: string;
          wallet_address: string;
          message: string;
          issued_at: Date;
          expires_at: Date;
          consumed_at: Date | null;
        }>(
          `SELECT nonce, wallet_address, message, issued_at, expires_at, consumed_at
           FROM wallet_auth_challenges WHERE nonce = $1`,
          [nonce],
        );
        const row = result.rows[0];
        return row ? {
          nonce: row.nonce,
          address: canonicalAddress(row.wallet_address),
          message: row.message,
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
          consumedAt: row.consumed_at,
        } : null;
      });
    },
    async consume(nonce, address, now) {
      return withPostgresClient(connectionString, async (client) => {
        const result = await client.query(
          `UPDATE wallet_auth_challenges SET consumed_at = NOW()
           WHERE nonce = $1 AND lower(wallet_address) = lower($2)
             AND consumed_at IS NULL AND expires_at > $3
           RETURNING nonce`,
          [nonce, address, now],
        );
        return result.rowCount === 1;
      });
    },
  };
}

export function createProductionWalletAuthDependencies(): WalletAuthDependencies {
  return {
    authOrigin: authOriginFromEnvironment(),
    sessionSecret: sessionSecretFromEnvironment(),
    store: createPostgresWalletChallengeStore(),
  };
}

export function createWalletAuthMessage(
  address: Address,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date,
  authOrigin: string,
): string {
  const origin = validateOrigin(authOrigin);
  const domain = new URL(origin).host;
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Velox Treasury API. No blockchain transaction will be sent.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${WALLET_AUTH_CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
}

export async function issueWalletChallenge(
  addressValue: unknown,
  dependencies: WalletAuthDependencies,
): Promise<WalletChallenge> {
  validateSessionSecret(dependencies.sessionSecret);
  const authOrigin = validateOrigin(dependencies.authOrigin);
  const address = canonicalAddress(addressValue);
  const issuedAt = dependencies.now?.() ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + WALLET_AUTH_CHALLENGE_TTL_MS);
  const nonce = dependencies.createNonce?.() ?? randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{64}$/.test(nonce)) throw new WalletAuthConfigurationError('Wallet challenge generation failed.');
  const challenge: WalletChallenge = {
    nonce,
    address,
    issuedAt,
    expiresAt,
    message: createWalletAuthMessage(address, nonce, issuedAt, expiresAt, authOrigin),
  };
  await dependencies.store.create(challenge);
  return challenge;
}

export async function verifyWalletChallenge(
  nonce: string,
  signature: string,
  dependencies: WalletAuthDependencies,
): Promise<{ context: WalletAuthContext; sessionToken: string }> {
  if (!/^[0-9a-f]{64}$/.test(nonce) || !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)) {
    throw new WalletAuthError(401, 'Wallet signature could not be verified.');
  }
  const now = dependencies.now?.() ?? new Date();
  const challenge = await dependencies.store.get(nonce);
  if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= now.getTime()) {
    throw new WalletAuthError(401, 'Wallet challenge is invalid or expired.');
  }

  const address = canonicalAddress(challenge.address);
  let valid = false;
  try {
    valid = await verifyMessage({ address, message: challenge.message, signature: signature as Hex });
  } catch {
    valid = false;
  }
  if (!valid) throw new WalletAuthError(401, 'Wallet signature could not be verified.');
  if (!await dependencies.store.consume(nonce, address, now)) {
    throw new WalletAuthError(401, 'Wallet challenge is invalid or expired.');
  }

  const session = createSession(dependencies.sessionSecret, address, now);
  return { context: session.context, sessionToken: session.token };
}

export function respondToWalletAuthError(error: unknown, response: WalletAuthResponse): void {
  if (error instanceof WalletAuthError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }
  response.status(503).json({ error: 'Wallet authentication is temporarily unavailable.' });
}
