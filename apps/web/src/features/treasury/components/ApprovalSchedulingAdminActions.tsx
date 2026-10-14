import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseEventLogs, type Address, type Hex } from 'viem';
import { useWriteContract } from 'wagmi';

import { useWalletStatus } from '../../../hooks/useWalletStatus';
import { POLICY_ADMIN_ROLE, veloxTreasuryAbi } from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { arcMainnetReadClient, withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import {
  APPROVAL_ABSOLUTE_CAP,
  APPROVAL_RELATIVE_CAP_BPS,
  APPROVAL_SCHEDULE_TARGETS,
  scheduleArcUsdcAssetApproval,
  scheduleSteakhouseProtocolApproval,
  type ApprovalPendingOperation,
} from '../services/approvalScheduling';
import {
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from '../services/protocolVaultMapping';

type ApprovalType = 'protocol' | 'asset';

export function ApprovalSchedulingAdminActions() {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const publicClient = arcMainnetReadClient;
  const { writeContractAsync, isPending } = useWriteContract();
  const [confirmation, setConfirmation] = useState<ApprovalType | null>(null);
  const [submitting, setSubmitting] = useState<ApprovalType | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preflightQuery = useQuery({
    queryKey: ['approval-scheduling-admin-preflight', address?.toLowerCase() ?? null],
    enabled: Boolean(isConnected && isArcMainnet && address),
    retry: false,
    queryFn: async () => {
      if (!address) throw new Error('Arc Mainnet wallet is unavailable.');
      const authorized = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
        address: APPROVAL_SCHEDULE_TARGETS.core,
        abi: veloxTreasuryAbi,
        functionName: 'hasRole',
        args: [POLICY_ADMIN_ROLE, address],
      }));
      if (!authorized) return { authorized: false as const };

      const [vault, coreUsdc, paused] = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
        publicClient.readContract({
          address: APPROVAL_SCHEDULE_TARGETS.core,
          abi: veloxTreasuryAbi,
          functionName: 'protocolVaults',
          args: [STEAKHOUSE_PROTOCOL_ID],
        }),
        publicClient.readContract({
          address: APPROVAL_SCHEDULE_TARGETS.core,
          abi: veloxTreasuryAbi,
          functionName: 'usdc',
        }),
        publicClient.readContract({
          address: APPROVAL_SCHEDULE_TARGETS.core,
          abi: veloxTreasuryAbi,
          functionName: 'paused',
        }),
      ]));
      return { authorized: true as const, vault, coreUsdc, paused };
    },
  });

  const submitApproval = async (approval: ApprovalType) => {
    if (!address) return;
    setSubmitting(approval);
    setStatus(null);
    setError(null);
    try {
      const ports = {
        chainId: isArcMainnet ? ARC_MAINNET_CHAIN_ID : 0,
        accountAddress: address,
        readPolicyAdminRole: (account: Address) => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: APPROVAL_SCHEDULE_TARGETS.core,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [POLICY_ADMIN_ROLE, account],
        })),
        readProtocolVault: () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: APPROVAL_SCHEDULE_TARGETS.core,
          abi: veloxTreasuryAbi,
          functionName: 'protocolVaults',
          args: [STEAKHOUSE_PROTOCOL_ID],
        })),
        readCoreUSDC: () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: APPROVAL_SCHEDULE_TARGETS.core,
          abi: veloxTreasuryAbi,
          functionName: 'usdc',
        })),
        readPaused: () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: APPROVAL_SCHEDULE_TARGETS.core,
          abi: veloxTreasuryAbi,
          functionName: 'paused',
        })),
        submitProtocol: (protocol: Hex, absoluteCap: bigint, relativeCapBps: number) => writeContractAsync({
            address: APPROVAL_SCHEDULE_TARGETS.core,
            abi: veloxTreasuryAbi,
            functionName: 'scheduleProtocolApproval',
            args: [protocol, absoluteCap, relativeCapBps],
            chainId: ARC_MAINNET_CHAIN_ID,
          }),
        submitAsset: (asset: Address, absoluteCap: bigint, relativeCapBps: number) => writeContractAsync({
            address: APPROVAL_SCHEDULE_TARGETS.core,
            abi: veloxTreasuryAbi,
            functionName: 'scheduleAssetApproval',
            args: [asset, absoluteCap, relativeCapBps],
            chainId: ARC_MAINNET_CHAIN_ID,
          }),
        waitForReceipt: (hash: Hex) => withVerifiedArcMainnetPublicClient(publicClient, async () => {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          const coreLogs = receipt.logs.filter((log) => log.address.toLowerCase() === APPROVAL_SCHEDULE_TARGETS.core.toLowerCase());
          const expectedKind = approval === 'protocol' ? 1 : 2;
          const event = parseEventLogs({
            abi: veloxTreasuryAbi,
            logs: coreLogs,
            eventName: 'TimelockScheduled',
          }).find((entry) => Number(entry.args.kind) === expectedKind);
          if (receipt.status === 'success' && !event) {
            throw new Error('Schedule receipt did not contain the expected Core TimelockScheduled event.');
          }
          return {
            status: receipt.status,
            blockNumber: receipt.blockNumber,
            operationId: (event?.args.operationId ?? `0x${'0'.repeat(64)}`) as Hex,
            scheduledEta: event?.args.eta ?? 0n,
          };
        }),
        readPendingOperation: async (operationId: Hex): Promise<ApprovalPendingOperation> => {
          const operation = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: APPROVAL_SCHEDULE_TARGETS.core,
            abi: veloxTreasuryAbi,
            functionName: 'pendingOperations',
            args: [operationId],
          }));
          return {
            kind: Number(operation[0]),
            eta: operation[1],
            subject: operation[2] as Address,
            secondary: operation[3],
            value1: operation[5],
            value2: operation[6],
            bps: operation[7],
            bps2: operation[8],
            bps3: operation[9],
            bps4: operation[10],
          };
        },
      };

      const result = approval === 'protocol'
        ? await scheduleSteakhouseProtocolApproval(ports)
        : await scheduleArcUsdcAssetApproval(ports);
      setStatus(
        `${approval === 'protocol' ? 'Protocol' : 'USDC asset'} approval scheduled (not executed). `
        + `Transaction ${result.hash}, block ${result.blockNumber}, operation ${result.operationId}, ETA ${result.eta}.`,
      );
      setConfirmation(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Approval schedule failed.');
    } finally {
      setSubmitting(null);
    }
  };

  const canSchedule = preflightQuery.data?.authorized === true
    && preflightQuery.data.vault.toLowerCase() === STEAKHOUSE_VAULT_ADDRESS.toLowerCase()
    && preflightQuery.data.coreUsdc.toLowerCase() === ARC_USDC_CONTRACT_ADDRESS.toLowerCase()
    && !preflightQuery.data.paused;

  if (!isConnected || !isArcMainnet || !address) return null;

  return (
    <section className="vx-section" aria-labelledby="approval-scheduling-title">
      <div className="vx-section-header">
        <div className="vx-section-title-group">
          <h2 id="approval-scheduling-title">Schedule Protocol and USDC Approvals</h2>
          <p>Schedules the approved caps in the Core timelock. Scheduling does not execute either approval.</p>
        </div>
      </div>
      {preflightQuery.isFetching && <p role="status">Verifying Arc Mainnet, live Policy Admin role, protocol vault, and Core USDC...</p>}
      {preflightQuery.error && <p role="alert">{preflightQuery.error.message}</p>}
      {preflightQuery.data?.authorized === false && (
        <p role="alert">Connected wallet does not have POLICY_ADMIN_ROLE on the current Core.</p>
      )}
      {preflightQuery.data?.authorized === true && !canSchedule && (
        <p role="alert">
          Scheduling is unavailable: the live protocol-vault mapping, Core USDC, or Core pause state failed preflight.
        </p>
      )}
      <div>Core: <code>{APPROVAL_SCHEDULE_TARGETS.core}</code></div>
      <div>Protocol: <code>{STEAKHOUSE_PROTOCOL_ID}</code></div>
      <div>USDC: <code>{ARC_USDC_CONTRACT_ADDRESS}</code></div>
      <div>Absolute cap: <strong>750,000 USDC ({APPROVAL_ABSOLUTE_CAP.toString()} base units)</strong></div>
      <div>Relative cap: <strong>{APPROVAL_RELATIVE_CAP_BPS} BPS</strong></div>
      <div>Protocol vault preflight: <code>{STEAKHOUSE_VAULT_ADDRESS}</code></div>
      {canSchedule && (
        <div className="vx-page-action-group" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            disabled={isPending || submitting !== null || preflightQuery.isFetching}
            onClick={() => { setError(null); setConfirmation('protocol'); }}
          >
            Review Protocol Approval Schedule
          </button>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            disabled={isPending || submitting !== null || preflightQuery.isFetching}
            onClick={() => { setError(null); setConfirmation('asset'); }}
          >
            Review USDC Asset Approval Schedule
          </button>
        </div>
      )}
      {confirmation && (
        <div className="vx-step-callout warning" role="group" aria-label="Confirm approval schedule">
          <p>
            Confirm scheduling only: {confirmation === 'protocol' ? 'Protocol Approval' : 'USDC Asset Approval'} with
            {' '}absoluteCap {APPROVAL_ABSOLUTE_CAP.toString()} and relativeCapBps {APPROVAL_RELATIVE_CAP_BPS}.
            {' '}This does not execute the approval.
          </p>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            disabled={isPending || submitting !== null}
            onClick={() => { void submitApproval(confirmation); }}
          >
            {submitting === confirmation ? 'Waiting for wallet and receipt...' : `Confirm Schedule ${confirmation === 'protocol' ? 'Protocol' : 'USDC Asset'} Approval`}
          </button>
          <button
            type="button"
            className="vx-btn"
            disabled={isPending || submitting !== null}
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
