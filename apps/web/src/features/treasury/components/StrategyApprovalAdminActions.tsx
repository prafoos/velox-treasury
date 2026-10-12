import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseEventLogs, zeroAddress, zeroHash, type Hex } from 'viem';
import { usePublicClient, useWriteContract } from 'wagmi';

import { useWalletStatus } from '../../../hooks/useWalletStatus';
import {
  POLICY_ADMIN_ROLE,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import {
  APPROVAL_ABSOLUTE_CAP,
  APPROVAL_RELATIVE_CAP_BPS,
} from '../services/approvalScheduling';
import {
  STEAKHOUSE_CORE_ADDRESS,
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from '../services/protocolVaultMapping';
import {
  scheduleSteakhouseStrategyApproval,
  STEAKHOUSE_STRATEGY_ADDRESS,
  strategyApprovalBlockers,
  STRATEGY_APPROVAL_OPERATION_KIND,
  type StrategyApprovalPreflight,
} from '../services/strategyApprovalReadiness';

const adapterAbi = [
  { type: 'function', name: 'protocol', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'vault', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

export function StrategyApprovalAdminActions() {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const { writeContractAsync, isPending } = useWriteContract();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preflightQuery = useQuery({
    queryKey: ['steakhouse-strategy-approval-preflight', address?.toLowerCase() ?? null],
    enabled: Boolean(isConnected && isArcMainnet && address && publicClient),
    retry: false,
    queryFn: async (): Promise<StrategyApprovalPreflight> => {
      if (!publicClient || !address) throw new Error('Arc Mainnet wallet or public client is unavailable.');
      const [chainId, policyAdminRole, adapterCode, strategy] = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
        publicClient.getChainId(),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [POLICY_ADMIN_ROLE, address],
        }),
        publicClient.getBytecode({ address: STEAKHOUSE_STRATEGY_ADDRESS }),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'strategies',
          args: [STEAKHOUSE_STRATEGY_ADDRESS],
        }),
      ]));
      const [adapterProtocol, adapterAsset, adapterVault, coreProtocolVault, coreUSDC, paused, protocolCaps, assetCaps] =
        await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
          adapterCode && adapterCode !== '0x'
            ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterAbi, functionName: 'protocol' })
            : Promise.resolve(zeroHash),
          adapterCode && adapterCode !== '0x'
            ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterAbi, functionName: 'asset' })
            : Promise.resolve(zeroAddress),
          adapterCode && adapterCode !== '0x'
            ? publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterAbi, functionName: 'vault' })
            : Promise.resolve(zeroAddress),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'protocolVaults',
            args: [STEAKHOUSE_PROTOCOL_ID],
          }),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'usdc',
          }),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'paused',
          }),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'protocolCaps',
            args: [STEAKHOUSE_PROTOCOL_ID],
          }),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'assetCaps',
            args: [ARC_USDC_CONTRACT_ADDRESS],
          }),
        ]));
      return {
        chainId,
        coreAddress: STEAKHOUSE_CORE_ADDRESS,
        policyAdminRole,
        adapterHasCode: Boolean(adapterCode && adapterCode !== '0x'),
        adapterProtocol,
        adapterAsset,
        adapterVault,
        coreProtocolVault,
        coreUSDC,
        protocolApproval: { approved: protocolCaps[2], enabled: protocolCaps[3] },
        assetApproval: { approved: assetCaps[2], enabled: assetCaps[3] },
        strategyApproval: { approved: strategy[14], enabled: strategy[15] },
        paused,
      };
    },
  });

  const blockers = preflightQuery.data ? strategyApprovalBlockers(preflightQuery.data) : [];
  const strategyAlreadyActive = Boolean(
    preflightQuery.data?.strategyApproval.approved && preflightQuery.data.strategyApproval.enabled,
  );
  const canSchedule = preflightQuery.data !== undefined && !strategyAlreadyActive && blockers.length === 0;

  const confirmSchedule = async () => {
    if (!publicClient || !address) return;
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const result = await scheduleSteakhouseStrategyApproval({
        preflight: async () => {
          const refreshed = await preflightQuery.refetch();
          if (!refreshed.data) throw new Error('Strategy Approval preflight could not be verified.');
          return refreshed.data;
        },
        submit: (strategy, protocol, asset, absoluteCap, relativeCapBps) => writeContractAsync({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'scheduleStrategyApproval',
          args: [strategy, protocol, asset, absoluteCap, relativeCapBps],
          chainId: ARC_MAINNET_CHAIN_ID,
        }),
        waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(publicClient, async () => {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          const coreLogs = receipt.logs.filter((log) => log.address.toLowerCase() === STEAKHOUSE_CORE_ADDRESS.toLowerCase());
          const event = parseEventLogs({
            abi: veloxTreasuryAbi,
            logs: coreLogs,
            eventName: 'TimelockScheduled',
          }).find((entry) => Number(entry.args.kind) === STRATEGY_APPROVAL_OPERATION_KIND);
          if (receipt.status === 'success' && !event) {
            throw new Error('Strategy schedule receipt did not contain its Core TimelockScheduled event.');
          }
          return {
            status: receipt.status,
            blockNumber: receipt.blockNumber,
            operationId: (event?.args.operationId ?? `0x${'0'.repeat(64)}`) as Hex,
            scheduledEta: event?.args.eta ?? 0n,
          };
        }),
        readPendingOperation: async (operationId): Promise<{
          readonly kind: number;
          readonly eta: bigint;
          readonly subject: `0x${string}`;
          readonly secondary: Hex;
          readonly tertiary: `0x${string}`;
          readonly value1: bigint;
          readonly value2: bigint;
          readonly bps: number;
          readonly bps2: number;
          readonly bps3: number;
          readonly bps4: number;
        }> => {
          const operation = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'pendingOperations',
            args: [operationId],
          }));
          return {
            kind: Number(operation[0]),
            eta: operation[1],
            subject: operation[2],
            secondary: operation[3],
            tertiary: operation[4],
            value1: operation[5],
            value2: operation[6],
            bps: operation[7],
            bps2: operation[8],
            bps3: operation[9],
            bps4: operation[10],
          };
        },
      });
      setStatus(`Strategy Approval schedule confirmed (not executed): ${result.hash}, block ${result.blockNumber}, operation ${result.operationId}, ETA ${result.eta}.`);
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Strategy Approval scheduling failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isConnected || !isArcMainnet || !address) return null;

  return (
    <section className="vx-section" aria-labelledby="strategy-approval-admin-title">
      <h2 id="strategy-approval-admin-title">Steakhouse Strategy Approval</h2>
      <p>Admin-only schedule action. This panel has no strategy-approval execute action.</p>
      <div>Core: <code>0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7</code></div>
      <div>Strategy / Adapter: <code>{STEAKHOUSE_STRATEGY_ADDRESS}</code></div>
      <div>Protocol: <code>{STEAKHOUSE_PROTOCOL_ID}</code></div>
      <div>USDC: <code>{ARC_USDC_CONTRACT_ADDRESS}</code></div>
      <div>Vault: <code>{STEAKHOUSE_VAULT_ADDRESS}</code></div>
      <div>Absolute cap: <strong>{APPROVAL_ABSOLUTE_CAP.toString()}</strong></div>
      <div>Relative cap: <strong>{APPROVAL_RELATIVE_CAP_BPS} BPS</strong></div>
      {preflightQuery.isFetching && <p role="status">Verifying live strategy-approval preflight...</p>}
      {preflightQuery.error && <p role="alert">{preflightQuery.error.message}</p>}
      {strategyAlreadyActive && (
        <p role="status">Strategy Approval is already executed; Core confirms the strategy is approved and enabled. No schedule is needed.</p>
      )}
      {preflightQuery.data && blockers.length > 0 && (
        <div className="vx-step-callout warning" role="status">
          <strong>BLOCKED: Strategy Approval cannot be scheduled.</strong>
          <ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      )}
      {canSchedule && (
        <button
          type="button"
          className="vx-btn vx-btn-primary"
          disabled={isPending || submitting || preflightQuery.isFetching}
          onClick={() => { setError(null); setConfirming(true); }}
        >
          Review Strategy Approval Schedule
        </button>
      )}
      {confirming && canSchedule && (
        <div className="vx-step-callout warning" role="group" aria-label="Confirm Strategy Approval schedule">
          <p>
            Confirm scheduling only: scheduleStrategyApproval({STEAKHOUSE_STRATEGY_ADDRESS}, {STEAKHOUSE_PROTOCOL_ID},
            {' '}{ARC_USDC_CONTRACT_ADDRESS}, {APPROVAL_ABSOLUTE_CAP.toString()}, {APPROVAL_RELATIVE_CAP_BPS}).
            This does not execute the approval.
          </p>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            disabled={isPending || submitting}
            onClick={() => { void confirmSchedule(); }}
          >
            Confirm Strategy Approval Schedule
          </button>
          <button type="button" className="vx-btn" disabled={submitting} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
