import { describe, expect, it } from 'vitest';

import type { TokenBalanceDescriptor } from '../types';
import {
  getEmergencyControls,
  getTreasuryAllocations,
  getTreasuryBalances,
  getTreasuryRules,
  getTreasuryStatusBanner,
  getTreasurySummary,
} from './treasuryService';

describe('treasuryService', () => {
  it('returns disconnected balance descriptors when wallet is not connected', () => {
    const balances = getTreasuryBalances({
      isConnected: false,
      isArcMainnet: false,
    });

    expect(balances.total.state).toBe('disconnected');
    expect(balances.total.rawAmount).toBeNull();
    expect(balances.total.formattedAmount).toBeNull();
    expect(balances.total.decimals).toBe(6);
    expect(balances.total.symbol).toBe('USDC');
    expect(balances.total.message).toBe('Wallet not connected');

    expect(balances.available.state).toBe('disconnected');
    expect(balances.available.rawAmount).toBeNull();
    expect(balances.allocated.state).toBe('disconnected');
    expect(balances.allocated.rawAmount).toBeNull();
  });

  it('returns wrong_network balance descriptors when connected to an unsupported chain', () => {
    const balances = getTreasuryBalances({
      isConnected: true,
      isArcMainnet: false,
    });

    expect(balances.total.state).toBe('wrong_network');
    expect(balances.total.rawAmount).toBeNull();
    expect(balances.total.formattedAmount).toBeNull();
    expect(balances.total.decimals).toBe(6);
    expect(balances.total.message).toBe('Switch to Arc Mainnet to view');
  });

  it('defaults to loading state on Arc Mainnet while balance query initializes', () => {
    const balances = getTreasuryBalances({
      isConnected: true,
      isArcMainnet: true,
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainName: 'Arc',
    });

    expect(balances.total.state).toBe('loading');
    expect(balances.total.rawAmount).toBeNull();
    expect(balances.total.formattedAmount).toBeNull();
    expect(balances.total.decimals).toBe(6);
    expect(balances.total.message).toBe('Fetching USDC balance...');

    expect(balances.available.state).toBe('pending_integration');
    expect(balances.available.rawAmount).toBeNull();
    expect(balances.available.message).toContain('Reserve-aware Treasury liquidity is unavailable');

    expect(balances.allocated.state).toBe('pending_integration');
    expect(balances.allocated.rawAmount).toBeNull();
    expect(balances.allocated.message).toContain('unavailable from current Core data');
  });

  it('integrates live synced USDC balance into treasury balances without fabricating data', () => {
    const liveUSDC: TokenBalanceDescriptor = {
      symbol: 'USDC',
      decimals: 6,
      rawAmount: 75_250_000n, // 75.25 USDC
      formattedAmount: '75.25',
      state: 'synced',
      message: 'Live Arc Mainnet balance',
    };

    const balances = getTreasuryBalances(
      {
        isConnected: true,
        isArcMainnet: true,
        address: '0x1234567890abcdef1234567890abcdef12345678',
        chainName: 'Arc',
      },
      liveUSDC,
    );

    expect(balances.total.state).toBe('synced');
    expect(balances.total.rawAmount).toBe(75_250_000n);
    expect(balances.total.formattedAmount).toBe('75.25');

    expect(balances.available.state).toBe('pending_integration');
    expect(balances.available.rawAmount).toBeNull();
    expect(balances.available.formattedAmount).toBeNull();

    expect(balances.allocated.state).toBe('pending_integration');
    expect(balances.allocated.rawAmount).toBeNull();
    expect(balances.allocated.message).toContain('unavailable from current Core data');
  });

  it('preserves error state and does not falsely display 0.00 when reading fails', () => {
    const errorUSDC: TokenBalanceDescriptor = {
      symbol: 'USDC',
      decimals: 6,
      rawAmount: null,
      formattedAmount: null,
      state: 'error',
      message: 'RPC connection timed out',
    };

    const balances = getTreasuryBalances(
      {
        isConnected: true,
        isArcMainnet: true,
        address: '0x1234567890abcdef1234567890abcdef12345678',
        chainName: 'Arc',
      },
      errorUSDC,
    );

    expect(balances.total.state).toBe('error');
    expect(balances.total.formattedAmount).toBeNull();
    expect(balances.total.message).toBe('RPC connection timed out');

    expect(balances.available.state).toBe('pending_integration');
    expect(balances.available.formattedAmount).toBeNull();
  });

  it('provides structured allocation buckets without fake balances', () => {
    const allocations = getTreasuryAllocations({
      isConnected: true,
      isArcMainnet: true,
    });

    expect(allocations.buckets.length).toBeGreaterThanOrEqual(4);
    expect(allocations.totalAllocatedPercentageBps).toBeNull();

    for (const bucket of allocations.buckets) {
      expect(bucket.targetPercentageBps).toBeNull();
      expect(bucket.currentAmount).toBeNull();
      expect(bucket.status).toBe('unavailable');
    }
  });

  it('labels application-only rule previews as not enforced by Core', () => {
    const rules = getTreasuryRules();
    expect(rules.length).toBe(3);

    const minReserve = rules.find((r) => r.triggerType === 'min_reserve');
    expect(minReserve).toBeDefined();
    expect(minReserve?.thresholdDisplay).toBe('0.00 USDC');
    expect(minReserve?.implementationStage).toContain('not enforced by final Core');
    expect(rules.find((rule) => rule.triggerType === 'excess_sweep')?.description).toContain('final Core exposes no surplus-sweep threshold');
    expect(rules.find((rule) => rule.triggerType === 'max_outflow')?.implementationStage).toContain('not enforced by final Core');
  });

  it('returns emergency controls in standby mode without active pause', () => {
    const emergency = getEmergencyControls();
    expect(emergency.status).toBe('standby');
    expect(emergency.isPaused).toBe(false);
    expect(emergency.limits.length).toBe(2);
    expect(emergency.statusNotice).toContain('legacy application-only previews');
    expect(emergency.statusNotice).toContain('on-chain emergency pause');
    expect(emergency.limits[0].description).toContain('does not enforce a per-withdrawal cap');
    expect(emergency.limits[1].description).toContain('does not enforce a rolling 24-hour cap');
  });

  it('constructs complete treasury summary with live USDC balance', () => {
    const liveUSDC: TokenBalanceDescriptor = {
      symbol: 'USDC',
      decimals: 6,
      rawAmount: 100_000_000n,
      formattedAmount: '100.00',
      state: 'synced',
      message: 'Live Arc Mainnet balance',
    };

    const summary = getTreasurySummary(
      {
        isConnected: true,
        isArcMainnet: true,
        address: '0x1234567890abcdef1234567890abcdef12345678',
        chainName: 'Arc',
      },
      liveUSDC,
    );

    expect(summary.isConnected).toBe(true);
    expect(summary.isArcMainnet).toBe(true);
    expect(summary.balances.total.formattedAmount).toBe('100.00');
    expect(summary.balances.available.state).toBe('pending_integration');
    expect(summary.balances.available.formattedAmount).toBeNull();
    expect(summary.statusBanner.type).toBe('notice');
    expect(summary.statusBanner.title).toBe('Treasury Live on Arc Mainnet');
  });

  it('shows warning banner when wallet is disconnected', () => {
    const banner = getTreasuryStatusBanner({
      isConnected: false,
      isArcMainnet: false,
    });

    expect(banner.type).toBe('warning');
    expect(banner.title).toBe('Wallet Not Connected');
  });

  it('shows warning banner when wrong network is detected', () => {
    const banner = getTreasuryStatusBanner({
      isConnected: true,
      isArcMainnet: false,
    });

    expect(banner.type).toBe('warning');
    expect(banner.title).toBe('Wrong Network Detected');
  });

  it('shows error banner when USDC balance fetch fails', () => {
    const banner = getTreasuryStatusBanner(
      {
        isConnected: true,
        isArcMainnet: true,
      },
      {
        symbol: 'USDC',
        decimals: 6,
        rawAmount: null,
        formattedAmount: null,
        state: 'error',
        message: 'Contract call reverted',
      },
    );

    expect(banner.type).toBe('warning');
    expect(banner.title).toBe('USDC Balance Read Error');
    expect(banner.message).toContain('Contract call reverted');
  });
});
