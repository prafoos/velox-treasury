import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { zeroAddress, zeroHash, type Address } from 'viem';

import { useWalletStatus } from '../../../hooks/useWalletStatus';
import { ARC_USDC_CONTRACT_ADDRESS, ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import { POLICY_ADMIN_ROLE } from '../../../contracts/treasury';
import { arcMainnetReadClient, withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import {
  STEAKHOUSE_CORE_ADDRESS,
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from '../services/protocolVaultMapping';
import { STEAKHOUSE_STRATEGY_ADDRESS } from '../services/strategyApprovalReadiness';

const syncPreflightAbi = [
  {
    type: 'function', name: 'hasRole', stateMutability: 'view',
    inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'usdc', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function', name: 'protocolVaults', stateMutability: 'view',
    inputs: [{ name: 'protocol', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'valuationFreshnessBlocks', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'strategies', stateMutability: 'view',
    inputs: [{ name: 'strategy', type: 'address' }],
    outputs: [
      { name: 'protocol', type: 'bytes32' },
      { name: 'asset', type: 'address' },
      { name: 'absoluteCap', type: 'uint256' },
      { name: 'relativeCapBps', type: 'uint16' },
      { name: 'principal', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'position', type: 'uint256' },
      { name: 'realizedYield', type: 'uint256' },
      { name: 'realizedLoss', type: 'uint256' },
      { name: 'feesAccrued', type: 'uint256' },
      { name: 'withdrawalShortfall', type: 'uint256' },
      { name: 'lastValuationBlock', type: 'uint256' },
      { name: 'valuationSource', type: 'address' },
      { name: 'valuationStatus', type: 'uint8' },
      { name: 'approved', type: 'bool' },
      { name: 'enabled', type: 'bool' },
    ],
  },
] as const;

const adapterSyncPreflightAbi = [
  { type: 'function', name: 'core', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'protocol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'vault', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'currentValue', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'sharesOfCore', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'feesAccrued', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const vaultSyncPreflightAbi = [
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const;

interface ValuationSyncPreflight {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly coreHasCode: boolean;
  readonly adapterHasCode: boolean;
  readonly policyAdmin: boolean;
  readonly paused: boolean;
  readonly approved: boolean;
  readonly valuationBlock: bigint;
  readonly valuationStatus: number;
  readonly valuationSource: Address;
  readonly principal: bigint;
  readonly shares: bigint;
  readonly currentValue: bigint;
  readonly feesAccrued: bigint;
  readonly adapterShares: bigint;
  readonly adapterCurrentValue: bigint;
  readonly adapterFeesAccrued: bigint;
  readonly freshnessBlocks: bigint;
  readonly identitiesMatch: boolean;
}

function isStale(state: ValuationSyncPreflight): boolean {
  return state.valuationStatus !== 1
    || state.freshnessBlocks === 0n
    || state.blockNumber > state.valuationBlock + state.freshnessBlocks;
}

function hasSafePreconditions(state: ValuationSyncPreflight): boolean {
  return state.chainId === ARC_MAINNET_CHAIN_ID
    && state.coreHasCode
    && state.adapterHasCode
    && state.policyAdmin
    && !state.paused
    && state.approved
    && state.freshnessBlocks > 0n
    && state.identitiesMatch;
}

function isReady(state: ValuationSyncPreflight): boolean {
  return hasSafePreconditions(state) && isStale(state);
}

function matchesReviewedState(
  reviewed: ValuationSyncPreflight,
  current: ValuationSyncPreflight,
): boolean {
  return reviewed.valuationBlock === current.valuationBlock
    && reviewed.valuationStatus === current.valuationStatus
    && reviewed.valuationSource.toLowerCase() === current.valuationSource.toLowerCase()
    && reviewed.principal === current.principal
    && reviewed.shares === current.shares
    && reviewed.currentValue === current.currentValue
    && reviewed.feesAccrued === current.feesAccrued
    && reviewed.adapterShares === current.adapterShares
    && reviewed.adapterCurrentValue === current.adapterCurrentValue
    && reviewed.adapterFeesAccrued === current.adapterFeesAccrued
    && reviewed.freshnessBlocks === current.freshnessBlocks
    && reviewed.approved === current.approved
    && reviewed.paused === current.paused
    && reviewed.identitiesMatch === current.identitiesMatch;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sameAddress(left: unknown, right: string): boolean {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

function baseUnit(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export function strategyAutomationHttpErrorMessage(
  status: number,
  payload: unknown,
  responseBodyReadable = true,
): string {
  const responseBody = asRecord(payload);
  if (!responseBodyReadable || !responseBody || typeof responseBody.error !== 'string') {
    return `Strategy executor returned HTTP ${status} without a readable JSON error. Check the deployment/function logs; no success was confirmed.`;
  }

  const kind = typeof responseBody.kind === 'string' ? responseBody.kind : 'UNKNOWN_ERROR';
  if (kind === 'SIMULATION_FAILED') return `Valuation Sync simulation failed: ${responseBody.error}`;
  if (kind === 'TRANSACTION_FAILED') return `Valuation Sync transaction failed: ${responseBody.error}`;
  if (kind === 'INTERNAL_ERROR') {
    const reference = typeof responseBody.correlationId === 'string'
      && /^[\da-f-]{36}$/i.test(responseBody.correlationId)
      ? ` Reference: ${responseBody.correlationId}.`
      : '';
    return `Strategy executor encountered an unexpected API error.${reference} ${responseBody.error}`;
  }
  return `Valuation Sync failed (${kind}): ${responseBody.error}`;
}

export function validateExecutionResponse(value: unknown): {
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly readback: Record<string, unknown>;
} {
  const payload = asRecord(value);
  const readback = asRecord(payload?.readback);
  if (payload?.status !== 'confirmed'
    || payload.operation !== 'sync-valuation'
    || !/^0x[\da-fA-F]{64}$/.test(String(payload.transactionHash ?? ''))
    || typeof payload.blockNumber !== 'string'
    || !/^\d+$/.test(payload.blockNumber)
    || !readback
    || readback.valuationBlock !== payload.blockNumber
    || readback.valuationStatus !== 1
    || !sameAddress(readback.valuationSource, STEAKHOUSE_STRATEGY_ADDRESS)
    || baseUnit(readback.shares) === null
    || baseUnit(readback.position) === null
    || baseUnit(readback.feesAccrued) === null
    || baseUnit(readback.principal) === null) {
    throw new Error('The strategy executor did not return a confirmed, current valuation readback.');
  }
  return {
    transactionHash: payload.transactionHash as `0x${string}`,
    blockNumber: BigInt(payload.blockNumber),
    readback,
  };
}

export function StrategyValuationSyncAdminAction({ isAdmin }: { readonly isAdmin: boolean }) {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const publicClient = arcMainnetReadClient;
  const queryClient = useQueryClient();
  const [review, setReview] = useState<ValuationSyncPreflight | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preflightQuery = useQuery({
    queryKey: ['strategy-valuation-sync-preflight', address?.toLowerCase() ?? null],
    enabled: Boolean(isAdmin && isConnected && isArcMainnet && address),
    retry: false,
    queryFn: async (): Promise<ValuationSyncPreflight> => {
      if (!address) throw new Error('Arc Mainnet wallet is unavailable.');
      return withVerifiedArcMainnetPublicClient(publicClient, async () => {
        const [chainId, blockNumber, coreCode, adapterCode, coreState, corePaused, coreUSDC, coreVault, freshnessBlocks, policyAdmin] =
          await Promise.all([
            publicClient.getChainId(),
            publicClient.getBlockNumber(),
            publicClient.getBytecode({ address: STEAKHOUSE_CORE_ADDRESS }),
            publicClient.getBytecode({ address: STEAKHOUSE_STRATEGY_ADDRESS }),
            publicClient.readContract({
              address: STEAKHOUSE_CORE_ADDRESS,
              abi: syncPreflightAbi,
              functionName: 'strategies',
              args: [STEAKHOUSE_STRATEGY_ADDRESS],
            }),
            publicClient.readContract({ address: STEAKHOUSE_CORE_ADDRESS, abi: syncPreflightAbi, functionName: 'paused' }),
            publicClient.readContract({ address: STEAKHOUSE_CORE_ADDRESS, abi: syncPreflightAbi, functionName: 'usdc' }),
            publicClient.readContract({
              address: STEAKHOUSE_CORE_ADDRESS,
              abi: syncPreflightAbi,
              functionName: 'protocolVaults',
              args: [STEAKHOUSE_PROTOCOL_ID],
            }),
            publicClient.readContract({
              address: STEAKHOUSE_CORE_ADDRESS,
              abi: syncPreflightAbi,
              functionName: 'valuationFreshnessBlocks',
            }),
            publicClient.readContract({
              address: STEAKHOUSE_CORE_ADDRESS,
              abi: syncPreflightAbi,
              functionName: 'hasRole',
              args: [POLICY_ADMIN_ROLE, address],
            }),
          ]);
        const [adapterCore, adapterProtocol, adapterAsset, adapterVault, adapterCurrentValue, adapterShares, adapterFeesAccrued, vaultAsset] =
          await Promise.all([
            adapterCode && adapterCode !== '0x'
              ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterSyncPreflightAbi, functionName: 'core' })
              : Promise.resolve(zeroAddress),
            adapterCode && adapterCode !== '0x'
              ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterSyncPreflightAbi, functionName: 'protocol' })
              : Promise.resolve(zeroHash),
            adapterCode && adapterCode !== '0x'
              ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterSyncPreflightAbi, functionName: 'asset' })
              : Promise.resolve(zeroAddress),
            adapterCode && adapterCode !== '0x'
              ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterSyncPreflightAbi, functionName: 'vault' })
              : Promise.resolve(zeroAddress),
            adapterCode && adapterCode !== '0x'
              ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterSyncPreflightAbi, functionName: 'currentValue' })
              : Promise.resolve(0n),
            adapterCode && adapterCode !== '0x'
              ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterSyncPreflightAbi, functionName: 'sharesOfCore' })
              : Promise.resolve(0n),
            adapterCode && adapterCode !== '0x'
              ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterSyncPreflightAbi, functionName: 'feesAccrued' })
              : Promise.resolve(0n),
            publicClient.readContract({ address: STEAKHOUSE_VAULT_ADDRESS, abi: vaultSyncPreflightAbi, functionName: 'asset' }),
          ]);
        return {
          chainId,
          blockNumber,
          coreHasCode: Boolean(coreCode && coreCode !== '0x'),
          adapterHasCode: Boolean(adapterCode && adapterCode !== '0x'),
          policyAdmin,
          paused: corePaused,
          approved: coreState[14],
          valuationBlock: coreState[11],
          valuationStatus: Number(coreState[13]),
          valuationSource: coreState[12],
          principal: coreState[4],
          shares: coreState[5],
          currentValue: coreState[6],
          feesAccrued: coreState[9],
          adapterShares,
          adapterCurrentValue,
          adapterFeesAccrued,
          freshnessBlocks,
          identitiesMatch: coreUSDC.toLowerCase() === ARC_USDC_CONTRACT_ADDRESS.toLowerCase()
            && coreVault.toLowerCase() === STEAKHOUSE_VAULT_ADDRESS.toLowerCase()
            && coreState[0].toLowerCase() === STEAKHOUSE_PROTOCOL_ID.toLowerCase()
            && coreState[1].toLowerCase() === ARC_USDC_CONTRACT_ADDRESS.toLowerCase()
            && adapterCore.toLowerCase() === STEAKHOUSE_CORE_ADDRESS.toLowerCase()
            && adapterProtocol.toLowerCase() === STEAKHOUSE_PROTOCOL_ID.toLowerCase()
            && adapterAsset.toLowerCase() === ARC_USDC_CONTRACT_ADDRESS.toLowerCase()
            && adapterVault.toLowerCase() === STEAKHOUSE_VAULT_ADDRESS.toLowerCase()
            && vaultAsset.toLowerCase() === ARC_USDC_CONTRACT_ADDRESS.toLowerCase(),
        };
      });
    },
  });

  if (!isAdmin) return null;
  if (!isConnected || !isArcMainnet || !address) {
    return (
      <section className="vx-section" aria-labelledby="valuation-sync-title">
        <h2 id="valuation-sync-title">Valuation Sync</h2>
        <p>Connect an authenticated Policy Admin wallet on Arc Mainnet to review this action.</p>
      </section>
    );
  }

  const refreshPreflight = async (): Promise<ValuationSyncPreflight> => {
    const refreshed = await preflightQuery.refetch();
    if (refreshed.isError || refreshed.error || !refreshed.data) {
      throw new Error('Valuation Sync preconditions could not be freshly verified.', { cause: refreshed.error });
    }
    return refreshed.data;
  };

  const beginReview = async () => {
    setError(null);
    setStatus(null);
    try {
      const state = await refreshPreflight();
      if (!isReady(state)) throw new Error('Valuation Sync preconditions are not satisfied. Refresh and review the Admin checks.');
      setReview(state);
    } catch (caught) {
      setReview(null);
      setError(caught instanceof Error ? caught.message : 'Valuation Sync preflight failed.');
    }
  };

  const confirmAndSync = async () => {
    if (!review) return;
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const before = await refreshPreflight();
      if (!isReady(before)) throw new Error('Valuation Sync preconditions changed. No transaction was requested.');
      if (!matchesReviewedState(review, before)) {
        throw new Error('Strategy valuation changed since review. No transaction was requested; review the refreshed values.');
      }

      let response: Response;
      try {
        response = await fetch('/api/strategy-automation', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ operation: 'sync-valuation' }),
        });
      } catch {
        throw new Error('Could not reach the strategy executor API. No success was confirmed; check connectivity and retry after verifying status.');
      }

      let payload: unknown = null;
      let responseBodyReadable = true;
      try {
        payload = await response.json();
      } catch {
        responseBodyReadable = false;
      }
      const responseBody = asRecord(payload);
      if (!response.ok) {
        throw new Error(strategyAutomationHttpErrorMessage(response.status, payload, responseBodyReadable));
      }
      if (!responseBodyReadable) {
        throw new Error('Strategy executor returned an unreadable success response. The transaction outcome is unconfirmed; check its status before retrying.');
      }
      const execution = validateExecutionResponse(payload);
      if (!sameAddress(responseBody?.coreAddress, STEAKHOUSE_CORE_ADDRESS)
        || !sameAddress(responseBody?.strategyAddress, STEAKHOUSE_STRATEGY_ADDRESS)
        || execution.blockNumber <= before.blockNumber) {
        throw new Error('Valuation Sync receipt did not match the configured Arc Mainnet Core and adapter.');
      }

      const after = await refreshPreflight();
      const readback = execution.readback;
      if (!hasSafePreconditions(after)
        || after.valuationBlock !== execution.blockNumber
        || after.valuationStatus !== 1
        || !sameAddress(after.valuationSource, STEAKHOUSE_STRATEGY_ADDRESS)
        || after.principal !== before.principal
        || after.shares !== after.adapterShares
        || after.currentValue !== after.adapterCurrentValue
        || after.feesAccrued !== after.adapterFeesAccrued
        || after.shares !== baseUnit(readback.shares)
        || after.currentValue !== baseUnit(readback.position)
        || after.feesAccrued !== baseUnit(readback.feesAccrued)
        || after.principal !== baseUnit(readback.principal)
        || after.blockNumber > after.valuationBlock + after.freshnessBlocks) {
        throw new Error('The transaction receipt was returned, but fresh Arc Mainnet valuation readback could not be verified.');
      }

      setReview(null);
      setStatus(`Valuation Sync confirmed on Arc Mainnet in ${execution.transactionHash} at block ${execution.blockNumber}. Fresh adapter/Core value, shares, and fees were verified.`);
      await queryClient.invalidateQueries({ queryKey: ['treasury-authorized-admin-projection'] });
      await queryClient.invalidateQueries({ queryKey: ['treasury-strategy-state'] });
    } catch (caught) {
      setReview(null);
      setError(caught instanceof Error ? caught.message : 'Valuation Sync failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const state = preflightQuery.data;
  const ready = state ? isReady(state) : false;

  return (
    <section className="vx-section" aria-labelledby="valuation-sync-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="valuation-sync-title">Strategy Valuation Sync</h2>
          <p>Refresh the approved Steakhouse adapter valuation only. This action does not allocate, deallocate, deposit, or withdraw funds.</p>
        </div>
      </div>
      {preflightQuery.isFetching && <p role="status">Verifying Arc Mainnet valuation-sync preconditions…</p>}
      {preflightQuery.error && <p role="alert">Valuation Sync preflight failed: {preflightQuery.error.message}</p>}
      {state && (
        <div className="vx-core-state-group">
          <p>Network: Arc Mainnet (chain {state.chainId}); checked at block {state.blockNumber.toString()}.</p>
          <p>Strategy approval: {state.approved ? 'approved' : 'not approved'}; Core: {state.paused ? 'paused' : 'not paused'}.</p>
          <p>Valuation block: {state.valuationBlock.toString()} ({isStale(state) ? 'stale' : 'fresh'}; limit {state.freshnessBlocks.toString()} blocks).</p>
          <p>Adapter valuation source: <code>{state.valuationSource}</code>.</p>
          <p>Stored Core values: value {state.currentValue.toString()} base units; shares {state.shares.toString()}; fees {state.feesAccrued.toString()}.</p>
          <p>Current adapter readback: value {state.adapterCurrentValue.toString()} base units; shares {state.adapterShares.toString()}; fees {state.adapterFeesAccrued.toString()}.</p>
          {!state.policyAdmin && <p role="alert">Connected wallet does not hold POLICY_ADMIN_ROLE on the configured Core.</p>}
          {!state.identitiesMatch && <p role="alert">Configured Core, USDC, adapter, protocol, or vault identity did not match live Arc Mainnet readback.</p>}
          {state.paused && <p role="alert">Core is paused; valuation sync is unavailable.</p>}
          {!state.approved && <p role="alert">Strategy is not approved; valuation sync is unavailable.</p>}
          {state.freshnessBlocks === 0n && <p role="alert">Core valuation freshness is disabled; a sync cannot produce a fresh valuation.</p>}
          {!isStale(state) && <p role="status">Valuation is already fresh; no sync action is available.</p>}
          {state.principal === 0n && state.shares === 0n && state.currentValue === 0n
            && state.adapterShares === 0n && state.adapterCurrentValue === 0n
            && <p role="status">The strategy has no position. Sync can refresh freshness metadata, but will not create value, shares, or fees.</p>}
        </div>
      )}
      {!state && !preflightQuery.isFetching && !preflightQuery.error && <p role="status">Loading live Arc Mainnet preflight…</p>}
      {ready && !review && (
        <button type="button" className="vx-btn vx-btn-outline" disabled={submitting || preflightQuery.isFetching} onClick={() => { void beginReview(); }}>
          Review Valuation Sync
        </button>
      )}
      {review && (
        <div className="vx-step-callout warning" role="alert">
          <h3>Confirm Arc Mainnet transaction</h3>
          <p>This will submit an Arc Mainnet transaction calling <code>syncStrategyValuation({STEAKHOUSE_STRATEGY_ADDRESS})</code> on Core <code>{STEAKHOUSE_CORE_ADDRESS}</code>.</p>
          <p>Only valuation is synced for the approved adapter. No funds will be allocated, deallocated, deposited, or withdrawn. The adapter currently reports value {review.adapterCurrentValue.toString()}, shares {review.adapterShares.toString()}, and fees {review.adapterFeesAccrued.toString()} base units; if those are zero, this only refreshes valuation freshness metadata.</p>
          <p>The existing server executor rechecks wallet authentication, Policy Admin and Automation roles, signer configuration, Core/Adapter/vault identities, and Core simulation before submission.</p>
          <button type="button" className="vx-btn vx-btn-primary" disabled={submitting || preflightQuery.isFetching} onClick={() => { void confirmAndSync(); }}>
            {submitting ? 'Verifying and syncing…' : 'Confirm & Sync Valuation on Arc Mainnet'}
          </button>
          <button type="button" className="vx-btn vx-btn-outline" disabled={submitting} onClick={() => setReview(null)}>Cancel</button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
