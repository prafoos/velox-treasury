import { describe, expect, it, vi } from 'vitest';
import { toEventSelector, toFunctionSelector } from 'viem';
import {
  APPROVED_ARC_MAINNET_CORE_ADDRESS,
} from '../contracts/treasury';
import { ARC_USDC_CONTRACT_ADDRESS } from '../contracts/usdc';
import {
  ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS,
  ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS,
} from '../../../api/src/config/arc-mainnet';
import {
  createChainReadHandler,
  type ChainReadRequest,
  type ChainReadResponse,
} from '../../api/chain-read';

const core = APPROVED_ARC_MAINNET_CORE_ADDRESS;
const adapter = ARC_MAINNET_READ_ONLY_STEAKHOUSE_ADAPTER_ADDRESS;
const vault = ARC_MAINNET_STEAKHOUSE_VAULT_ADDRESS;
const usdc = ARC_USDC_CONTRACT_ADDRESS;
const userAddress = '0x1234567890abcdef1234567890abcdef12345678';
const accountTopic = `0x${'0'.repeat(24)}1234567890abcdef1234567890abcdef12345678`;
const transactionHash = `0x${'a'.repeat(64)}`;
const depositTopic = toEventSelector('Deposit(address,uint256,uint256,uint256)');
const withdrawalTopic = toEventSelector('Withdrawal(address,address,uint256,uint256,uint256)');

interface CapturedResponse {
  statusCode: number;
  readonly headers: Record<string, string | number>;
  body?: unknown;
}

