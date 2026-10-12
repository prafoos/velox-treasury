import { describe, expect, it } from 'vitest';
import { ARC_MAINNET_CURRENT_LIVE_REFERENCES } from '@velox/domain';

import { buildStrategyLedger, buildUserLedger, summarizeStrategyLedger, summarizeUserLedger } from './index.js';

type LedgerEvent = {
  chainId: bigint;
  contractAddress: string;
  txHash: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  logIndex: bigint;
  eventName: string;
  decodedData: Record<string, unknown>;
};

function makeEvent(
  eventName: string,
  overrides: Partial<LedgerEvent> & { decodedData?: Record<string, unknown> },
): LedgerEvent {
  return {
    chainId: 5042n,
    contractAddress: ARC_MAINNET_CURRENT_LIVE_REFERENCES.core,
    txHash: '0xaaa',
    blockNumber: 100n,
    blockTimestamp: 1700000000n,
    logIndex: 0n,
    ...overrides,
    eventName,
    decodedData: overrides.decodedData ?? {},
  };
}

describe('minimum ledger layer', () => {
  it('records a user deposit', () => {
    const events = [
      makeEvent('Deposit', {
        txHash: '0x1',
        logIndex: 0n,
        decodedData: { user: '0x1111111111111111111111111111111111111111', amount: 1000n, userBalance: 1000n, totalLiabilities: 1000n },
      }),
    ];

    const result = buildUserLedger(events);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userAddress: '0x1111111111111111111111111111111111111111',
      eventType: 'Deposit',
      depositAmount: 1000n,
      withdrawalAmount: null,
      userUnits: null,
      userNav: 1000n,
      netUserPosition: 1000n,
    });
  });

  it('records a user withdrawal', () => {
    const events = [
      makeEvent('Withdrawal', {
        txHash: '0x2',
        logIndex: 1n,
        decodedData: { user: '0x2222222222222222222222222222222222222222', recipient: '0x3333333333333333333333333333333333333333', amount: 400n, userBalance: 1600n, totalLiabilities: 2000n },
      }),
    ];

    const result = buildUserLedger(events);

    expect(result[0]).toMatchObject({
      userAddress: '0x2222222222222222222222222222222222222222',
      eventType: 'Withdrawal',
      withdrawalAmount: 400n,
      userUnits: null,
      userNav: 1600n,
      netUserPosition: -400n,
    });
  });

  it('does not treat event-time NAV as raw user units when only a balance snapshot exists', () => {
    const events = [
      makeEvent('Deposit', {
        txHash: '0x2a',
        logIndex: 1n,
        decodedData: { user: '0x1111111111111111111111111111111111111111', amount: 1_000n, userBalance: 1_000n, totalLiabilities: 1_000n },
      }),
    ];

    const result = buildUserLedger(events);

    expect(result[0]).toMatchObject({
      userUnits: null,
      userNav: 1_000n,
    });
  });

  it('tracks multiple users and their current net positions', () => {
    const events = [
      makeEvent('Deposit', { txHash: '0x3', logIndex: 0n, decodedData: { user: '0x1111111111111111111111111111111111111111', amount: 100n, userBalance: 100n, totalLiabilities: 100n } }),
      makeEvent('Deposit', { txHash: '0x4', logIndex: 1n, decodedData: { user: '0x2222222222222222222222222222222222222222', amount: 250n, userBalance: 250n, totalLiabilities: 250n } }),
      makeEvent('Withdrawal', { txHash: '0x5', logIndex: 2n, decodedData: { user: '0x1111111111111111111111111111111111111111', amount: 40n, userBalance: 60n, totalLiabilities: 310n } }),
    ];

    const summary = summarizeUserLedger(events);

    expect(summary['0x1111111111111111111111111111111111111111']).toMatchObject({
      depositAmount: 100n,
      withdrawalAmount: 40n,
      netUserPosition: 60n,
    });
    expect(summary['0x2222222222222222222222222222222222222222']).toMatchObject({
      depositAmount: 250n,
      withdrawalAmount: 0n,
      netUserPosition: 250n,
    });
  });

  it('records strategy allocation changes', () => {
    const events = [
      makeEvent('AllocationChanged', {
        txHash: '0x6',
        logIndex: 3n,
        decodedData: { strategy: '0x4444444444444444444444444444444444444444', amount: 500n, position: 500n, totalDeployed: 500n },
      }),
    ];

    const result = buildStrategyLedger(events);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      eventType: 'AllocationChanged',
      strategyAddress: '0x4444444444444444444444444444444444444444',
      principal: null,
      totalDeployed: 500n,
      currentValue: 500n,
    });
  });

  it('preserves a bytes32 protocol ID without address normalization', () => {
    const protocolId = '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450';
    const result = buildStrategyLedger([
      makeEvent('ProtocolExposureChanged', {
        txHash: '0x6a',
        logIndex: 3n,
        decodedData: { protocol: protocolId, exposure: 600n, absoluteCap: 1_000n, relativeCapBps: 5_000 },
      }),
    ]);

    expect(result[0]).toMatchObject({ protocolId, protocolExposure: 600n });
  });

  it('preserves strategy approval state and cap values without changing protocol IDs', () => {
    const protocolId = '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450';
    const strategy = '0x8888888888888888888888888888888888888888';
    const result = buildStrategyLedger([
      makeEvent('StrategyApprovalChanged', {
        txHash: '0x6b',
        logIndex: 3n,
        decodedData: {
          strategy,
          protocol: protocolId,
          asset: '0x3600000000000000000000000000000000000000',
          approved: true,
          enabled: true,
          absoluteCap: 2_000n,
          relativeCapBps: 5_000,
        },
      }),
    ]);

    expect(result[0]).toMatchObject({
      strategyAddress: strategy,
      protocolId,
      approved: true,
      enabled: true,
      absoluteCap: 2_000n,
      relativeCapBps: 5_000n,
    });
  });

  it('records strategy deallocation and shortfall', () => {
    const events = [
      makeEvent('StrategyDeallocated', {
        txHash: '0x7',
        logIndex: 4n,
        decodedData: { strategy: '0x5555555555555555555555555555555555555555', amount: 75n, position: 0n, totalDeployed: 25n, emergency: false },
      }),
    ];

    const result = buildStrategyLedger(events);

    expect(result[0]).toMatchObject({
      strategyAddress: '0x5555555555555555555555555555555555555555',
      eventType: 'StrategyDeallocated',
      principal: null,
      currentValue: 0n,
      withdrawalShortfall: null,
    });
  });

  it('records authoritative cumulative strategy accounting snapshots', () => {
    const events = [
      makeEvent('StrategyAccountingUpdated', {
        txHash: '0x7a',
        logIndex: 4n,
        decodedData: {
          strategy: '0x7777777777777777777777777777777777777777',
          principal: 1_000n,
          shares: 900n,
          currentValue: 1_200n,
          realizedYield: 250n,
          realizedLoss: 50n,
          withdrawalShortfall: 10n,
          totalDeployed: 1_200n,
          valuationBlock: 300n,
          status: 1,
        },
      }),
    ];

    expect(buildStrategyLedger(events)[0]).toMatchObject({
      principal: 1_000n,
      shares: 900n,
      currentValue: 1_200n,
      realizedYield: 250n,
      realizedLoss: 50n,
      withdrawalShortfall: 10n,
      valuationStatus: 1,
      valuationBlock: 300n,
      totalDeployed: 1_200n,
    });
  });

  it('records valuation updates and status', () => {
    const events = [
      makeEvent('StrategyValuationUpdated', {
        txHash: '0x8',
        logIndex: 5n,
        decodedData: { strategy: '0x6666666666666666666666666666666666666666', value: 1200n, shares: 100n, fees: 25n, blockNumber: 200n, status: 1 },
      }),
      makeEvent('StrategyValuationStatusChanged', {
        txHash: '0x9',
        logIndex: 6n,
        decodedData: { strategy: '0x6666666666666666666666666666666666666666', status: 1 },
      }),
    ];

    const result = buildStrategyLedger(events);

    expect(result[0]).toMatchObject({
      strategyAddress: '0x6666666666666666666666666666666666666666',
      eventType: 'StrategyValuationUpdated',
      currentValue: 1200n,
      shares: 100n,
      valuationStatus: 1,
    });
    expect(result[1]).toMatchObject({
      strategyAddress: '0x6666666666666666666666666666666666666666',
      eventType: 'StrategyValuationStatusChanged',
      valuationStatus: 1,
    });
  });

  it('ignores duplicate replay and keeps only unique ledger rows', () => {
    const events = [
      makeEvent('Deposit', { txHash: '0x10', logIndex: 9n, decodedData: { user: '0x1111111111111111111111111111111111111111', amount: 500n, userBalance: 500n, totalLiabilities: 500n } }),
      makeEvent('Deposit', { txHash: '0x10', logIndex: 9n, decodedData: { user: '0x1111111111111111111111111111111111111111', amount: 500n, userBalance: 500n, totalLiabilities: 500n } }),
    ];

    expect(buildUserLedger(events)).toHaveLength(1);
    expect(summarizeUserLedger(events)['0x1111111111111111111111111111111111111111'].depositAmount).toBe(500n);
  });

  it('marks missing event data as null without crashing', () => {
    const events = [
      makeEvent('Deposit', {
        txHash: '0x11',
        logIndex: 10n,
        decodedData: { user: '0x1111111111111111111111111111111111111111' },
      }),
    ];

    const result = buildUserLedger(events);
    expect(result[0]).toMatchObject({
      userAddress: '0x1111111111111111111111111111111111111111',
      depositAmount: null,
      userUnits: null,
      netUserPosition: null,
    });
  });

  it('keeps ledger totals consistent across deposits and withdrawals', () => {
    const events = [
      makeEvent('Deposit', { txHash: '0x12', logIndex: 11n, decodedData: { user: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 100n, userBalance: 100n, totalLiabilities: 100n } }),
      makeEvent('Deposit', { txHash: '0x13', logIndex: 12n, decodedData: { user: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 50n, userBalance: 150n, totalLiabilities: 150n } }),
      makeEvent('Withdrawal', { txHash: '0x14', logIndex: 13n, decodedData: { user: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 30n, userBalance: 120n, totalLiabilities: 150n } }),
    ];

    const summary = summarizeUserLedger(events);
    expect(summary['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']).toMatchObject({
      depositAmount: 150n,
      withdrawalAmount: 30n,
      netUserPosition: 120n,
    });
  });
});
