import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import {
  DEPOSIT_TRIGGER_MAX_AGE_BLOCKS,
  verifyConfirmedDepositTransaction,
  classifyStrategyAutomationSubmissionError,
  calculateEligibleStrategyAllocation,
  executeStrategyAutomation,
  handleStrategyAutomationRequest,
  runTriggeredStrategySurplusDeployment,
  runScheduledStrategyValuationSync,
  type StrategyAutomationDependencies,
  type StrategyAutomationSnapshot,
} from '../../api/strategy-automation';
import { handleStrategyValuationCronRequest } from '../../api/strategy-valuation-cron';
import type { StrategyAutomationTriggerStore } from '../../server/strategyAutomationTriggerStore';
import { AUTOMATION_ROLE, POLICY_ADMIN_ROLE } from '../contracts/treasury';
import { createWalletSessionToken } from '../../server/wallet-auth';
import { ARC_MAINNET_CORE_ROLE_HOLDERS } from '../../../../packages/contracts/scripts/arc-mainnet-core-deployment-config';

const caller = '0x0000000000000000000000000000000000000001' as Address;
const executor = '0x0000000000000000000000000000000000000002' as Address;
const core = '0x0000000000000000000000000000000000000003' as Address;
const strategy = '0x0000000000000000000000000000000000000004' as Address;
const transactionHash = `0x${'a'.repeat(64)}` as Hash;
const allocationHash = `0x${'b'.repeat(64)}` as Hash;
const depositHash = `0x${'c'.repeat(64)}` as Hash;
const receiptBlock = 50n;

describe('strategy automation Node ESM imports', () => {
  it('uses explicit JavaScript specifiers across the API and workspace runtime chain', () => {
    const files = [
      {
        path: '../../api/strategy-automation.ts',
        specifiers: [
          "from '../../../packages/domain/src/treasury-addresses.js'",
          "from '../src/contracts/treasury.js'",
          "from '../server/wallet-auth.js'",
          "from '../server/strategyAutomationTriggerStore.js'",
        ],
      },
      {
        path: '../../api/strategy-valuation-cron.ts',
        specifiers: ["import('./strategy-automation.js')"],
      },
      {
        path: '../../../../packages/contracts/scripts/arc-mainnet-core-deployment-config.ts',
        specifiers: ["from './address-safety.js'"],
      },
    ];

    for (const { path, specifiers } of files) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      for (const specifier of specifiers) expect(source).toContain(specifier);
    }
  });
});

function snapshot(overrides: Partial<StrategyAutomationSnapshot> = {}): StrategyAutomationSnapshot {
  return {
    approved: true,
    enabled: true,
    freshnessBlocks: 1_200n,
    principal: 1_000n,
    shares: 900n,
    position: 800n,
    feesAccrued: 2n,
    valuationBlock: 40n,
    valuationSource: strategy,
    valuationStatus: 1,
    totalDeployed: 1_000n,
    liquidUSDC: 5_000n,
    ...overrides,
  };
}

function dependencies(
  before = snapshot(),
  after = snapshot({
    principal: 1_200n,
    shares: 1_100n,
    position: 1_100n,
    valuationBlock: receiptBlock,
    totalDeployed: 1_300n,
    liquidUSDC: 4_800n,
  }),
  overrides: Partial<StrategyAutomationDependencies> = {},
): StrategyAutomationDependencies {
  return {
    coreAddress: core,
    strategyAddress: strategy,
    executorAddress: executor,
    configuredAutomationAddress: executor,
    getChainId: vi.fn(async () => 5042),
    getCoreBytecode: vi.fn(async () => '0x6000' as Hex),
    getAdapterBytecode: vi.fn(async () => '0x6000' as Hex),
    verifyDeploymentIdentity: vi.fn(async () => true),
    hasRole: vi.fn(async () => true),
    getBlockNumber: vi.fn(async () => 40n),
    readSnapshot: vi.fn(async (blockNumber) => blockNumber === 40n ? before : after),
    readAdapterValuation: vi.fn(async () => ({
      shares: after.shares,
      currentValue: after.position,
      feesAccrued: after.feesAccrued,
    })),
    simulate: vi.fn(async () => undefined),
    submit: vi.fn(async () => transactionHash),
    waitForReceipt: vi.fn(async () => ({ status: 'success' as const, blockNumber: receiptBlock })),
    ...overrides,
  };
}

function automaticDeploymentDependencies(
  overrides: Partial<StrategyAutomationDependencies> = {},
): StrategyAutomationDependencies {
  const stale = snapshot({ valuationBlock: 1n, freshnessBlocks: 2n });
  const fresh = snapshot({ valuationBlock: receiptBlock, freshnessBlocks: 1_200n });
  const allocated = snapshot({
    principal: fresh.principal + 200n,
    shares: fresh.shares + 100n,
    position: fresh.position + 200n,
    valuationBlock: 60n,
    totalDeployed: fresh.totalDeployed + 200n,
    liquidUSDC: fresh.liquidUSDC - 200n,
  });
  let blockCall = 0;
  let receiptCall = 0;
  return dependencies(stale, fresh, {
    getBlockNumber: vi.fn(async () => [40n, 40n, 51n][blockCall++] ?? 51n),
    readSnapshot: vi.fn(async (blockNumber) => {
      if (blockNumber === 40n) return stale;
      if (blockNumber === receiptBlock || blockNumber === 51n) return fresh;
      if (blockNumber === 60n) return allocated;
      throw new Error('Unexpected test snapshot block.');
    }),
    readAdapterValuation: vi.fn(async () => ({
      shares: fresh.shares,
      currentValue: fresh.position,
      feesAccrued: fresh.feesAccrued,
    })),
    verifyDepositTransaction: vi.fn(async () => true),
    getEligibleAllocationAmount: vi.fn(async () => 200n),
    submit: vi.fn(async (operation) => operation.operation === 'sync-valuation' ? transactionHash : allocationHash),
    waitForReceipt: vi.fn(async (hash) => ({
      status: 'success' as const,
      blockNumber: hash === transactionHash ? receiptBlock : 60n,
    })),
    ...overrides,
    simulate: vi.fn(async (operation) => {
      if (overrides.simulate) await overrides.simulate(operation);
    }),
  });
}

