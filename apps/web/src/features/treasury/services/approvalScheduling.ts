import { zeroAddress, type Address, type Hash, type Hex } from 'viem';

import { ARC_USDC_CONTRACT_ADDRESS, ARC_MAINNET_CHAIN_ID } from '../../../contracts/usdc';
import {
  STEAKHOUSE_CORE_ADDRESS,
  STEAKHOUSE_PROTOCOL_ID,
  STEAKHOUSE_VAULT_ADDRESS,
} from './protocolVaultMapping';

export const APPROVAL_ABSOLUTE_CAP = 750_000_000_000n;
export const APPROVAL_RELATIVE_CAP_BPS = 1_500;

export type ApprovalPendingOperation = {
  readonly kind: number;
  readonly eta: bigint;
  readonly subject: Address;
  readonly secondary: Hex;
  readonly value1: bigint;
  readonly value2: bigint;
  readonly bps: number;
  readonly bps2: number;
  readonly bps3: number;
  readonly bps4: number;
};

export type ApprovalSchedulingPorts = {
  readonly chainId: number;
  readonly accountAddress: Address;
  readonly readPolicyAdminRole: (account: Address) => Promise<boolean>;
  readonly readProtocolVault: () => Promise<Address>;
  readonly readCoreUSDC: () => Promise<Address>;
  readonly readPaused: () => Promise<boolean>;
  readonly submitProtocol: (protocol: Hex, absoluteCap: bigint, relativeCapBps: number) => Promise<Hash>;
  readonly submitAsset: (asset: Address, absoluteCap: bigint, relativeCapBps: number) => Promise<Hash>;
  readonly waitForReceipt: (hash: Hash) => Promise<{
    readonly status: 'success' | 'reverted';
    readonly blockNumber: bigint;
    readonly operationId: Hex;
    readonly scheduledEta: bigint;
  }>;
  readonly readPendingOperation: (operationId: Hex) => Promise<ApprovalPendingOperation>;
};

export type ApprovalScheduleResult = {
  readonly hash: Hash;
  readonly blockNumber: bigint;
  readonly operationId: Hex;
  readonly eta: bigint;
};

async function scheduleApproval(
  approval: 'protocol' | 'asset',
  ports: ApprovalSchedulingPorts,
): Promise<ApprovalScheduleResult> {
  if (ports.chainId !== ARC_MAINNET_CHAIN_ID) {
    throw new Error('Approval scheduling requires Arc Mainnet (chain ID 5042).');
  }
  if (!await ports.readPolicyAdminRole(ports.accountAddress)) {
    throw new Error('Connected wallet does not have POLICY_ADMIN_ROLE on the current Core.');
  }
  if ((await ports.readProtocolVault()).toLowerCase() !== STEAKHOUSE_VAULT_ADDRESS.toLowerCase()) {
    throw new Error('Protocol is not mapped to the expected Steakhouse Vault on the current Core.');
  }
  if ((await ports.readCoreUSDC()).toLowerCase() !== ARC_USDC_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error('Current Core USDC does not match the approved Arc USDC address.');
  }
  if (await ports.readPaused()) {
    throw new Error('Current Core is paused; approval scheduling is unavailable.');
  }

  const hash = approval === 'protocol'
    ? await ports.submitProtocol(STEAKHOUSE_PROTOCOL_ID, APPROVAL_ABSOLUTE_CAP, APPROVAL_RELATIVE_CAP_BPS)
    : await ports.submitAsset(ARC_USDC_CONTRACT_ADDRESS, APPROVAL_ABSOLUTE_CAP, APPROVAL_RELATIVE_CAP_BPS);
  const receipt = await ports.waitForReceipt(hash);
  if (receipt.status !== 'success') {
    throw new Error(`${approval === 'protocol' ? 'Protocol' : 'Asset'} approval schedule failed or was reverted.`);
  }
  if (!/^0x[\da-fA-F]{64}$/.test(receipt.operationId)) {
    throw new Error('Core receipt did not contain a valid TimelockScheduled operation ID.');
  }

  const operation = await ports.readPendingOperation(receipt.operationId);
  const expectedKind = approval === 'protocol' ? 1 : 2;
  const expectedSubject = approval === 'protocol' ? zeroAddress : ARC_USDC_CONTRACT_ADDRESS;
  const expectedSecondary = approval === 'protocol' ? STEAKHOUSE_PROTOCOL_ID : `0x${'0'.repeat(64)}`;
  if (
    operation.kind !== expectedKind
    || operation.eta <= 0n
    || operation.eta !== receipt.scheduledEta
    || operation.subject.toLowerCase() !== expectedSubject.toLowerCase()
    || operation.secondary.toLowerCase() !== expectedSecondary.toLowerCase()
    || operation.value1 !== APPROVAL_ABSOLUTE_CAP
    || operation.value2 !== 0n
    || operation.bps !== APPROVAL_RELATIVE_CAP_BPS
    || operation.bps2 !== 0
    || operation.bps3 !== 0
    || operation.bps4 !== 0
  ) {
    throw new Error('Core pending-operation readback does not match the requested approval schedule.');
  }

  return {
    hash,
    blockNumber: receipt.blockNumber,
    operationId: receipt.operationId,
    eta: operation.eta,
  };
}

export function scheduleSteakhouseProtocolApproval(
  ports: ApprovalSchedulingPorts,
): Promise<ApprovalScheduleResult> {
  return scheduleApproval('protocol', ports);
}

export function scheduleArcUsdcAssetApproval(
  ports: ApprovalSchedulingPorts,
): Promise<ApprovalScheduleResult> {
  return scheduleApproval('asset', ports);
}

export const APPROVAL_SCHEDULE_TARGETS = {
  core: STEAKHOUSE_CORE_ADDRESS,
  protocol: STEAKHOUSE_PROTOCOL_ID,
  asset: ARC_USDC_CONTRACT_ADDRESS,
} as const;
