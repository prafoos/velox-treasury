import { Buffer } from 'node:buffer';
import { toEventSelector, toFunctionSelector } from 'viem';
import { ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS, ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS } from '../../api/src/config/arc-mainnet.js';
import { APPROVED_ARC_MAINNET_CORE_ADDRESS } from '../src/contracts/treasury.js';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../src/contracts/usdc.js';

const ARC_MAINNET_RPC_URL = 'https://rpc.mainnet.arc.io/';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_SIZE = 10;
const MAX_LOG_BLOCK_RANGE = 100_000n;
const LOG_RANGE_COST_BLOCKS = 10_000n;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 300;
const MAX_CONCURRENT_REQUESTS = 20;
const MAX_RATE_LIMIT_ENTRIES = 5_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const CORE_ADDRESS = APPROVED_ARC_MAINNET_CORE_ADDRESS.toLowerCase();
const ADAPTER_ADDRESS = ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS.toLowerCase();
const VAULT_ADDRESS = ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS.toLowerCase();
const USDC_ADDRESS = ARC_USDC_CONTRACT_ADDRESS.toLowerCase();
const ARC_MAINNET_CHAIN_ID_HEX = `0x${ARC_MAINNET_CHAIN_ID.toString(16)}`;
const USDC_GETTER_SELECTOR = toFunctionSelector('usdc()');
interface SafeCall {
  readonly calldataLength: number;
  readonly addressWords?: Readonly<Record<number, string | null>>;
}

function safeCall(
  signature: string,
  argumentCount: number,
  addressWords?: Readonly<Record<number, string | null>>,
): readonly [string, SafeCall] {
  return [
    toFunctionSelector(signature),
    { calldataLength: 10 + argumentCount * 64, ...(addressWords ? { addressWords } : {}) },
  ];
}

const SAFE_ETH_CALLS = new Map<string, ReadonlyMap<string, SafeCall>>([
  [CORE_ADDRESS, new Map([
    safeCall('hasRole(bytes32,address)', 2, { 1: null }),
    safeCall('paused()', 0),
    [USDC_GETTER_SELECTOR, { calldataLength: 10 }],
    safeCall('protocolVaults(bytes32)', 1),
    safeCall('valuationFreshnessBlocks()', 0),
    safeCall('strategies(address)', 1, { 0: null }),
    safeCall('protocolCaps(bytes32)', 1),
    safeCall('assetCaps(address)', 1, { 0: null }),
    safeCall('pendingOperations(bytes32)', 1),
    safeCall('userBalance(address)', 1, { 0: null }),
    safeCall('immediatelyWithdrawableValue(address)', 1, { 0: null }),
    safeCall('liquidUSDC()', 0),
    safeCall('userStrategyPosition(address,address)', 2, { 0: null, 1: ADAPTER_ADDRESS }),
    safeCall('totalDeployed()', 0),
  ])],
  [ADAPTER_ADDRESS, new Map([
    safeCall('core()', 0),
    safeCall('protocol()', 0),
    safeCall('asset()', 0),
    safeCall('vault()', 0),
    safeCall('currentValue()', 0),
    safeCall('sharesOfCore()', 0),
    safeCall('feesAccrued()', 0),
    safeCall('previewRedeem(uint256)', 1),
  ])],
  [VAULT_ADDRESS, new Map([
    safeCall('asset()', 0),
  ])],
  [USDC_ADDRESS, new Map([
    safeCall('balanceOf(address)', 1, { 0: null }),
    safeCall('allowance(address,address)', 2, { 0: null, 1: CORE_ADDRESS }),
  ])],
]);
const TRANSACTION_EVENT_TOPICS = new Set([
  toEventSelector('Deposit(address,uint256,uint256,uint256)'),
  toEventSelector('Withdrawal(address,address,uint256,uint256,uint256)'),
]);

const READ_ONLY_METHODS = [
  'eth_chainId',
  'eth_getCode',
  'eth_call',
  'eth_blockNumber',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByNumber',
] as const;

type RpcId = string | number;

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: RpcId;
  readonly method: typeof READ_ONLY_METHODS[number];
  readonly params?: readonly unknown[];
}

interface RateLimitEntry {
  windowStartedAt: number;
  requestCount: number;
  activeRequests: number;
}

export interface ChainReadRequest {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body?: unknown;
}