function completingTriggerStore(): StrategyAutomationTriggerStore {
  return {
    async runOnce(_hash, operation) {
      return { status: 'completed', result: await operation() };
    },
  };
}

describe('strategy Automation execution', () => {
  it('classifies recognized nested provider fee errors without retaining provider text', () => {
    const error = Object.assign(new Error('submission failed'), {
      name: 'TransactionExecutionError',
      cause: Object.assign(new Error('RPC request failed'), {
        name: 'TransactionRejectedRpcError',
        code: -32003,
        data: { message: 'max fee per gas is below the network minimum' },
      }),
    });

    expect(classifyStrategyAutomationSubmissionError(error)).toEqual({
      classification: 'GAS_FEE_ERROR',
      reasonCategory: 'GAS_FEE_ERROR',
      providerErrorCode: -32003,
    });
  });

  it('keeps unknown provider errors sanitized and does not infer a reason from -32003 alone', () => {
    const error = Object.assign(new Error('private-key=must-not-log'), {
      name: 'TransactionExecutionError',
      cause: Object.assign(new Error('signed transaction=must-not-log'), {
        name: 'TransactionRejectedRpcError',
        code: -32003,
        data: { opaque: 'sensitive provider payload' },
      }),
    });

    const diagnostics = classifyStrategyAutomationSubmissionError(error);
    expect(diagnostics).toEqual({
      classification: 'RPC_PROVIDER_ERROR',
      reasonCategory: 'UNKNOWN_PROVIDER_ERROR',
      providerErrorCode: -32003,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('must-not-log');
    expect(JSON.stringify(diagnostics)).not.toContain('sensitive');
  });

  it('confirms allocation only after receipt and exact Core readback', async () => {
    const deps = dependencies();

    const result = await executeStrategyAutomation(caller, { operation: 'allocate', amount: 200n }, deps);

    expect(result.status).toBe('confirmed');
    expect(result.readback.principal).toBe(1_200n);
    expect(result.readback.shares).toBe(1_100n);
    expect(deps.submit).toHaveBeenCalledWith({ operation: 'allocate', amount: 200n });
    expect(deps.waitForReceipt).toHaveBeenCalledWith(transactionHash);
    expect(deps.readSnapshot).toHaveBeenLastCalledWith(receiptBlock);
  });

  it('confirms deallocation using the Core share and principal changes', async () => {
    const after = snapshot({
      principal: 889n,
      shares: 800n,
      position: 700n,
      valuationBlock: receiptBlock,
      totalDeployed: 900n,
      liquidUSDC: 5_100n,
    });
    const deps = dependencies(snapshot(), after);

    const result = await executeStrategyAutomation(caller, { operation: 'deallocate', shares: 100n }, deps);

    expect(result.status).toBe('confirmed');
    expect(result.readback.shares).toBe(800n);
    expect(result.readback.principal).toBe(889n);
  });

  it('confirms valuation sync only with a current valuation read at the receipt block', async () => {
    const after = snapshot({
      position: 850n,
      shares: 910n,
      feesAccrued: 7n,
      valuationBlock: receiptBlock,
      valuationSource: strategy,
      totalDeployed: 1_050n,
    });
    const deps = dependencies(snapshot(), after);

    const result = await executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps);

    expect(result.status).toBe('confirmed');
    expect(result.readback.position).toBe(850n);
    expect(result.readback.feesAccrued).toBe(7n);
    expect(result.readback.valuationSource).toBe(strategy);
    expect(deps.readAdapterValuation).toHaveBeenCalledWith(receiptBlock);
  });

  it('rejects valuation sync when Core values do not match adapter readback at receipt block', async () => {
    const after = snapshot({
      position: 850n,
      valuationBlock: receiptBlock,
      totalDeployed: 1_050n,
    });
    const deps = dependencies(snapshot(), after, {
      readAdapterValuation: vi.fn(async () => ({ shares: after.shares, currentValue: 851n, feesAccrued: after.feesAccrued })),
    });

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toMatchObject({ kind: 'READBACK_FAILED', transactionHash });
  });

  it('rejects valuation sync if liquid USDC changes', async () => {
    const after = snapshot({
      valuationBlock: receiptBlock,
      liquidUSDC: 4_999n,
    });
    const deps = dependencies(snapshot(), after);

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toMatchObject({ kind: 'READBACK_FAILED', transactionHash });
  });

  it('rejects a sync readback with a non-current status or unexpected valuation source', async () => {
    const incorrectStatus = snapshot({
      position: 850n,
      valuationBlock: receiptBlock,
      valuationStatus: 0,
      totalDeployed: 1_050n,
    });
    const statusDeps = dependencies(snapshot(), incorrectStatus);
    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, statusDeps))
      .rejects.toMatchObject({ kind: 'READBACK_FAILED', transactionHash });

    const incorrectSource = snapshot({
      position: 850n,
      valuationBlock: receiptBlock,
      valuationSource: core,
      totalDeployed: 1_050n,
    });
    const sourceDeps = dependencies(snapshot(), incorrectSource);
    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, sourceDeps))
      .rejects.toMatchObject({ kind: 'READBACK_FAILED', transactionHash });
  });

  it('fails closed on a non-Arc chain before submission', async () => {
    const deps = dependencies(undefined, undefined, { getChainId: vi.fn(async () => 1) });

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toMatchObject({ kind: 'CONFIGURATION' });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('fails closed if the deployer does not hold AUTOMATION_ROLE', async () => {
    const hasRole = vi.fn(async (role) => role !== AUTOMATION_ROLE);
    const deps = dependencies(undefined, undefined, { hasRole });

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toMatchObject({ kind: 'CONFIGURATION' });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('fails closed with the exact mismatch when signer differs from configured role holder', async () => {
    const roleHolder = '0x0000000000000000000000000000000000000005' as Address;
    const deps = dependencies(undefined, undefined, { configuredAutomationAddress: roleHolder });

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toThrow(`DEPLOYER_PRIVATE_KEY signer ${executor} does not match configured ARC_MAINNET_CORE_AUTOMATION_EXECUTOR ${roleHolder}`);
    expect(deps.hasRole).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('simulates Core policy checks before submitting a transaction', async () => {
    const executionOrder: string[] = [];
    const deps = dependencies(undefined, undefined, {
      simulate: vi.fn(async () => { executionOrder.push('simulate'); }),
      submit: vi.fn(async () => {
        executionOrder.push('submit');
        return transactionHash;
      }),
    });

    await executeStrategyAutomation(caller, { operation: 'allocate', amount: 200n }, deps);

    expect(deps.simulate).toHaveBeenCalledWith({ operation: 'allocate', amount: 200n });
    expect(executionOrder).toEqual(['simulate', 'submit']);
  });

  it('does not submit when Core policy simulation rejects the operation', async () => {
    const deps = dependencies(undefined, undefined, {
      simulate: vi.fn(async () => { throw new Error('policy rejected'); }),
    });

    await expect(executeStrategyAutomation(caller, { operation: 'allocate', amount: 200n }, deps))
      .rejects.toMatchObject({
        kind: 'SIMULATION_FAILED',
        message: expect.stringContaining('No transaction was submitted'),
      });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('does not submit an allocation when current strategy valuation is stale', async () => {
    const deps = dependencies(
      snapshot({ valuationBlock: 1n, freshnessBlocks: 2n, valuationStatus: 1 }),
      undefined,
      { simulate: vi.fn(async () => { throw new Error('ValuationNotCurrent'); }) },
    );

    await expect(executeStrategyAutomation(caller, { operation: 'allocate', amount: 150_000n }, deps))
      .rejects.toMatchObject({ kind: 'VALUATION_NOT_CURRENT' });
    expect(deps.simulate).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('logs sanitized submission diagnostics and returns only a correlation ID to the client', async () => {
    const submissionError = Object.assign(
      new Error('private-key=must-not-log signedTransaction=must-not-log'),
      {
        name: 'TransactionExecutionError',
        code: -32000,
        cause: Object.assign(new Error('nonce detail must not log'), {
          name: 'NonceTooLowError',
          code: 'ERR_NONCE_TOO_LOW',
        }),
      },
    );
    const deps = dependencies(undefined, undefined, {
      submit: vi.fn(async () => { throw submissionError; }),
    });
    const originalSecret = process.env.AUTH_SESSION_SECRET;
    const originalOrigin = process.env.AUTH_ORIGIN;
    const sessionSecret = 'test-session-secret-with-at-least-32-bytes';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let loggedCalls: unknown[][] = [];
    let responseBody: unknown;
    let statusCode = 200;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      setHeader() {
        return this;
      },
      json(body: unknown) {
        responseBody = body;
      },
    };

    process.env.AUTH_SESSION_SECRET = sessionSecret;
    process.env.AUTH_ORIGIN = 'http://localhost:5173';
    try {
      await handleStrategyAutomationRequest({
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `velox_session=${createWalletSessionToken(caller, sessionSecret)}`,
        },
        body: { operation: 'sync-valuation' },
      }, response, () => ({
        config: {
          chainId: 5042,
          coreAddress: core,
          steakhouseAdapterAddress: strategy,
          usdcAddress: '0x3600000000000000000000000000000000000000',
          protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450',
          mode: 'FINAL_DEPLOYMENT',
        },
        dependencies: deps,
      }));
      loggedCalls = [...errorLog.mock.calls];
    } finally {
      errorLog.mockRestore();
      if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
      else process.env.AUTH_SESSION_SECRET = originalSecret;
      if (originalOrigin === undefined) delete process.env.AUTH_ORIGIN;
      else process.env.AUTH_ORIGIN = originalOrigin;
    }

    expect(statusCode).toBe(502);
    expect(responseBody).toMatchObject({
      error: 'Strategy transaction submission failed; no success was reported.',
      kind: 'TRANSACTION_FAILED',
    });
    expect(responseBody).toHaveProperty('correlationId');
    expect(Object.keys(responseBody as Record<string, unknown>).sort()).toEqual(['correlationId', 'error', 'kind']);
    const correlationId = (responseBody as { correlationId: string }).correlationId;
    expect(correlationId).toMatch(/^[\da-f-]{36}$/i);
    expect(loggedCalls).toEqual([[
      'Strategy automation transaction submission failed.',
      {
        correlationId,
        classification: 'NONCE_ERROR',
        reasonCategory: 'NONCE_ERROR',
        providerErrorCode: -32000,
      },
    ]]);
    expect(JSON.stringify(loggedCalls)).not.toContain('must-not-log');
    expect(deps.simulate).toHaveBeenCalledWith({ operation: 'sync-valuation' });
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.waitForReceipt).not.toHaveBeenCalled();
  });

  it('returns a safe correlation reference for unexpected API exceptions', async () => {
    const originalSecret = process.env.AUTH_SESSION_SECRET;
    const originalOrigin = process.env.AUTH_ORIGIN;
    const sessionSecret = 'test-session-secret-with-at-least-32-bytes';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let loggedCalls: unknown[][] = [];
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };
    process.env.AUTH_SESSION_SECRET = sessionSecret;
    process.env.AUTH_ORIGIN = 'http://localhost:5173';
    try {
      await handleStrategyAutomationRequest({
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `velox_session=${createWalletSessionToken(caller, sessionSecret)}`,
        },
        body: { operation: 'sync-valuation' },
      }, response, () => {
        throw new Error('private configuration details must not be logged');
      });
      loggedCalls = [...errorLog.mock.calls];
    } finally {
      errorLog.mockRestore();
      if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
      else process.env.AUTH_SESSION_SECRET = originalSecret;
      if (originalOrigin === undefined) delete process.env.AUTH_ORIGIN;
      else process.env.AUTH_ORIGIN = originalOrigin;
    }

    expect(statusCode).toBe(500);
    expect(responseBody).toMatchObject({
      kind: 'INTERNAL_ERROR',
      error: 'The strategy executor encountered an unexpected error. No success was reported; contact support with the reference.',
    });
    const correlationId = (responseBody as { correlationId: string }).correlationId;
    expect(correlationId).toMatch(/^[\da-f-]{36}$/i);
    expect(loggedCalls).toEqual([['Strategy automation request failed unexpectedly.', {
      correlationId,
      errorType: 'Error',
    }]]);
    expect(JSON.stringify(responseBody)).not.toContain('private configuration details');
    expect(JSON.stringify(loggedCalls)).not.toContain('private configuration details');
  });

  it('fails closed if Core, USDC, strategy, or role identity does not match deployment config', async () => {
    const deps = dependencies(undefined, undefined, {
      verifyDeploymentIdentity: vi.fn(async () => false),
    });

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toMatchObject({ kind: 'CONFIGURATION' });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('does not report a reverted transaction as confirmed', async () => {
    const deps = dependencies(undefined, undefined, {
      waitForReceipt: vi.fn(async () => ({ status: 'reverted' as const, blockNumber: receiptBlock })),
    });

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toMatchObject({ kind: 'TRANSACTION_FAILED', transactionHash });
  });

  it('does not report confirmed when authoritative allocation readback mismatches', async () => {
    const incorrectAfter = snapshot({
      principal: 1_200n,
      shares: 1_100n,
      position: 1_100n,
      valuationBlock: receiptBlock,
      totalDeployed: 1_300n,
      liquidUSDC: 4_900n,
    });
    const deps = dependencies(snapshot(), incorrectAfter);

    await expect(executeStrategyAutomation(caller, { operation: 'allocate', amount: 200n }, deps))
      .rejects.toMatchObject({ kind: 'READBACK_FAILED', transactionHash });
  });

  it('does not report confirmed if the authoritative post-receipt read fails', async () => {
    const readSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error('RPC read failed'));
    const deps = dependencies(undefined, undefined, { readSnapshot });

    const execution = executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps);
    await expect(execution).rejects.toMatchObject({ kind: 'READBACK_FAILED', transactionHash });
  });

  it('requires an authenticated caller with the existing Policy Admin role', async () => {
    const deps = dependencies(undefined, undefined, { hasRole: vi.fn(async (role) => role !== POLICY_ADMIN_ROLE) });

    await expect(executeStrategyAutomation(caller, { operation: 'sync-valuation' }, deps))
      .rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
    expect(deps.submit).not.toHaveBeenCalled();
  });
});

describe('scheduled strategy valuation sync', () => {
  it('bounds deployment by liquid reserves, strategy bucket, total, strategy, protocol, and asset caps', () => {
    const capacity = {
      strategy: { approved: true, enabled: true, position: 100n, absoluteCap: 5_000n, relativeCapBps: 1_500 },
      availableLiquidity: 900n,
      yieldStrategyBufferCapacity: 800n,
      totalDeployed: 100n,
      maximumTotalDeployed: 700n,
      totalManagedAssets: 10_000n,
      protocol: { approved: true, enabled: true, exposure: 100n, absoluteCap: 600n, relativeCapBps: 1_500 },
      asset: { approved: true, enabled: true, exposure: 100n, absoluteCap: 500n, relativeCapBps: 1_500 },
    } as const;

    expect(calculateEligibleStrategyAllocation(capacity)).toBe(400n);
    expect(calculateEligibleStrategyAllocation({
      ...capacity,
      availableLiquidity: 0n,
    })).toBe(0n);
    expect(calculateEligibleStrategyAllocation({
      ...capacity,
      asset: { ...capacity.asset, absoluteCap: 250n },
    })).toBe(150n);
    expect(calculateEligibleStrategyAllocation({
      ...capacity,
      strategy: { ...capacity.strategy, enabled: false },
    })).toBe(0n);
  });

  it('confirms stale valuation refresh before allocating only the computed eligible surplus', async () => {
    const deps = automaticDeploymentDependencies();
    const result = await runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      completingTriggerStore(),
    );

    expect(result).toMatchObject({
      status: 'deployed',
      amount: 200n,
      valuation: { status: 'confirmed', operation: 'sync-valuation' },
      allocation: { status: 'confirmed', operation: 'allocate', transactionHash: allocationHash },
    });
    expect(deps.verifyDepositTransaction).toHaveBeenCalledWith(depositHash, caller);
    expect(deps.getEligibleAllocationAmount).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.simulate).mock.calls.map(([operation]) => operation.operation)).toEqual([
      'sync-valuation',
      'allocate',
    ]);
    expect(vi.mocked(deps.submit).mock.calls.map(([operation]) => operation.operation)).toEqual([
      'sync-valuation',
      'allocate',
    ]);
    expect(deps.waitForReceipt).toHaveBeenCalledTimes(2);
    expect(deps.readSnapshot).toHaveBeenCalledWith(60n);
  });

  it('rechecks freshness and retries allocation once after Core returns ValuationNotCurrent', async () => {
    let allocationSimulations = 0;
    const deps = automaticDeploymentDependencies({
      simulate: vi.fn(async (operation) => {
        if (operation.operation === 'allocate' && allocationSimulations++ === 0) {
          throw Object.assign(new Error('Core reverted with ValuationNotCurrent'), {
            name: 'ContractFunctionRevertedError',
          });
        }
      }),
    });
    const result = await runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      completingTriggerStore(),
    );

    expect(result.status).toBe('deployed');
    expect(deps.simulate).toHaveBeenCalledTimes(3);
    expect(vi.mocked(deps.simulate).mock.calls.map(([operation]) => operation.operation)).toEqual([
      'sync-valuation',
      'allocate',
      'allocate',
    ]);
    expect(deps.getEligibleAllocationAmount).toHaveBeenCalledTimes(2);
    expect(deps.submit).toHaveBeenCalledTimes(2);
  });

  it('does not attempt allocation if the valuation refresh fails', async () => {
    const deps = automaticDeploymentDependencies({
      simulate: vi.fn(async (operation) => {
        if (operation.operation === 'sync-valuation') throw new Error('mock sync rejected');
      }),
    });

    await expect(runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      completingTriggerStore(),
    )).rejects.toMatchObject({ kind: 'SIMULATION_FAILED' });
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.getEligibleAllocationAmount).not.toHaveBeenCalled();
  });

  it('does not submit if Policy Admin or Automation role verification fails', async () => {
    const deps = automaticDeploymentDependencies({
      hasRole: vi.fn(async (role) => role !== POLICY_ADMIN_ROLE),
    });

    await expect(runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      completingTriggerStore(),
    )).rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.getEligibleAllocationAmount).not.toHaveBeenCalled();
  });

  it('skips allocation when authoritative Core capacity is zero', async () => {
    const deps = automaticDeploymentDependencies({
      getEligibleAllocationAmount: vi.fn(async () => 0n),
    });
    const result = await runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      completingTriggerStore(),
    );

    expect(result).toMatchObject({ status: 'skipped', reason: 'NO_ELIGIBLE_SURPLUS' });
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.submit).toHaveBeenCalledWith({ operation: 'sync-valuation' });
  });

  it('never retries a deposit trigger already claimed or overlaps a running deployment', async () => {
    const cases = [
      { result: { status: 'duplicate', previousStatus: 'COMPLETED' }, reason: 'DUPLICATE_DEPOSIT_TRIGGER' },
      { result: { status: 'duplicate', previousStatus: 'FAILED' }, reason: 'PREVIOUS_ATTEMPT_FAILED' },
      { result: { status: 'duplicate', previousStatus: 'STARTED' }, reason: 'PREVIOUS_ATTEMPT_INTERRUPTED' },
      { result: { status: 'busy' }, reason: 'RUN_IN_PROGRESS' },
    ] as const;
    for (const { result: storeResult, reason } of cases) {
      const deps = automaticDeploymentDependencies();
      const store: StrategyAutomationTriggerStore = {
        async runOnce() {
          return storeResult as never;
        },
      };
      const result = await runTriggeredStrategySurplusDeployment(
        depositHash,
        caller,
        () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
        store,
      );

      expect(result).toMatchObject({ status: 'skipped', reason });
      expect(deps.simulate).not.toHaveBeenCalled();
      expect(deps.submit).not.toHaveBeenCalled();
    }
  });

  it('does not allocate when its Core simulation fails after a confirmed refresh', async () => {
    const deps = automaticDeploymentDependencies({
      simulate: vi.fn(async (operation) => {
        if (operation.operation === 'allocate') throw new Error('mock cap rejection');
      }),
    });

    await expect(runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      completingTriggerStore(),
    )).rejects.toMatchObject({ kind: 'SIMULATION_FAILED' });
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.submit).toHaveBeenCalledWith({ operation: 'sync-valuation' });
    expect(deps.waitForReceipt).toHaveBeenCalledTimes(1);
  });

  it('rejects an unverified depositor trigger before acquiring the execution lock', async () => {
    const deps = automaticDeploymentDependencies({
      verifyDepositTransaction: vi.fn(async () => false),
    });
    const store: StrategyAutomationTriggerStore = {
      async runOnce<T>(): Promise<{ readonly status: 'duplicate'; readonly previousStatus: 'COMPLETED' }> {
        return { status: 'duplicate', previousStatus: 'COMPLETED' };
      },
    };
    const runOnce = vi.spyOn(store, 'runOnce');

    await expect(runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      store,
    )).rejects.toMatchObject({ kind: 'INVALID_REQUEST' });
    expect(runOnce).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('accepts automatic deployment only from an authenticated same-origin wallet session', async () => {
    const deps = automaticDeploymentDependencies();
    const factory = vi.fn(() => ({
      config: {
        chainId: 5042 as const,
        coreAddress: core,
        steakhouseAdapterAddress: strategy,
        usdcAddress: '0x3600000000000000000000000000000000000000' as const,
        protocolId: '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450' as const,
        mode: 'FINAL_DEPLOYMENT' as const,
      },
      dependencies: deps,
    }));
    const originalSecret = process.env.AUTH_SESSION_SECRET;
    const originalOrigin = process.env.AUTH_ORIGIN;
    const sessionSecret = 'test-session-secret-with-at-least-32-bytes';
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };
    process.env.AUTH_SESSION_SECRET = sessionSecret;
    process.env.AUTH_ORIGIN = 'http://localhost:5173';
    try {
      await handleStrategyAutomationRequest({
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          cookie: `velox_session=${createWalletSessionToken(caller, sessionSecret)}`,
        },
        body: { operation: 'deploy-surplus', depositTransactionHash: depositHash },
      }, response, factory, completingTriggerStore());
    } finally {
      if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
      else process.env.AUTH_SESSION_SECRET = originalSecret;
      if (originalOrigin === undefined) delete process.env.AUTH_ORIGIN;
      else process.env.AUTH_ORIGIN = originalOrigin;
    }

    expect(statusCode).toBe(200);
    expect(responseBody).toMatchObject({
      status: 'deployed',
      amount: '200',
      allocation: { operation: 'allocate', transactionHash: allocationHash, blockNumber: '60' },
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(deps.verifyDepositTransaction).toHaveBeenCalledWith(depositHash, caller);
  });

  it('rejects non-production cron requests before constructing any automation dependencies', async () => {
    const factory = vi.fn(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: dependencies(),
    }));
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };

    await handleStrategyValuationCronRequest(
      { method: 'GET', headers: { authorization: `Bearer ${'a'.repeat(32)}` } },
      response,
      factory,
      { VERCEL_ENV: 'development', CRON_SECRET: 'a'.repeat(32) },
    );

    expect(statusCode).toBe(404);
    expect(responseBody).toEqual({ error: 'Scheduled valuation sync is available only in the production runtime.' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns a fresh-valuation skip without invoking any mocked transaction methods', async () => {
    const deps = dependencies(
      snapshot({ valuationBlock: 30n, freshnessBlocks: 10n }),
      undefined,
      { getBlockNumber: vi.fn(async () => 40n) },
    );
    const factory = vi.fn(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: deps,
    }));
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };

    await handleStrategyValuationCronRequest(
      { method: 'GET', headers: { authorization: `Bearer ${'a'.repeat(32)}` } },
      response,
      factory,
      { VERCEL_ENV: 'production', CRON_SECRET: 'a'.repeat(32) },
    );

    expect(statusCode).toBe(200);
    expect(responseBody).toEqual({ status: 'skipped', reason: 'VALUATION_FRESH', blockNumber: '40' });
    expect(factory).toHaveBeenCalledOnce();
    expect(deps.simulate).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.waitForReceipt).not.toHaveBeenCalled();
  });

  it('runs the existing valuation-only operation when authoritative Core state is stale', async () => {
    const after = snapshot({ valuationBlock: receiptBlock, freshnessBlocks: 1_200n });
    const deps = dependencies(snapshot({ valuationBlock: 1n, freshnessBlocks: 2n }), after);
    const result = await runScheduledStrategyValuationSync(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: deps,
    }));

    expect(result).toMatchObject({ status: 'confirmed', operation: 'sync-valuation', blockNumber: receiptBlock });
    expect(deps.hasRole).toHaveBeenCalledWith(POLICY_ADMIN_ROLE, getAddress(ARC_MAINNET_CORE_ROLE_HOLDERS.policyAdmin));
    expect(deps.hasRole).toHaveBeenCalledWith(AUTOMATION_ROLE, executor);
    expect(deps.simulate).toHaveBeenCalledWith({ operation: 'sync-valuation' });
    expect(deps.submit).toHaveBeenCalledTimes(1);
    expect(deps.submit).toHaveBeenCalledWith({ operation: 'sync-valuation' });
  });

  it('skips submission while the actual Core valuation remains fresh, including the boundary block', async () => {
    const deps = dependencies(
      snapshot({ valuationBlock: 30n, freshnessBlocks: 10n }),
      undefined,
      { getBlockNumber: vi.fn(async () => 40n) },
    );
    const result = await runScheduledStrategyValuationSync(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: deps,
    }));

    expect(result).toEqual({ status: 'skipped', reason: 'VALUATION_FRESH', blockNumber: 40n });
    expect(deps.simulate).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('reports a cron sync as confirmed only after the mocked receipt and authoritative readback', async () => {
    const before = snapshot({ valuationBlock: 1n, freshnessBlocks: 2n });
    const after = snapshot({ valuationBlock: receiptBlock, freshnessBlocks: 1_200n });
    const deps = dependencies(before, after);
    const factory = vi.fn(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: deps,
    }));
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };
    await handleStrategyValuationCronRequest(
      { method: 'GET', headers: { authorization: `Bearer ${'a'.repeat(32)}` } },
      response,
      factory,
      { VERCEL_ENV: 'production', CRON_SECRET: 'a'.repeat(32) },
    );

    expect(factory).toHaveBeenCalledOnce();
    expect(statusCode).toBe(200);
    expect(responseBody).toMatchObject({
      status: 'confirmed',
      operation: 'sync-valuation',
      transactionHash,
      blockNumber: receiptBlock.toString(),
      readback: { valuationBlock: receiptBlock.toString(), valuationStatus: 1 },
    });
    expect(deps.waitForReceipt).toHaveBeenCalledWith(transactionHash);
  });

  it('does not submit when the designated Policy Admin role check fails', async () => {
    const deps = dependencies(undefined, undefined, {
      hasRole: vi.fn(async (role) => role !== POLICY_ADMIN_ROLE),
    });

    await expect(runScheduledStrategyValuationSync(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: deps,
    }))).rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('fails closed when the live valuation snapshot cannot be read', async () => {
    const deps = dependencies(undefined, undefined, {
      readSnapshot: vi.fn(async () => { throw new Error('Core read failed.'); }),
    });

    await expect(runScheduledStrategyValuationSync(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: deps,
    }))).rejects.toThrow('Current Core valuation state could not be read; no sync transaction was submitted.');
    expect(deps.simulate).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('requires the production cron bearer secret before constructing the executor', async () => {
    const factory = vi.fn(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: dependencies(),
    }));
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };
    await handleStrategyValuationCronRequest(
      { method: 'GET', headers: { authorization: 'Bearer wrong' } },
      response,
      factory,
      { VERCEL_ENV: 'production', CRON_SECRET: 'a'.repeat(32) },
    );

    expect(statusCode).toBe(401);
    expect(responseBody).toEqual({ error: 'Unauthorized scheduled request.' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns a sanitized configuration response when the cron automation module fails to initialize', async () => {
    const factory = vi.fn(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: dependencies(),
    }));
    const initializationFailure = Object.assign(new Error('secret=must-not-be-logged'), {
      name: 'InitializationFailureWithSensitiveDetails',
    });
    const automationModuleLoader = vi.fn(async () => {
      throw initializationFailure;
    });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };

    try {
      await handleStrategyValuationCronRequest(
        { method: 'GET', headers: { authorization: 'Bearer ' + 'a'.repeat(32) } },
        response,
        factory,
        { VERCEL_ENV: 'production', CRON_SECRET: 'a'.repeat(32) },
        automationModuleLoader,
      );
      expect(logError).toHaveBeenCalledWith(
        'Strategy valuation cron module initialization failed.',
        expect.objectContaining({
          errorType: 'Error',
          correlationId: expect.any(String),
        }),
      );
      expect(JSON.stringify(logError.mock.calls)).not.toContain('must-not-be-logged');
    } finally {
      logError.mockRestore();
    }

    expect(automationModuleLoader).toHaveBeenCalledOnce();
    expect(factory).not.toHaveBeenCalled();
    expect(statusCode).toBe(503);
    expect(responseBody).toMatchObject({
      error: 'Scheduled valuation sync could not initialize.',
      kind: 'CONFIGURATION',
    });
    expect(responseBody).not.toHaveProperty('details');
    expect(JSON.stringify(responseBody)).not.toContain('must-not-be-logged');
  });

  it('handles production Arc configuration errors raised while importing the cron automation module', async () => {
    vi.resetModules();
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VELOX_TREASURY_CORE_ADDRESS', 'not-an-address');
    vi.stubEnv('VELIX_TREASURY_CORE_ADDRESS', '');
    vi.stubEnv('VITE_ARC_MAINNET_CORE_ADDRESS', '');
    vi.stubEnv('STEAKHOUSE_ADAPTER_ADDRESS', '0x2222222222222222222222222222222222222222');
    vi.stubEnv('CRON_SECRET', 'a'.repeat(32));

    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };

    try {
      const { handleStrategyValuationCronRequest: handleRequest } =
        await import('../../api/strategy-valuation-cron');
      await handleRequest(
        { method: 'GET', headers: { authorization: 'Bearer ' + 'a'.repeat(32) } },
        response,
      );
      expect(logError).toHaveBeenCalledWith(
        'Strategy valuation cron module initialization failed.',
        expect.objectContaining({ errorType: 'Error', correlationId: expect.any(String) }),
      );
    } finally {
      logError.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }

    expect(statusCode).toBe(503);
    expect(responseBody).toMatchObject({
      error: 'Scheduled valuation sync could not initialize.',
      kind: 'CONFIGURATION',
    });
    expect(JSON.stringify(responseBody)).not.toContain('not-an-address');
  });

  it('does not present a failed sync simulation as successful or submit it', async () => {
    const deps = dependencies(snapshot({ valuationBlock: 1n, freshnessBlocks: 2n }), undefined, {
      simulate: vi.fn(async () => { throw new Error('Core valuation read rejected.'); }),
    });
    const factory = vi.fn(() => ({
      config: { coreAddress: core, steakhouseAdapterAddress: strategy },
      dependencies: deps,
    }));
    let statusCode = 200;
    let responseBody: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body: unknown) { responseBody = body; },
    };
    await handleStrategyValuationCronRequest(
      { method: 'GET', headers: { authorization: `Bearer ${'a'.repeat(32)}` } },
      response,
      factory,
      { VERCEL_ENV: 'production', CRON_SECRET: 'a'.repeat(32) },
    );

    expect(factory).toHaveBeenCalledOnce();
    expect(statusCode).toBe(502);
    expect(responseBody).toMatchObject({
      kind: 'SIMULATION_FAILED',
      error: expect.stringContaining('No transaction was submitted'),
    });
    expect(deps.simulate).toHaveBeenCalledWith({ operation: 'sync-valuation' });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('does not allow a cron request to bypass the on-chain Policy Admin role check', async () => {
    const deps = dependencies(undefined, undefined, {
      hasRole: vi.fn(async (role) => role !== POLICY_ADMIN_ROLE),
    });
    let statusCode = 200;
    const response = {
      status(code: number) { statusCode = code; return this; },
      setHeader() { return this; },
      json() { return undefined; },
    };
    await handleStrategyValuationCronRequest(
      { method: 'GET', headers: { authorization: `Bearer ${'a'.repeat(32)}` } },
      response,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      { VERCEL_ENV: 'production', CRON_SECRET: 'a'.repeat(32) },
    );

    expect(statusCode).toBe(403);
    expect(deps.submit).not.toHaveBeenCalled();
  });
});