function createResponse(): CapturedResponse & ChainReadResponse {
  return {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
}

function createRequest(body: unknown, headers: ChainReadRequest['headers'] = {
  'content-type': 'application/json',
  'x-real-ip': '192.0.2.1',
}): ChainReadRequest {
  return { method: 'POST', headers, body };
}

function rpcRequest(method: string, params?: readonly unknown[]) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

function encodedCall(signature: string, ...words: readonly string[]) {
  return `0x${toFunctionSelector(signature).slice(2)}${words.map((word) => word.replace(/^0x/, '').padStart(64, '0')).join('')}`;
}

function successResponse(id: string | number = 1, result = '0x13b2'): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Arc Mainnet chain-read relay', () => {
  it.each([
    rpcRequest('eth_chainId'),
    rpcRequest('eth_getCode', [core, 'latest']),
    rpcRequest('eth_getCode', [adapter, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: toFunctionSelector('usdc()') }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: toFunctionSelector('paused()') }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: toFunctionSelector('liquidUSDC()') }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: toFunctionSelector('bucketPolicy()') }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: encodedCall('userBalance(address)', userAddress) }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: encodedCall('immediatelyWithdrawableValue(address)', userAddress) }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: encodedCall('userStrategyPosition(address,address)', userAddress, adapter),
    }, '0x100'],
    ),
    rpcRequest('eth_call', [{
      to: core,
      data: encodedCall('strategies(address)', adapter),
    }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: toFunctionSelector('totalDeployed()') }, 'latest']),
    rpcRequest('eth_call', [{
      to: usdc,
      data: encodedCall('allowance(address,address)', userAddress, core),
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: usdc,
      data: encodedCall('balanceOf(address)', userAddress),
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: adapter,
      data: encodedCall('previewRedeem(uint256)', '0x1234'),
    }, '0x100']),
    rpcRequest('eth_call', [{
      to: core,
      data: `${toFunctionSelector('hasRole(bytes32,address)')}${'0'.repeat(128)}`,
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: encodedCall('strategies(address)', adapter),
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: `${toFunctionSelector('protocolVaults(bytes32)')}${'0'.repeat(64)}`,
    }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: toFunctionSelector('valuationFreshnessBlocks()') }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: `${toFunctionSelector('protocolCaps(bytes32)')}${'0'.repeat(64)}`,
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: `${toFunctionSelector('assetCaps(address)')}${'0'.repeat(64)}`,
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: `${toFunctionSelector('pendingOperations(bytes32)')}${'0'.repeat(64)}`,
    }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('core()') }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('protocol()') }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('asset()') }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('vault()') }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('currentValue()') }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('sharesOfCore()') }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('feesAccrued()') }, 'latest']),
    rpcRequest('eth_call', [{ to: vault, data: toFunctionSelector('asset()') }, 'latest']),
    rpcRequest('eth_blockNumber'),
    rpcRequest('eth_getLogs', [{
      address: core,
      fromBlock: '0x10',
      toBlock: '0x20',
      topics: [depositTopic, accountTopic],
    }]),
    rpcRequest('eth_getLogs', [{
      address: core,
      fromBlock: '0x10',
      toBlock: '0x20',
      topics: [withdrawalTopic, accountTopic, null],
    }]),
    rpcRequest('eth_getTransactionByHash', [transactionHash]),
    rpcRequest('eth_getTransactionReceipt', [transactionHash]),
    rpcRequest('eth_getBlockByNumber', ['0x10', false]),
  ])('forwards the required read-only method %s to the fixed Arc endpoint', async (body) => {
    const fetchFn = vi.fn(async () => successResponse());
    const response = createResponse();
    const handler = createChainReadHandler({ fetchFn });

    await handler(createRequest(body), response);

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledWith('https://rpc.mainnet.arc.io/', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(body),
    }));
    expect(response.statusCode).toBe(200);
  });

  it('supports receipt polling reads while rejecting broadcast RPC methods', async () => {
    const fetchFn = vi.fn(async () => successResponse());
    const handler = createChainReadHandler({ fetchFn });
    const receiptHash = `0x${'b'.repeat(64)}`;

    for (const body of [
      rpcRequest('eth_getTransactionReceipt', [receiptHash]),
      rpcRequest('eth_getTransactionByHash', [receiptHash]),
      rpcRequest('eth_blockNumber'),
      rpcRequest('eth_getBlockByNumber', ['0x100', false]),
    ]) {
      const response = createResponse();
      await handler(createRequest(body), response);
      expect(response.statusCode).toBe(200);
    }

    for (const body of [
      rpcRequest('eth_sendRawTransaction', ['0xdeadbeef']),
      rpcRequest('eth_sendTransaction', [{ from: userAddress, to: core, data: '0x12345678' }]),
    ]) {
      const response = createResponse();
      await handler(createRequest(body), response);
      expect(response.statusCode).toBe(400);
    }

    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it.each([
    rpcRequest('eth_sendRawTransaction', ['0xdeadbeef']),
    rpcRequest('eth_sendTransaction', [{ from: userAddress, to: core, data: encodedCall('withdraw(uint256,address)', '0x1', userAddress) }]),
    rpcRequest('eth_getBalance', [core, 'latest']),
    rpcRequest('eth_getCode', ['0x1234567890abcdef1234567890abcdef12345678', 'latest']),
    rpcRequest('eth_call', [{ to: core, data: '0x12345678' }, 'latest']),
    rpcRequest('eth_call', [{
      to: usdc,
      data: encodedCall('allowance(address,address)', userAddress, adapter),
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: usdc,
      data: encodedCall('balanceOf(address)', userAddress),
    }, 'pending']),
    rpcRequest('eth_call', [{
      to: core,
      data: `0x${toFunctionSelector('userBalance(address)').slice(2)}${'f'.repeat(64)}`,
    }, 'latest']),
    rpcRequest('eth_call', [{ to: usdc, data: toFunctionSelector('decimals()') }, 'latest']),
    rpcRequest('eth_call', [{
      to: usdc,
      data: encodedCall('approve(address,uint256)', core, '0x1'),
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: encodedCall('withdraw(uint256,address)', '0x1', userAddress),
    }, 'latest']),
    rpcRequest('eth_call', [{
      to: '0x1234567890abcdef1234567890abcdef12345678',
      data: encodedCall('balanceOf(address)', userAddress),
    }, 'latest']),
    rpcRequest('eth_call', [{ to: core, data: toFunctionSelector('totalUserLiabilities()') }, 'latest']),
    rpcRequest('eth_call', [{ to: adapter, data: toFunctionSelector('owner()') }, 'latest']),
    rpcRequest('eth_call', [{ to: vault, data: toFunctionSelector('totalAssets()') }, 'latest']),
    rpcRequest('eth_call', [{
      to: core,
      data: `${toFunctionSelector('paused()')}${'0'.repeat(64)}`,
    }, 'latest']),
    rpcRequest('eth_getLogs', [{
      address: '0x1234567890abcdef1234567890abcdef12345678',
      fromBlock: '0x10',
      toBlock: '0x20',
      topics: [depositTopic, accountTopic],
    }]),
    rpcRequest('eth_getLogs', [{
      address: core,
      fromBlock: '0x10',
      toBlock: '0x20',
      topics: ['0x1234', accountTopic],
    }]),
    rpcRequest('eth_getBlockByNumber', ['0x10', true]),
  ])('rejects a disallowed method or parameter without forwarding %s', async (body) => {
    const fetchFn = vi.fn(async () => successResponse());
    const response = createResponse();
    const handler = createChainReadHandler({ fetchFn });

    await handler(createRequest(body), response);

    expect(response.statusCode).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('accepts a bounded batch of allowed requests and rejects duplicate IDs', async () => {
    const batch = [rpcRequest('eth_chainId'), { ...rpcRequest('eth_blockNumber'), id: 2 }];
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(batch.map(({ id }) => ({
      jsonrpc: '2.0',
      id,
      result: id === 1 ? '0x13b2' : '0x1',
    }))), { status: 200 }));
    const handler = createChainReadHandler({ fetchFn });
    const accepted = createResponse();

    await handler(createRequest(batch), accepted);
    expect(accepted.statusCode).toBe(200);
    expect(fetchFn).toHaveBeenCalledOnce();

    const rejected = createResponse();
    await handler(createRequest([rpcRequest('eth_chainId'), rpcRequest('eth_blockNumber')]), rejected);
    expect(rejected.statusCode).toBe(400);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('rejects an upstream chain ID other than Arc Mainnet', async () => {
    const response = createResponse();
    await createChainReadHandler({
      fetchFn: vi.fn(async () => successResponse(1, '0x1')),
    })(createRequest(rpcRequest('eth_chainId')), response);

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({ error: 'Arc Mainnet RPC returned an invalid or oversized response.' });
  });

  it('rejects malformed, oversized, and oversized-batch request bodies', async () => {
    const fetchFn = vi.fn(async () => successResponse());
    const handler = createChainReadHandler({ fetchFn });

    const malformed = createResponse();
    await handler(createRequest('{"jsonrpc":'), malformed);
    expect(malformed.statusCode).toBe(400);

    const oversized = createResponse();
    await handler(createRequest(' '.repeat(64 * 1024 + 1)), oversized);
    expect(oversized.statusCode).toBe(413);

    const oversizedBatch = createResponse();
    await handler(createRequest(Array.from({ length: 11 }, (_, id) => ({
      ...rpcRequest('eth_chainId'),
      id,
    }))), oversizedBatch);
    expect(oversizedBatch.statusCode).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();

    const arbitraryUrl = createResponse();
    await handler(createRequest({ ...rpcRequest('eth_chainId'), url: 'https://example.invalid' }), arbitraryUrl);
    expect(arbitraryUrl.statusCode).toBe(400);
  });

  it('rejects non-POST methods before contacting the upstream', async () => {
    const fetchFn = vi.fn(async () => successResponse());
    const response = createResponse();
    await createChainReadHandler({ fetchFn })(
      { method: 'GET', body: rpcRequest('eth_chainId') },
      response,
    );

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects non-JSON content types and declared oversized bodies', async () => {
    const fetchFn = vi.fn(async () => successResponse());
    const handler = createChainReadHandler({ fetchFn });
    const wrongContentType = createResponse();
    await handler(createRequest(rpcRequest('eth_chainId'), {
      'content-type': 'text/plain',
      'x-real-ip': '192.0.2.1',
    }), wrongContentType);
    expect(wrongContentType.statusCode).toBe(415);

    const oversized = createResponse();
    await handler(createRequest(rpcRequest('eth_chainId'), {
      'content-length': String(64 * 1024 + 1),
      'content-type': 'application/json',
      'x-real-ip': '192.0.2.1',
    }), oversized);
    expect(oversized.statusCode).toBe(413);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps upstream HTTP, network, malformed-response, and oversized-response failures safely', async () => {
    const httpFailure = createResponse();
    await createChainReadHandler({
      fetchFn: vi.fn(async () => new Response('', { status: 503 })),
    })(createRequest(rpcRequest('eth_chainId')), httpFailure);
    expect(httpFailure.statusCode).toBe(502);
    expect(httpFailure.body).toEqual({ error: 'Arc Mainnet RPC request failed.' });

    const networkFailure = createResponse();
    await createChainReadHandler({
      fetchFn: vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
    })(createRequest(rpcRequest('eth_chainId')), networkFailure);
    expect(networkFailure.statusCode).toBe(502);

    const malformedResponse = createResponse();
    await createChainReadHandler({
      fetchFn: vi.fn(async () => new Response('not-json', { status: 200 })),
    })(createRequest(rpcRequest('eth_chainId')), malformedResponse);
    expect(malformedResponse.statusCode).toBe(502);

    const oversizedResponse = createResponse();
    await createChainReadHandler({
      fetchFn: vi.fn(async () => new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', {
        status: 200,
        headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
      })),
    })(createRequest(rpcRequest('eth_chainId')), oversizedResponse);
    expect(oversizedResponse.statusCode).toBe(502);
    expect(oversizedResponse.body).toEqual({
      error: 'Arc Mainnet RPC returned an invalid or oversized response.',
    });

    const streamedOversize = createResponse();
    await createChainReadHandler({
      fetchFn: vi.fn(async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
          controller.close();
        },
      }), { status: 200 })),
    })(createRequest(rpcRequest('eth_chainId')), streamedOversize);
    expect(streamedOversize.statusCode).toBe(502);
  });

  it('applies per-client request and concurrency limits', async () => {
    let currentTime = 1_000;
    const rateLimitedHandler = createChainReadHandler({
      fetchFn: vi.fn(async () => successResponse()),
      now: () => currentTime,
    });

    for (let index = 0; index < 300; index += 1) {
      const response = createResponse();
      await rateLimitedHandler(createRequest(rpcRequest('eth_chainId')), response);
      expect(response.statusCode).toBe(200);
    }
    const rateLimited = createResponse();
    await rateLimitedHandler(createRequest(rpcRequest('eth_chainId')), rateLimited);
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.headers['retry-after']).toBe(60);

    currentTime += 60_000;
    let releaseFetch: (() => void) | undefined;
    const pendingFetch = new Promise<Response>((resolve) => {
      releaseFetch = () => resolve(successResponse());
    });
    const fetchFn = vi.fn(() => pendingFetch);
    const concurrencyHandler = createChainReadHandler({
      fetchFn,
      now: () => currentTime,
    });
    const inFlight = Array.from({ length: 20 }, () => {
      const response = createResponse();
      return { response, promise: concurrencyHandler(createRequest(rpcRequest('eth_chainId')), response) };
    });
    expect(fetchFn).toHaveBeenCalledTimes(20);
    const concurrencyLimited = createResponse();
    await concurrencyHandler(createRequest(rpcRequest('eth_chainId')), concurrencyLimited);
    expect(concurrencyLimited.statusCode).toBe(429);

    releaseFetch?.();
    await Promise.all(inFlight.map(({ promise }) => promise));
  });

  it('times out a stalled upstream request', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      const response = createResponse();
      const pending = createChainReadHandler({ fetchFn })(
        createRequest(rpcRequest('eth_chainId')),
        response,
      );

      await vi.advanceTimersByTimeAsync(8_000);
      await pending;

      expect(response.statusCode).toBe(504);
      expect(response.body).toEqual({ error: 'Arc Mainnet RPC request timed out.' });
    } finally {
      vi.useRealTimers();
    }
  });
});