export interface ChainReadResponse {
  status(code: number): ChainReadResponse;
  setHeader(name: string, value: string | number): ChainReadResponse;
  json(body: unknown): void;
}

export interface ChainReadHandlerDependencies {
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
};

function reject(response: ChainReadResponse, status: number, error: string): void {
  response.status(status).json({ error });
}

function getHeader(request: ChainReadRequest, name: string): string | undefined {
  const value = Object.entries(request.headers ?? {})
    .find(([headerName]) => headerName.toLowerCase() === name)?.[1];
  return typeof value === 'string' ? value : value?.[0];
}

function getClientKey(request: ChainReadRequest): string {
  const directAddress = getHeader(request, 'x-real-ip')?.trim();
  if (directAddress) return directAddress.slice(0, 128);
  const forwardedAddress = getHeader(request, 'x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedAddress ? forwardedAddress.slice(0, 128) : 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isQuantity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 66
    && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value);
}

function isBlockReference(value: unknown): value is string {
  return value === 'latest' || isQuantity(value);
}

function validCoreLogFilter(params: readonly unknown[]): boolean {
  if (params.length !== 1 || !isRecord(params[0])) return false;
  const filter = params[0];
  if (!hasOnlyKeys(filter, ['address', 'fromBlock', 'toBlock', 'topics'])
    || typeof filter.address !== 'string'
    || filter.address.toLowerCase() !== CORE_ADDRESS
    || !isQuantity(filter.fromBlock)
    || !isQuantity(filter.toBlock)
    || !Array.isArray(filter.topics)) {
    return false;
  }

  const fromBlock = BigInt(filter.fromBlock);
  const toBlock = BigInt(filter.toBlock);
  if (fromBlock > toBlock || toBlock - fromBlock >= MAX_LOG_BLOCK_RANGE) return false;

  const topics = filter.topics;
  if (topics.length < 2 || topics.length > 3
    || typeof topics[0] !== 'string'
    || !TRANSACTION_EVENT_TOPICS.has(topics[0] as `0x${string}`)
    || typeof topics[1] !== 'string'
    || !/^0x0{24}[a-fA-F0-9]{40}$/.test(topics[1])) {
    return false;
  }

  const isWithdrawal = topics[0] === toEventSelector('Withdrawal(address,address,uint256,uint256,uint256)');
  return isWithdrawal
    ? topics.length === 2 || topics[2] === null
    : topics.length === 2;
}

function isAllowedContractCall(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['to', 'data'])
    || typeof value.to !== 'string'
    || typeof value.data !== 'string'
    || !/^0x[0-9a-fA-F]+$/.test(value.data)) {
    return false;
  }
  const allowedCalls = SAFE_ETH_CALLS.get(value.to.toLowerCase());
  const call = allowedCalls?.get(value.data.slice(0, 10).toLowerCase());
  if (!call || value.data.length !== call.calldataLength) return false;
  for (const [wordIndex, allowedAddress] of Object.entries(call.addressWords ?? {})) {
    const start = 10 + Number(wordIndex) * 64;
    const word = value.data.slice(start, start + 64);
    if (!/^0{24}[a-fA-F0-9]{40}$/.test(word)) return false;
    if (allowedAddress !== null && `0x${word.slice(24)}`.toLowerCase() !== allowedAddress) return false;
  }
  return true;
}

function validateRpcRequest(value: unknown): JsonRpcRequest | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['jsonrpc', 'id', 'method', 'params'])
    || value.jsonrpc !== '2.0'
    || (typeof value.id !== 'string'
      && !(typeof value.id === 'number' && Number.isSafeInteger(value.id)))
    || typeof value.method !== 'string'
    || !READ_ONLY_METHODS.includes(value.method as typeof READ_ONLY_METHODS[number])) {
    return null;
  }

  const params = value.params === undefined ? [] : value.params;
  if (!Array.isArray(params)) return null;

  switch (value.method) {
    case 'eth_chainId':
    case 'eth_blockNumber':
      if (params.length !== 0) return null;
      break;
    case 'eth_getCode':
      if (params.length !== 2
        || !isAddress(params[0])
        || ![CORE_ADDRESS, ADAPTER_ADDRESS].includes(params[0].toLowerCase())
        || params[1] !== 'latest') return null;
      break;
    case 'eth_call': {
      if (params.length !== 2 || !isBlockReference(params[1]) || !isAllowedContractCall(params[0])) return null;
      break;
    }
    case 'eth_getLogs':
      if (!validCoreLogFilter(params)) return null;
      break;
    case 'eth_getTransactionByHash':
    case 'eth_getTransactionReceipt':
      if (params.length !== 1 || !isHash(params[0])) return null;
      break;
    case 'eth_getBlockByNumber':
      if (params.length !== 2 || !isQuantity(params[0]) || params[1] !== false) return null;
      break;
    default:
      return null;
  }

  return {
    jsonrpc: '2.0',
    id: value.id,
    method: value.method as JsonRpcRequest['method'],
    ...(value.params === undefined ? {} : { params }),
  };
}