describe('deposit trigger freshness', () => {
  const depositAmount = 1_000_000n;
  const latestBlock = 1_000_000n;
  const depositAbi = parseAbi([
    'function deposit(uint256 amount)',
    'event Deposit(address indexed user, uint256 amount, uint256 userBalance, uint256 totalLiabilities)',
  ]);

  function depositClient(
    receiptBlockNumber: bigint,
    latest: bigint = latestBlock,
    eventUser: Address = caller,
    eventAmount: bigint = depositAmount,
  ) {
    const input = encodeFunctionData({ abi: depositAbi, functionName: 'deposit', args: [depositAmount] });
    const topics = encodeEventTopics({ abi: depositAbi, eventName: 'Deposit', args: { user: eventUser } });
    const data = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [eventAmount, eventAmount, eventAmount],
    );
    return {
      getTransaction: vi.fn(async () => ({ to: core, from: caller, input })),
      getTransactionReceipt: vi.fn(async () => ({
        status: 'success',
        blockNumber: receiptBlockNumber,
        logs: [{ address: core, topics: topics as Hex[], data }],
      })),
      getBlockNumber: vi.fn(async () => latest),
    };
  }

  it('accepts a recent confirmed deposit, including exactly at the age limit', async () => {
    expect(await verifyConfirmedDepositTransaction(depositClient(latestBlock - 5n), core, depositHash, caller)).toBe(true);
    expect(await verifyConfirmedDepositTransaction(
      depositClient(latestBlock - DEPOSIT_TRIGGER_MAX_AGE_BLOCKS),
      core,
      depositHash,
      caller,
    )).toBe(true);
  });

  it('rejects the previously recorded stale deposit and anything beyond the age limit', async () => {
    const oldDepositBlock = 25_552_056n;
    const observedBlock = 25_583_179n;
    await expect(verifyConfirmedDepositTransaction(
      depositClient(oldDepositBlock, observedBlock),
      core,
      depositHash,
      caller,
    )).rejects.toMatchObject({ kind: 'INVALID_REQUEST', message: expect.stringContaining('too old') });
    await expect(verifyConfirmedDepositTransaction(
      depositClient(latestBlock - DEPOSIT_TRIGGER_MAX_AGE_BLOCKS - 1n),
      core,
      depositHash,
      caller,
    )).rejects.toMatchObject({ kind: 'INVALID_REQUEST' });
  });

  it('rejects a future or invalid receipt block without treating it as a deposit', async () => {
    expect(await verifyConfirmedDepositTransaction(depositClient(latestBlock + 1n), core, depositHash, caller)).toBe(false);
    expect(await verifyConfirmedDepositTransaction(depositClient(-1n), core, depositHash, caller)).toBe(false);
  });

  it('still requires the Core, wallet, decoded input and matching Deposit event', async () => {
    const wrongCaller = '0x0000000000000000000000000000000000000009' as Address;
    expect(await verifyConfirmedDepositTransaction(depositClient(latestBlock - 1n), core, depositHash, wrongCaller)).toBe(false);
    expect(await verifyConfirmedDepositTransaction(depositClient(latestBlock - 1n), strategy, depositHash, caller)).toBe(false);
    expect(await verifyConfirmedDepositTransaction(
      depositClient(latestBlock - 1n, latestBlock, caller, depositAmount + 1n),
      core,
      depositHash,
      caller,
    )).toBe(false);
  });

  it('rejects a stale deposit before any claim, valuation sync or allocation', async () => {
    const client = depositClient(100n, latestBlock);
    const deps = automaticDeploymentDependencies({
      verifyDepositTransaction: (hash: Hash, depositor: Address) =>
        verifyConfirmedDepositTransaction(client, core, hash, depositor),
    });
    const store = completingTriggerStore();
    const runOnce = vi.spyOn(store, 'runOnce');

    await expect(runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      store,
    )).rejects.toMatchObject({ kind: 'INVALID_REQUEST' });
    expect(runOnce).not.toHaveBeenCalled();
    expect(deps.simulate).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('keeps duplicate-hash protection for a recent deposit', async () => {
    const client = depositClient(latestBlock - 1n);
    const deps = automaticDeploymentDependencies({
      verifyDepositTransaction: (hash: Hash, depositor: Address) =>
        verifyConfirmedDepositTransaction(client, core, hash, depositor),
    });
    const store: StrategyAutomationTriggerStore = {
      async runOnce() {
        return { status: 'duplicate', previousStatus: 'COMPLETED' } as never;
      },
    };

    const result = await runTriggeredStrategySurplusDeployment(
      depositHash,
      caller,
      () => ({ config: { coreAddress: core, steakhouseAdapterAddress: strategy }, dependencies: deps }),
      store,
    );

    expect(result).toMatchObject({ status: 'skipped', reason: 'DUPLICATE_DEPOSIT_TRIGGER' });
    expect(deps.submit).not.toHaveBeenCalled();
  });
});
