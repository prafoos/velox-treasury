import { timingSafeEqual } from 'node:crypto';

import {
  runScheduledStrategyValuationSync,
  StrategyAutomationError,
  type ScheduledStrategyValuationSync,
} from './strategy-automation';

interface ScheduledRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
}

interface ScheduledResponse {
  status(code: number): ScheduledResponse;
  setHeader(name: string, value: string): ScheduledResponse;
  json(body: unknown): void;
}

type ScheduledDependenciesFactory = NonNullable<Parameters<typeof runScheduledStrategyValuationSync>[0]>;

function isAuthorizedCronRequest(request: ScheduledRequest, secret: string): boolean {
  const header = request.headers?.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return false;
  const expected = Buffer.from(secret, 'utf8');
  const supplied = Buffer.from(match[1], 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function serializeResult(result: ScheduledStrategyValuationSync) {
  if (result.status === 'skipped') {
    return { status: result.status, reason: result.reason, blockNumber: result.blockNumber.toString() };
  }
  return {
    status: result.status,
    operation: result.operation,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber.toString(),
    coreAddress: result.coreAddress,
    strategyAddress: result.strategyAddress,
    readback: Object.fromEntries(
      Object.entries(result.readback).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]),
    ),
  };
}

export async function handleStrategyValuationCronRequest(
  request: ScheduledRequest,
  response: ScheduledResponse,
  dependenciesFactory?: ScheduledDependenciesFactory,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (environment.VERCEL_ENV !== 'production') {
    response.status(404).json({ error: 'Scheduled valuation sync is available only in the production runtime.' });
    return;
  }
  const secret = environment.CRON_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    response.status(503).json({ error: 'Scheduled valuation sync is not configured.' });
    return;
  }
  if (!isAuthorizedCronRequest(request, secret)) {
    response.status(401).json({ error: 'Unauthorized scheduled request.' });
    return;
  }

  try {
    const result = dependenciesFactory
      ? await runScheduledStrategyValuationSync(dependenciesFactory)
      : await runScheduledStrategyValuationSync();
    response.status(200).json(serializeResult(result));
  } catch (error) {
    const failure = error instanceof StrategyAutomationError
      ? error
      : new StrategyAutomationError('CONFIGURATION', 'Scheduled valuation sync could not verify its configuration or Core state.');
    const statusCode = failure.kind === 'UNAUTHORIZED' ? 403
      : failure.kind === 'CONFIGURATION' ? 503 : 502;
    response.status(statusCode).json({
      error: failure.message,
      kind: failure.kind,
      ...(failure.transactionHash ? { transactionHash: failure.transactionHash } : {}),
      ...(failure.correlationId ? { correlationId: failure.correlationId } : {}),
    });
  }
}

export default function handler(request: ScheduledRequest, response: ScheduledResponse): Promise<void> {
  return handleStrategyValuationCronRequest(request, response);
}