function parseRequestBody(body: unknown): unknown | null {
  if (typeof body !== 'string') return body ?? null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function validateRequestPayload(payload: unknown): payload is JsonRpcRequest | readonly JsonRpcRequest[] {
  if (Array.isArray(payload)) {
    if (payload.length === 0 || payload.length > MAX_BATCH_SIZE) return false;
    const validated = payload.map(validateRpcRequest);
    if (validated.some((request) => request === null)) return false;
    const ids = new Set(validated.map((request) => JSON.stringify(request?.id)));
    return ids.size === payload.length;
  }
  return validateRpcRequest(payload) !== null;
}

function validateRpcResponse(value: unknown, request: JsonRpcRequest | readonly JsonRpcRequest[]): boolean {
  const expectedIds = new Set(
    (Array.isArray(request) ? request : [request]).map((entry) => JSON.stringify(entry.id)),
  );
  if (Array.isArray(value)) {
    return value.length === expectedIds.size
      && value.every((entry) => isRecord(entry)
        && entry.jsonrpc === '2.0'
        && expectedIds.has(JSON.stringify(entry.id))
        && (Object.hasOwn(entry, 'result') || isRecord(entry.error)));
  }
  return isRecord(value)
    && !Array.isArray(request)
    && value.jsonrpc === '2.0'
    && expectedIds.has(JSON.stringify(value.id))
    && (Object.hasOwn(value, 'result') || isRecord(value.error));
}

function hasArcMainnetChainId(
  value: unknown,
  request: JsonRpcRequest | readonly JsonRpcRequest[],
): boolean {
  const requests = Array.isArray(request) ? request : [request];
  const responses = Array.isArray(value) ? value : [value];
  return requests.every((entry) => {
    if (entry.method !== 'eth_chainId') return true;
    const response = responses.find((candidate) => isRecord(candidate)
      && JSON.stringify(candidate.id) === JSON.stringify(entry.id));
    return !isRecord(response)
      || !Object.hasOwn(response, 'result')
      || response.result === ARC_MAINNET_CHAIN_ID_HEX;
  });
}

function getRequestCost(payload: JsonRpcRequest | readonly JsonRpcRequest[]): number {
  const requests = Array.isArray(payload) ? payload : [payload];
  return requests.reduce((cost, request) => {
    if (request.method !== 'eth_getLogs') return cost + 1;
    const filter = request.params?.[0];
    if (!isRecord(filter) || !isQuantity(filter.fromBlock) || !isQuantity(filter.toBlock)) {
      throw new Error('Validated Arc event filter is malformed.');
    }
    const range = BigInt(filter.toBlock) - BigInt(filter.fromBlock) + 1n;
    return cost + Number((range + LOG_RANGE_COST_BLOCKS - 1n) / LOG_RANGE_COST_BLOCKS);
  }, 0);
}

function enforceRateLimit(
  entries: Map<string, RateLimitEntry>,
  key: string,
  now: number,
): 'allowed' | 'rate' | 'concurrency' {
  let entry = entries.get(key);
  if (!entry) {
    if (entries.size >= MAX_RATE_LIMIT_ENTRIES) {
      for (const [existingKey, existing] of entries) {
        if (now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS && existing.activeRequests === 0) {
          entries.delete(existingKey);
        }
      }
    }
    if (entries.size >= MAX_RATE_LIMIT_ENTRIES && !entry) return 'rate';
    entry = { windowStartedAt: now, requestCount: 0, activeRequests: 0 };
    entries.set(key, entry);
  } else if (now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    entry.windowStartedAt = now;
    entry.requestCount = 0;
  }

  if (entry.requestCount >= RATE_LIMIT_REQUESTS) return 'rate';
  if (entry.activeRequests >= MAX_CONCURRENT_REQUESTS) return 'concurrency';
  entry.requestCount += 1;
  entry.activeRequests += 1;
  return 'allowed';
}

function addRateLimitCost(
  entries: Map<string, RateLimitEntry>,
  key: string,
  additionalCost: number,
): boolean {
  const entry = entries.get(key);
  if (!entry || entry.requestCount + additionalCost > RATE_LIMIT_REQUESTS) return false;
  entry.requestCount += additionalCost;
  return true;
}

async function readBoundedResponse(response: Response, controller: AbortController): Promise<unknown | null> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    controller.abort();
    return null;
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        controller.abort();
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export function createChainReadHandler(
  dependencies: ChainReadHandlerDependencies = {},
): (request: ChainReadRequest, response: ChainReadResponse) => Promise<void> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const now = dependencies.now ?? Date.now;
  const rateLimitEntries = new Map<string, RateLimitEntry>();

  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method?.toUpperCase() !== 'POST') {
      response.setHeader('Allow', 'POST');
      reject(response, 405, 'Method not allowed.');
      return;
    }

    if (!getHeader(request, 'content-type')?.toLowerCase().startsWith('application/json')) {
      reject(response, 415, 'Arc read requests must use application/json.');
      return;
    }

    const rateResult = enforceRateLimit(rateLimitEntries, getClientKey(request), now());
    if (rateResult !== 'allowed') {
      response.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
      reject(response, 429, rateResult === 'rate'
        ? 'Arc read request rate limit exceeded.'
        : 'Too many concurrent Arc read requests.');
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPSTREAM_TIMEOUT_MS);
    try {
      const contentLength = Number(getHeader(request, 'content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        reject(response, 413, 'Arc read request body is too large.');
        return;
      }

      const body = request.body;
      let serializedBody: string;
      if (typeof body === 'string') {
        if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
          reject(response, 413, 'Arc read request body is too large.');
          return;
        }
        serializedBody = body;
      } else {
        try {
          serializedBody = JSON.stringify(body);
        } catch {
          reject(response, 400, 'Arc read request body is malformed.');
          return;
        }
        if (!serializedBody || Buffer.byteLength(serializedBody, 'utf8') > MAX_REQUEST_BYTES) {
          reject(response, serializedBody ? 413 : 400, serializedBody
            ? 'Arc read request body is too large.'
            : 'Arc read request body is malformed.');
          return;
        }
      }

      const payload = parseRequestBody(serializedBody);
      if (payload === null || !validateRequestPayload(payload)) {
        reject(response, Buffer.byteLength(serializedBody, 'utf8') > MAX_REQUEST_BYTES ? 413 : 400,
          'Arc read request is malformed or contains a disallowed method or parameter.');
        return;
      }
      const requestCost = getRequestCost(payload);
      if (!addRateLimitCost(rateLimitEntries, getClientKey(request), requestCost - 1)) {
        response.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
        reject(response, 429, 'Arc read request rate limit exceeded.');
        return;
      }

      const upstreamResponse = await fetchFn(ARC_MAINNET_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: serializedBody,
        signal: controller.signal,
      });
      if (!upstreamResponse.ok) {
        reject(response, 502, 'Arc Mainnet RPC request failed.');
        return;
      }

      const upstreamPayload = await readBoundedResponse(upstreamResponse, controller);
      if (upstreamPayload === null
        || !validateRpcResponse(upstreamPayload, payload)
        || !hasArcMainnetChainId(upstreamPayload, payload)) {
        reject(response, 502, 'Arc Mainnet RPC returned an invalid or oversized response.');
        return;
      }
      response.status(200).json(upstreamPayload);
    } catch {
      if (timedOut) {
        reject(response, 504, 'Arc Mainnet RPC request timed out.');
        return;
      }
      reject(response, 502, 'Arc Mainnet RPC request failed.');
    } finally {
      clearTimeout(timeoutHandle);
      const entry = rateLimitEntries.get(getClientKey(request));
      if (entry) entry.activeRequests = Math.max(0, entry.activeRequests - 1);
    }
  };
}

const handler = createChainReadHandler();

export default handler;
