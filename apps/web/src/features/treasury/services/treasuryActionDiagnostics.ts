import { withVerifiedArcMainnetPublicClient } from './arcMainnetPublicClient';

type TreasuryAction = 'Deposit' | 'Withdrawal';

export async function withTreasuryReadStage<T>(
  action: TreasuryAction,
  stage: string,
  client: Parameters<typeof withVerifiedArcMainnetPublicClient>[0],
  read: () => Promise<T>,
  transactionState: 'not-submitted' | 'submitted' | 'confirmed' = 'not-submitted',
): Promise<T> {
  try {
    return await withVerifiedArcMainnetPublicClient(client, read);
  } catch {
    const nextStep = transactionState === 'confirmed'
      ? 'The transaction receipt was confirmed, but the required state could not be verified.'
      : transactionState === 'submitted'
        ? 'A wallet transaction may already be submitted; check wallet activity before retrying.'
        : 'No wallet transaction was submitted.';
    throw new Error(
      `${action} ${stage} failed: Arc Mainnet chain ID 5042 or a required read could not be verified through the same-origin relay. ${nextStep}`,
    );
  }
}

function isWalletRejection(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & { code?: unknown; cause?: unknown };
    if (candidate.code === 4001
      || candidate.name === 'UserRejectedRequestError'
      || candidate.name === 'UserRejectedError'
      || /user rejected|user denied/i.test(candidate.message)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function isSimulationRevert(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /ContractFunctionExecutionError|ContractFunctionRevertedError|TransactionExecutionError/.test(error.name)
    || /execution reverted|simulation failed/i.test(error.message);
}

export function walletSubmissionError(action: TreasuryAction, stage: string, error: unknown): Error {
  if (isWalletRejection(error)) {
    return new Error(`${action} ${stage} was rejected by the wallet. No transaction was submitted.`);
  }
  if (isSimulationRevert(error)) {
    return new Error(`${action} ${stage} simulation reverted before wallet submission. No transaction was submitted.`);
  }
  return new Error(
    `${action} ${stage} could not be submitted by the wallet. No transaction hash was returned; check wallet activity before retrying.`,
  );
}

export function receiptWaitError(action: TreasuryAction, stage: string, hash: `0x${string}`): Error {
  return new Error(
    `${action} ${stage} could not be confirmed. Transaction hash: ${hash}. Check this transaction's status before retrying.`,
  );
}

export function isSafeTreasuryActionDiagnostic(message: string): boolean {
  return /^(?:Deposit|Withdrawal) (?:preflight\b|strategy preflight\b|strategy withdrawal preview\b|approval\b|USDC approval\b|transaction\b|receipt\b|post-receipt\b|balance refresh\b|balance readback\b)/i.test(message);
}
