import { zeroAddress, type Address, type Hash, type Hex } from 'viem';

import { ARC_USDC_CONTRACT_ADDRESS, ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import {
  APPROVAL_ABSOLUTE_CAP,
  APPROVAL_RELATIVE_CAP_BPS,
} from './approvalScheduling';
import {
  STEAKHOUSE_CORE_ADDRESS,
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from './protocolVaultMapping';

export const STEAKHOUSE_STRATEGY_ADDRESS: Address = '0x915E6ff43b4a0A8681bB7F646047873771D5798c';
export const APPROVAL_TIMELOCK_DELAY = 2n * 24n * 60n * 60n;
export const PROTOCOL_APPROVAL_OPERATION_KIND = 1;
export const ASSET_APPROVAL_OPERATION_KIND = 2;
export const STRATEGY_APPROVAL_OPERATION_KIND = 3;
export const STEAKHOUSE_PROTOCOL_APPROVAL_OPERATION_ID: Hex =
  '0x7f82eff90f6843cc282af03f5864702525031886ba889fce8f92cf5c91a3eca0';
export const USDC_ASSET_APPROVAL_OPERATION_ID: Hex =
  '0x20043f8d08bc22d107d81628e23c5f42a98128978a4cd5266b18bb15863a4b91';
export const STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID: Hex =
  '0x9e1cca778e44253db831f694f4ed3dff2c2ecfb5b04ba15f0993f1521166fb19';

export type StrategyApprovalPreflight = {
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly policyAdminRole: boolean;
  readonly adapterHasCode: boolean;
  readonly adapterProtocol: Hex;
  readonly adapterAsset: Address;
  readonly adapterVault: Address;
  readonly coreProtocolVault: Address;
  readonly coreUSDC: Address;
  readonly protocolApproval: { readonly approved: boolean; readonly enabled: boolean };
  readonly assetApproval: { readonly approved: boolean; readonly enabled: boolean };
  readonly strategyApproval: { readonly approved: boolean; readonly enabled: boolean };
  readonly paused: boolean;
};

export function strategyApprovalBlockers(
  state: StrategyApprovalPreflight,
): readonly string[] {
  const blockers: string[] = [];
  if (state.chainId !== ARC_MAINNET_CHAIN_ID) blockers.push('Connected RPC is not Arc Mainnet (5042).');
  if (state.coreAddress.toLowerCase() !== STEAKHOUSE_CORE_ADDRESS.toLowerCase()) blockers.push('Connected Core is not the configured live Core.');
  if (!state.policyAdminRole) blockers.push('Connected wallet does not have POLICY_ADMIN_ROLE on the live Core.');
  if (!state.adapterHasCode) blockers.push('Configured strategy adapter has no deployed bytecode.');
  if (state.adapterProtocol.toLowerCase() !== STEAKHOUSE_PROTOCOL_ID.toLowerCase()) blockers.push('Adapter protocol does not match the configured protocol ID.');
  if (state.adapterAsset.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) blockers.push('Adapter asset does not match Arc USDC.');
  if (state.adapterVault.toLowerCase() !== STEAKHOUSE_VAULT_ADDRESS.toLowerCase()) blockers.push('Adapter vault does not match the configured Steakhouse vault.');
  if (state.coreProtocolVault.toLowerCase() !== STEAKHOUSE_VAULT_ADDRESS.toLowerCase()) blockers.push('Core protocolVaults mapping does not match the configured Steakhouse vault.');
  if (state.coreUSDC.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) blockers.push('Core USDC does not match Arc USDC.');
  if (!state.protocolApproval.approved || !state.protocolApproval.enabled) {
    blockers.push('Protocol Approval is BLOCKED until its scheduled operation is executable and has been executed (Core protocolCaps must be approved and enabled).');
  }
  if (!state.assetApproval.approved || !state.assetApproval.enabled) {
    blockers.push('USDC Asset Approval is BLOCKED until its scheduled operation is executable and has been executed (Core assetCaps must be approved and enabled).');
  }
  if (state.paused) blockers.push('Core is paused.');
  return blockers;
}

export type ApprovalPendingOperation = {
  readonly kind: number;
  readonly eta: bigint;
  readonly subject: Address;
  readonly secondary: Hex;
  readonly tertiary: Address;
  readonly value1: bigint;
  readonly value2: bigint;
  readonly bps: number;
  readonly bps2: number;
  readonly bps3: number;
  readonly bps4: number;
};

export type ApprovalExecutionKind = 'protocol' | 'asset';

export function matchesApprovalOperationPayload(
  approval: ApprovalExecutionKind,
  operation: ApprovalPendingOperation,
): boolean {
  const isProtocol = approval === 'protocol';
  const expectedKind = isProtocol ? PROTOCOL_APPROVAL_OPERATION_KIND : ASSET_APPROVAL_OPERATION_KIND;
  const expectedSubject = isProtocol ? '0x0000000000000000000000000000000000000000' : ARC_USDC_CONTRACT_ADDRESS;
  const expectedSecondary = isProtocol ? STEAKHOUSE_PROTOCOL_ID : `0x${'0'.repeat(64)}`;
  return operation.kind === expectedKind
    && operation.subject.toLowerCase() === expectedSubject.toLowerCase()
    && operation.secondary.toLowerCase() === expectedSecondary.toLowerCase()
    && operation.tertiary.toLowerCase() === zeroAddress
    && operation.value1 === APPROVAL_ABSOLUTE_CAP
    && operation.value2 === 0n
    && operation.bps === APPROVAL_RELATIVE_CAP_BPS
    && operation.bps2 === 0
    && operation.bps3 === 0
    && operation.bps4 === 0;
}

export function assertApprovalExecutionReady(input: {
  readonly chainId: number;
  readonly executorRole: boolean;
  readonly timelockDelay: bigint;
  readonly now: bigint;
  readonly approval: ApprovalExecutionKind;
  readonly operation: ApprovalPendingOperation;
}): void {
  if (input.chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('Approval execution requires Arc Mainnet (chain ID 5042).');
  }
  if (!input.executorRole) {
    throw new Error('Connected wallet does not have TIMELOCK_EXECUTOR_ROLE on the current Core.');
  }
  if (input.timelockDelay !== APPROVAL_TIMELOCK_DELAY) {
    throw new Error('Core timelock delay is not the required two days.');
  }
  if (input.operation.eta === 0n) throw new Error('Approval operation is no longer pending.');
  if (input.operation.eta > input.now) throw new Error('Approval timelock has not elapsed.');

  if (!matchesApprovalOperationPayload(input.approval, input.operation)) {
    throw new Error('Pending approval operation does not match the expected subject and approved caps.');
  }
}

export function verifyApprovalExecutionReadback(input: {
  readonly approval: ApprovalExecutionKind;
  readonly absoluteCap: bigint;
  readonly relativeCapBps: number;
  readonly approved: boolean;
  readonly enabled: boolean;
}): void {
  if (
    !input.approved
    || !input.enabled
    || input.absoluteCap !== APPROVAL_ABSOLUTE_CAP
    || input.relativeCapBps !== APPROVAL_RELATIVE_CAP_BPS
  ) {
    throw new Error(`${input.approval === 'protocol' ? 'Protocol' : 'USDC asset'} approval readback did not match the executed operation.`);
  }
}

export type StrategyApprovalSchedulingPorts = {
  readonly preflight: () => Promise<StrategyApprovalPreflight>;
  readonly submit: (strategy: Address, protocol: Hex, asset: Address, absoluteCap: bigint, relativeCapBps: number) => Promise<Hash>;
  readonly waitForReceipt: (hash: Hash) => Promise<{
    readonly status: 'success' | 'reverted';
    readonly blockNumber: bigint;
    readonly operationId: Hex;
    readonly scheduledEta: bigint;
  }>;
  readonly readPendingOperation: (operationId: Hex) => Promise<ApprovalPendingOperation>;
};

export async function scheduleSteakhouseStrategyApproval(
  ports: StrategyApprovalSchedulingPorts,
): Promise<{ readonly hash: Hash; readonly blockNumber: bigint; readonly operationId: Hex; readonly eta: bigint }> {
  const state = await ports.preflight();
  const blockers = strategyApprovalBlockers(state);
  if (blockers.length > 0) throw new Error(blockers.join(' '));

  const hash = await ports.submit(
    STEAKHOUSE_STRATEGY_ADDRESS,
    STEAKHOUSE_PROTOCOL_ID,
    ARC_USDC_CONTRACT_ADDRESS,
    APPROVAL_ABSOLUTE_CAP,
    APPROVAL_RELATIVE_CAP_BPS,
  );
  const receipt = await ports.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error('Strategy Approval schedule failed or was reverted.');
  if (!/^0x[\da-fA-F]{64}$/.test(receipt.operationId)) {
    throw new Error('Core receipt did not contain a valid TimelockScheduled operation ID.');
  }

  const operation = await ports.readPendingOperation(receipt.operationId);
  if (
    operation.kind !== STRATEGY_APPROVAL_OPERATION_KIND
    || operation.eta <= 0n
    || operation.eta !== receipt.scheduledEta
    || operation.subject.toLowerCase() !== STEAKHOUSE_STRATEGY_ADDRESS.toLowerCase()
    || operation.secondary.toLowerCase() !== STEAKHOUSE_PROTOCOL_ID.toLowerCase()
    || operation.tertiary.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()
    || operation.value1 !== APPROVAL_ABSOLUTE_CAP
    || operation.value2 !== 0n
    || operation.bps !== APPROVAL_RELATIVE_CAP_BPS
    || operation.bps2 !== 0
    || operation.bps3 !== 0
    || operation.bps4 !== 0
  ) {
    throw new Error('Core pending-operation readback does not match the requested Strategy Approval schedule.');
  }
  return { hash, blockNumber: receipt.blockNumber, operationId: receipt.operationId, eta: operation.eta };
}

export type ApprovalExecutionPorts = {
  readonly getChainId: () => Promise<number>;
  readonly hasExecutorRole: (account: Address) => Promise<boolean>;
  readonly readTimelockDelay: () => Promise<bigint>;
  readonly readCurrentTimestamp: () => Promise<bigint>;
  readonly readPendingOperation: (operationId: Hex) => Promise<ApprovalPendingOperation>;
  readonly submit: (approval: ApprovalExecutionKind, operationId: Hex) => Promise<Hash>;
  readonly waitForReceipt: (hash: Hash) => Promise<{ readonly status: 'success'; readonly blockNumber: bigint } | { readonly status: 'reverted'; readonly blockNumber: bigint }>;
  readonly readProtocolCaps: () => Promise<{ readonly absoluteCap: bigint; readonly relativeCapBps: number; readonly approved: boolean; readonly enabled: boolean }>;
  readonly readAssetCaps: () => Promise<{ readonly absoluteCap: bigint; readonly relativeCapBps: number; readonly approved: boolean; readonly enabled: boolean }>;
};

export async function executeScheduledApproval(
  approval: ApprovalExecutionKind,
  operationId: Hex,
  account: Address,
  ports: ApprovalExecutionPorts,
): Promise<{ readonly hash: Hash; readonly blockNumber: bigint }> {
  const [chainId, executorRole, timelockDelay, now, operation] = await Promise.all([
    ports.getChainId(),
    ports.hasExecutorRole(account),
    ports.readTimelockDelay(),
    ports.readCurrentTimestamp(),
    ports.readPendingOperation(operationId),
  ]);
  assertApprovalExecutionReady({ chainId, executorRole, timelockDelay, now, approval, operation });

  const hash = await ports.submit(approval, operationId);
  const receipt = await ports.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error(`${approval} approval execution failed or was reverted.`);

  if (approval === 'protocol') {
    const caps = await ports.readProtocolCaps();
    verifyApprovalExecutionReadback({ approval, ...caps });
  } else {
    const caps = await ports.readAssetCaps();
    verifyApprovalExecutionReadback({ approval, ...caps });
  }
  return { hash, blockNumber: receipt.blockNumber };
}

export type StrategyApprovalExecutionState = {
  readonly chainId: number;
  readonly coreAddress: Address;
  readonly policyAdminRole: boolean;
  readonly executorRole: boolean;
  readonly paused: boolean;
  readonly now: bigint;
  readonly operation: ApprovalPendingOperation;
  readonly adapterHasCode: boolean;
  readonly adapterProtocol: Hex;
  readonly adapterAsset: Address;
  readonly adapterVault: Address;
  readonly coreUSDC: Address;
  readonly coreProtocolVault: Address;
  readonly protocolApproval: { readonly approved: boolean; readonly enabled: boolean };
  readonly assetApproval: { readonly approved: boolean; readonly enabled: boolean };
  readonly strategyShares: bigint;
  readonly strategyPosition: bigint;
  readonly adapterCurrentValue: bigint;
  readonly strategyApproved: boolean;
  readonly strategyEnabled: boolean;
};

export function strategyApprovalExecutionBlockers(
  state: StrategyApprovalExecutionState,
): readonly string[] {
  const blockers: string[] = [];
  if (state.chainId !== ARC_MAINNET_CHAIN_ID) blockers.push('Connected RPC is not Arc Mainnet (5042).');
  if (state.coreAddress.toLowerCase() !== STEAKHOUSE_CORE_ADDRESS.toLowerCase()) blockers.push('Connected Core is not the configured live Core.');

  if (!state.adapterHasCode) blockers.push('Configured strategy adapter has no deployed bytecode.');
  if (state.coreUSDC.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) blockers.push('Core USDC does not match Arc USDC.');
  if (state.adapterProtocol.toLowerCase() !== STEAKHOUSE_PROTOCOL_ID.toLowerCase()) blockers.push('Adapter protocol does not match the configured protocol ID.');
  if (state.adapterAsset.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) blockers.push('Adapter asset does not match Arc USDC.');
  if (state.adapterVault.toLowerCase() !== state.coreProtocolVault.toLowerCase()) blockers.push('Adapter vault does not match the Core protocol-vault mapping.');

  if (state.strategyApproved && state.strategyEnabled) return blockers;

  if (!state.executorRole) {
    blockers.push(state.policyAdminRole
      ? 'Connected wallet has POLICY_ADMIN_ROLE for scheduling, but execution requires TIMELOCK_EXECUTOR_ROLE.'
      : 'Connected wallet does not have TIMELOCK_EXECUTOR_ROLE on the live Core.');
  }
  if (state.paused) blockers.push('Core is paused.');

  const { operation } = state;
  if (operation.eta === 0n) {
    blockers.push('Strategy Approval operation is no longer pending.');
  } else {
    if (operation.kind !== STRATEGY_APPROVAL_OPERATION_KIND) blockers.push('Pending operation is not a Strategy Approval.');
    if (operation.eta > state.now) blockers.push('Strategy Approval timelock has not elapsed.');
    if (operation.subject.toLowerCase() !== STEAKHOUSE_STRATEGY_ADDRESS.toLowerCase()) blockers.push('Pending operation strategy does not match the configured adapter.');
    if (operation.secondary.toLowerCase() !== STEAKHOUSE_PROTOCOL_ID.toLowerCase()) blockers.push('Pending operation protocol does not match the configured protocol.');
    if (operation.tertiary.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) blockers.push('Pending operation asset does not match Arc USDC.');
    if (
      operation.value1 !== APPROVAL_ABSOLUTE_CAP
      || operation.value2 !== 0n
      || operation.bps !== APPROVAL_RELATIVE_CAP_BPS
      || operation.bps2 !== 0
      || operation.bps3 !== 0
      || operation.bps4 !== 0
    ) blockers.push('Pending Strategy Approval cap values do not match the approved values.');
  }

  if (operation.eta !== 0n) {
    if (state.adapterProtocol.toLowerCase() !== operation.secondary.toLowerCase()) blockers.push('Adapter protocol does not match the pending operation.');
    if (state.adapterAsset.toLowerCase() !== operation.tertiary.toLowerCase()) blockers.push('Adapter asset does not match the pending operation.');
  }
  if (!state.protocolApproval.approved || !state.protocolApproval.enabled) blockers.push('Protocol approval must be approved and enabled before Strategy Approval execution.');
  if (!state.assetApproval.approved || !state.assetApproval.enabled) blockers.push('Asset approval must be approved and enabled before Strategy Approval execution.');
  if (state.strategyShares !== 0n || state.strategyPosition !== 0n || state.adapterCurrentValue !== 0n) {
    blockers.push('Strategy must be inactive: shares, position, and adapter current value must all be zero.');
  }
  return blockers;
}

export type StrategyApprovalExecutionPorts = {
  readonly readState: () => Promise<StrategyApprovalExecutionState>;
  readonly submit: (operationId: Hex) => Promise<Hash>;
  readonly waitForReceipt: (hash: Hash) => Promise<{
    readonly status: 'success' | 'reverted';
    readonly blockNumber: bigint;
  }>;
  readonly readStrategy: () => Promise<{
    readonly protocol: Hex;
    readonly asset: Address;
    readonly absoluteCap: bigint;
    readonly relativeCapBps: number;
    readonly approved: boolean;
    readonly enabled: boolean;
  }>;
};

export async function executeScheduledStrategyApproval(
  ports: StrategyApprovalExecutionPorts,
): Promise<{ readonly hash: Hash; readonly blockNumber: bigint }> {
  const state = await ports.readState();
  const blockers = strategyApprovalExecutionBlockers(state);
  if (blockers.length > 0) throw new Error(blockers.join(' '));

  const hash = await ports.submit(STEAKHOUSE_STRATEGY_APPROVAL_OPERATION_ID);
  const receipt = await ports.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error('Strategy Approval execution failed or was reverted.');

  const strategy = await ports.readStrategy();
  if (
    strategy.protocol.toLowerCase() !== STEAKHOUSE_PROTOCOL_ID.toLowerCase()
    || strategy.asset.toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()
    || strategy.absoluteCap !== APPROVAL_ABSOLUTE_CAP
    || strategy.relativeCapBps !== APPROVAL_RELATIVE_CAP_BPS
    || !strategy.approved
    || !strategy.enabled
  ) {
    throw new Error('Strategy Approval readback did not match the executed operation.');
  }
  return { hash, blockNumber: receipt.blockNumber };
}
