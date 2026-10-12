import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import { usePublicClient, useWriteContract } from 'wagmi';

import { useWalletStatus } from '../../../hooks/useWalletStatus';
import {
  POLICY_ADMIN_ROLE,
  TIMELOCK_EXECUTOR_ROLE,
  veloxTreasuryAbi,
} from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import { STEAKHOUSE_CORE_ADDRESS, STEAKHOUSE_PROTOCOL_ID } from '../services/protocolVaultMapping';
import {
  executeScheduledStrategyApproval,
  STEAKHOUSE_STRATEGY_ADDRESS,
  STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID,
  strategyApprovalExecutionBlockers,
  STRATEGY_APPROVAL_OPERATION_KIND,
  type ApprovalPendingOperation,
  type StrategyApprovalExecutionState,
} from '../services/strategyApprovalReadiness';

const adapterAbi = [
  { type: 'function', name: 'protocol', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'vault', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'currentValue', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

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

export function StrategyApprovalExecutionReadiness() {
  const { address, isConnected, isArcMainnet } = useWalletStatus();
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const { writeContractAsync, isPending } = useWriteContract();
  const [confirmation, setConfirmation] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readinessQuery = useQuery({
    queryKey: ['strategy-approval-execution-readiness', address?.toLowerCase() ?? null],
    enabled: Boolean(isConnected && isArcMainnet && address && publicClient),
    staleTime: 5_000,
    retry: false,
    queryFn: async (): Promise<StrategyApprovalExecutionState> => {
      if (!publicClient || !address) throw new Error('Arc Mainnet wallet or public client is unavailable.');
      const initial = await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
        publicClient.getChainId(),
        publicClient.getBlock(),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [POLICY_ADMIN_ROLE, address],
        }),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'hasRole',
          args: [TIMELOCK_EXECUTOR_ROLE, address],
        }),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'paused',
        }),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'pendingOperations',
          args: [STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID],
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
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'usdc',
        }),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'protocolVaults',
          args: [STEAKHOUSE_PROTOCOL_ID],
        }),
        publicClient.getBytecode({ address: STEAKHOUSE_STRATEGY_ADDRESS }),
        publicClient.readContract({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'strategies',
          args: [STEAKHOUSE_STRATEGY_ADDRESS],
        }),
      ]));
      const operation = mapPendingOperation(initial[5]);
      const adapterHasCode = Boolean(initial[10] && initial[10] !== '0x');
      const adapterState = adapterHasCode
        ? await withVerifiedArcMainnetPublicClient(publicClient, () => Promise.all([
          publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterAbi, functionName: 'protocol' }),
          publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterAbi, functionName: 'asset' }),
          publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterAbi, functionName: 'vault' }),
          publicClient.readContract({ address: STEAKHOUSE_STRATEGY_ADDRESS, abi: adapterAbi, functionName: 'currentValue' }),
        ]))
        : [zeroHash, zeroAddress, zeroAddress, 0n] as const;
      const strategy = initial[11];
      return {
        chainId: initial[0],
        coreAddress: STEAKHOUSE_CORE_ADDRESS,
        policyAdminRole: initial[2],
        executorRole: initial[3],
        paused: initial[4],
        now: initial[1].timestamp,
        operation,
        adapterHasCode,
        adapterProtocol: adapterState[0],
        adapterAsset: adapterState[1],
        adapterVault: adapterState[2],
        coreUSDC: initial[8],
        coreProtocolVault: initial[9],
        protocolApproval: { approved: initial[6][2], enabled: initial[6][3] },
        assetApproval: { approved: initial[7][2], enabled: initial[7][3] },
        strategyShares: strategy[5],
        strategyPosition: strategy[6],
        adapterCurrentValue: adapterState[3],
        strategyApproved: strategy[14],
        strategyEnabled: strategy[15],
      };
    },
  });

  const state = readinessQuery.data;
  const strategyAlreadyActive = Boolean(state?.strategyApproved && state.strategyEnabled);
  const blockers = state ? strategyApprovalExecutionBlockers(state) : [];

  const execute = async () => {
    if (!publicClient || !address) return;
    setExecuting(true);
    setError(null);
    setStatus(null);
    try {
      const result = await executeScheduledStrategyApproval({
        readState: async () => {
          const refreshed = await readinessQuery.refetch();
          if (!refreshed.data) throw new Error('Strategy Approval execution checks could not be verified.');
          return refreshed.data;
        },
        submit: (operationId) => writeContractAsync({
          address: STEAKHOUSE_CORE_ADDRESS,
          abi: veloxTreasuryAbi,
          functionName: 'executeStrategyApproval',
          args: [operationId],
          chainId: ARC_MAINNET_CHAIN_ID,
        }),
        waitForReceipt: async (hash) => {
          const receipt = await withVerifiedArcMainnetPublicClient(publicClient, () => (
            publicClient.waitForTransactionReceipt({ hash })
          ));
          return { status: receipt.status, blockNumber: receipt.blockNumber };
        },
        readStrategy: async () => {
          const strategy = await withVerifiedArcMainnetPublicClient(publicClient, () => publicClient.readContract({
            address: STEAKHOUSE_CORE_ADDRESS,
            abi: veloxTreasuryAbi,
            functionName: 'strategies',
            args: [STEAKHOUSE_STRATEGY_ADDRESS],
          }));
          return {
            protocol: strategy[0],
            asset: strategy[1],
            absoluteCap: strategy[2],
            relativeCapBps: strategy[3],
            approved: strategy[14],
            enabled: strategy[15],
          };
        },
      });
      setStatus(`Strategy Approval executed and verified: ${result.hash}, block ${result.blockNumber}.`);
      setConfirmation(false);
      await readinessQuery.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Strategy Approval execution failed.');
    } finally {
      setExecuting(false);
    }
  };

  if (!isConnected || !isArcMainnet || !address) return null;

  return (
    <section className="vx-section" aria-labelledby="strategy-approval-execution-title">
      <h2 id="strategy-approval-execution-title">Strategy Approval Execution Readiness</h2>
      <p>Execution is manual only. POLICY_ADMIN_ROLE allows scheduling; execution requires TIMELOCK_EXECUTOR_ROLE.</p>
      <div><strong>Operation ID:</strong> <code>{STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID}</code></div>
      {readinessQuery.isFetching && <p role="status">Checking executor role, pending operation, timelock, and execution prerequisites...</p>}
      {readinessQuery.error && <p role="alert">{readinessQuery.error.message}</p>}
      {state && (
        <>
          {strategyAlreadyActive ? (
            <p role="status">Strategy Approval is already executed; Core confirms the strategy is approved and enabled. No execution is needed.</p>
          ) : (
            <>
              <div><strong>ETA:</strong> {state.operation.eta === 0n ? 'Not pending' : new Date(Number(state.operation.eta) * 1000).toISOString()}</div>
              {blockers.length > 0 && (
                <div className="vx-step-callout warning" role="status">
                  <strong>BLOCKED: Strategy Approval cannot be executed.</strong>
                  <ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </>
      )}
      <button
        type="button"
        className="vx-btn vx-btn-primary"
        disabled={!state || strategyAlreadyActive || blockers.length > 0 || isPending || executing || readinessQuery.isFetching}
        onClick={() => { setError(null); setConfirmation(true); }}
      >
        Review Strategy Approval Execution
      </button>
      {confirmation && !strategyAlreadyActive && blockers.length === 0 && (
        <div className="vx-step-callout warning" role="group" aria-label="Confirm Strategy Approval execution">
          <p>
            Confirm execution only for <code>{STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID}</code> using
            {' '}executeStrategyApproval(operationId). This requires the connected TIMELOCK_EXECUTOR wallet.
          </p>
          <button
            type="button"
            className="vx-btn vx-btn-primary"
            disabled={isPending || executing}
            onClick={() => { void execute(); }}
          >
            {executing ? 'Waiting for wallet and receipt...' : 'Confirm Execute Strategy Approval'}
          </button>
          <button type="button" className="vx-btn" disabled={executing} onClick={() => setConfirmation(false)}>Cancel</button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
