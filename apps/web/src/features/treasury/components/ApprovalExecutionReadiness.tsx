import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';
import { usePublicClient, useWriteContract } from 'wagmi';

import { useWalletStatus } from '../../../hooks/useWalletStatus';
import {
  TIMELOCK_EXECUTOR_ROLE,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import { STEAKHOUSE_CORE_ADDRESS, STEAKHOUSE_PROTOCOL_ID } from '../services/protocolVaultMapping';
import {
  APPROVAL_TIMELOCK_DELAY,
  executeScheduledApproval,
  matchesApprovalOperationPayload,
  STEAKHOUSE_PROTOCOL_APPROVAL_OPERATION_ID,
  USDC_ASSET_APPROVAL_OPERATION_ID,
  type ApprovalExecutionKind,
  type ApprovalPendingOperation,
} from '../services/strategyApprovalReadiness';

type ScheduledApproval = {
  readonly operationId: Hex;
  readonly approval: ApprovalExecutionKind;
  readonly eta: bigint;
};

function mapPendingOperation(operation: readonly unknown[]): ApprovalPendingOperation {
  return {
    kind: Number(operation[0]),
    eta: operation[1] as bigint,
    subject: operation[2] as Address,
    secondary: operation[3] as Hex,
    tertiary: operation[4] as Address,
    value1: operation[5] as bigint,
    value2: operation[6] as bigint,
    bps: Number(operation[7]),
    bps2: Number(operation[8]),
    bps3: Number(operation[9]),
    bps4: Number(operation[10]),
  };
}

export function ApprovalExecutionReadiness() {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const { writeContractAsync, isPending } = useWriteContract();
  const [confirmation, setConfirmation] = useState<ScheduledApproval | null>(null);
  const [executingOperation, setExecutingOperation] = useState<Hex | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const operationsQuery = useQuery({
    queryKey: ['approval-execution-readiness', address?.toLowerCase() ?? null],
    enabled: Boolean(isConnected && isArcMainnet && address && publicClient),
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      if (!publicClient || !address) throw new Error('Arc Mainnet wallet or public client is unavailable.');
      const [executorRole, delay, block, protocolOperation, assetOperation] = await withVerifiedArcMainnetPublicClient(
        publicClient,
        () => Promise.all([
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'hasRole',
            args: [TIMELOCK_EXECUTOR_ROLE, address],
          }),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'TIMELOCK_DELAY',
          }),
          publicClient.getBlock(),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'pendingOperations',
            args: [STEAKHOUSE_PROTOCOL_APPROVAL_OPERATION_ID],
          }),
          publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'pendingOperations',
            args: [USDC_ASSET_APPROVAL_OPERATION_ID],
          }),
        ]),
      );
      if (delay !== APPROVAL_TIMELOCK_DELAY) throw new Error('Core timelock delay is not the required two days.');
      const operations = [
        {
          operationId: STEAKHOUSE_PROTOCOL_APPROVAL_OPERATION_ID,
          approval: 'protocol' as const,
          operation: mapPendingOperation(protocolOperation),
        },
        {
          operationId: USDC_ASSET_APPROVAL_OPERATION_ID,
          approval: 'asset' as const,
          operation: mapPendingOperation(assetOperation),
        },
      ].flatMap(({ operationId, approval, operation }) => {
        if (operation.eta === 0n) return [];
        if (!matchesApprovalOperationPayload(approval, operation)) {
          throw new Error(`Pending ${approval === 'protocol' ? 'Protocol' : 'USDC Asset'} Approval operation does not match the approved subject and caps.`);
        }
        return [{ operationId, approval, eta: operation.eta }];
      });
      return {
        executorRole,
        now: block.timestamp,
        operations,
      };
    },
  });

  const execute = async (pending: ScheduledApproval) => {
    if (!publicClient || !address) return;
    setExecutingOperation(pending.operationId);
    setStatus(null);
    setError(null);
    try {
      const result = await executeScheduledApproval(pending.approval, pending.operationId, address, {
        getChainId: () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.getChainId()),
        hasExecutorRole: (account) => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [TIMELOCK_EXECUTOR_ROLE, account],
        })),
        readTimelockDelay: () => withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'TIMELOCK_DELAY',
        })),
        readCurrentTimestamp: async () => withVerifiedArcMainnetPublicClient(publicClient, async () => (
          (await publicClient.getBlock()).timestamp
        )),
        readPendingOperation: async (operationId) => mapPendingOperation(await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'pendingOperations',
          args: [operationId],
        }))),
        submit: (approval, operationId) => approval === 'protocol'
          ? writeContractAsync({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'executeProtocolApproval',
            args: [operationId],
            chainId: ARC_MAINNET_CHAIN_ID,
          })
          : writeContractAsync({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'executeAssetApproval',
            args: [operationId],
            chainId: ARC_MAINNET_CHAIN_ID,
          }),
        waitForReceipt: (hash) => withVerifiedArcMainnetPublicClient(publicClient, async () => {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          return { status: receipt.status, blockNumber: receipt.blockNumber };
        }),
        readProtocolCaps: async () => {
          const caps = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'protocolCaps',
            args: [STEAKHOUSE_PROTOCOL_ID],
          }));
          return { absoluteCap: caps[0], relativeCapBps: caps[1], approved: caps[2], enabled: caps[3] };
        },
        readAssetCaps: async () => {
          const caps = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'assetCaps',
            args: [ARC_USDC_CONTRACT_ADDRESS],
          }));
          return { absoluteCap: caps[0], relativeCapBps: caps[1], approved: caps[2], enabled: caps[3] };
        },
      });
      setStatus(`${pending.approval === 'protocol' ? 'Protocol' : 'USDC Asset'} Approval executed and verified: ${result.hash}, block ${result.blockNumber}.`);
      setConfirmation(null);
      await operationsQuery.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Approval execution failed.');
    } finally {
      setExecutingOperation(null);
    }
  };

  if (!isConnected || !isArcMainnet || !address) return null;
  const readiness = operationsQuery.data;
  return (
    <section className="vx-section" aria-labelledby="approval-execution-readiness-title">
      <h2 id="approval-execution-readiness-title">Protocol and USDC Approval Execution Readiness</h2>
      <p>Execution is manual only; operations are never executed automatically.</p>
      {operationsQuery.isFetching && <p role="status">Checking live executor role, pending approvals, and timelock...</p>}
      {operationsQuery.error && <p role="alert">{operationsQuery.error.message}</p>}
      {readiness && !readiness.executorRole && (
        <p role="status">BLOCKED: connected wallet does not have TIMELOCK_EXECUTOR_ROLE on the live Core.</p>
      )}
      {readiness?.executorRole && readiness.operations.length === 0 && (
        <p role="status">No pending Protocol or USDC Asset Approval operation was found.</p>
      )}
      {readiness?.operations.map((pending) => {
        const elapsed = readiness.now >= pending.eta;
        return (
          <article key={pending.operationId} className="vx-step-callout info" style={{ marginBottom: '0.75rem' }}>
            <div><strong>Approval:</strong> {pending.approval === 'protocol' ? 'Protocol' : 'USDC Asset'}</div>
            <div><strong>Operation ID:</strong> <code>{pending.operationId}</code></div>
            <div><strong>ETA:</strong> {pending.eta.toString()}</div>
            {!elapsed && <p role="status">BLOCKED: two-day timelock has not elapsed.</p>}
            {readiness.executorRole && elapsed && (
              <button
                type="button"
                className="vx-btn vx-btn-primary"
                disabled={isPending || executingOperation !== null || operationsQuery.isFetching}
                onClick={() => { setError(null); setConfirmation(pending); }}
              >
                Review {pending.approval === 'protocol' ? 'Protocol' : 'USDC Asset'} Approval Execution
              </button>
            )}
          </article>
        );
      })}
      {confirmation && (
        <div className="vx-step-callout warning" role="group" aria-label="Confirm approval execution">
          <p>
            Explicitly confirm execution of the {confirmation.approval === 'protocol' ? 'Protocol' : 'USDC Asset'} Approval
            {' '}operation <code>{confirmation.operationId}</code>. This requires the TIMELOCK_EXECUTOR wallet and an elapsed two-day timelock.
          </p>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            disabled={isPending || executingOperation !== null}
            onClick={() => { void execute(confirmation); }}
          >
            {executingOperation === confirmation.operationId ? 'Waiting for wallet and receipt...' : 'Confirm Execute Approval'}
          </button>
          <button type="button" className="vx-btn" disabled={executingOperation !== null} onClick={() => setConfirmation(null)}>Cancel</button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
