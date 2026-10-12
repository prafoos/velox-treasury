export interface StrategyWithdrawalReadback {
  readonly requestedAmount: bigint;
  readonly preWithdrawalBalance: bigint;
  readonly eventAmount: bigint;
  readonly eventUserBalance: bigint;
  readonly actualUserBalance: bigint;
  readonly preUserStrategyShares: bigint;
  readonly postUserStrategyShares: bigint;
  readonly preUserStrategyPosition: bigint;
  readonly postUserStrategyPosition: bigint;
  readonly unwindShares: bigint;
  readonly preAggregateStrategyShares: bigint;
  readonly postAggregateStrategyShares: bigint;
  readonly preAggregateStrategyPosition: bigint;
  readonly postAggregateStrategyPosition: bigint;
  readonly preTotalDeployed: bigint;
  readonly postTotalDeployed: bigint;
}

export function verifyStrategyWithdrawalReadback(input: StrategyWithdrawalReadback): void {
  if (input.requestedAmount < input.preWithdrawalBalance && input.eventAmount !== input.requestedAmount) {
    throw new Error('Withdrawal event amount did not match the requested amount.');
  }
  if (input.actualUserBalance !== input.eventUserBalance) {
    throw new Error(`Treasury withdrawal Core balance readback mismatch: event ${input.eventUserBalance}, received ${input.actualUserBalance}`);
  }
  if (input.requestedAmount === input.preWithdrawalBalance && input.actualUserBalance !== 0n) {
    throw new Error('Full Treasury withdrawal did not clear the authoritative Core user balance.');
  }
  if (input.postAggregateStrategyShares !== input.preAggregateStrategyShares - input.unwindShares) {
    throw new Error('Aggregate strategy share readback did not match the executed unwind.');
  }
  if (input.preTotalDeployed < input.preAggregateStrategyPosition
    || input.postTotalDeployed !== input.preTotalDeployed - input.preAggregateStrategyPosition + input.postAggregateStrategyPosition) {
    throw new Error('Aggregate strategy position does not reconcile with Core totalDeployed.');
  }
  if (input.postUserStrategyShares > input.preUserStrategyShares
    || input.postUserStrategyPosition > input.preUserStrategyPosition
    || input.postUserStrategyShares > input.postAggregateStrategyShares) {
    throw new Error('User strategy share position increased inconsistently with the executed unwind.');
  }
  if (input.requestedAmount === input.preWithdrawalBalance
    && (input.postUserStrategyShares !== 0n || input.postUserStrategyPosition !== 0n)) {
    throw new Error('Full Treasury withdrawal did not clear the authoritative user strategy position.');
  }
}
