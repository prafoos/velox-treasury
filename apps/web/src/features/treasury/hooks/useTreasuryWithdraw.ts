import { useCallback, useState } from 'react';
import { decodeEventLog, isAddress, zeroAddress, type Address, type Hex } from 'viem';
import { getBlockNumber, getChainId, readContract } from 'viem/actions';
import { useConnectorClient, useWriteContract } from 'wagmi';

import { ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS, getArcMainnetTreasuryAddress, veloxTreasuryAbi } from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS } from '../../../contracts/usdc';
import { arcMainnetReadClient, withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import { buildImmediateWithdrawalCall } from '../services/withdrawalValidation';
import { confirmUserBalanceChange } from '../services/userBalanceReadback';
import { buildStrategyUnwindPlan } from '../services/strategyUnwindPlan';
import { verifyStrategyWithdrawalReadback } from '../services/strategyWithdrawalReadback';
import { isSafeTreasuryActionDiagnostic, receiptWaitError, walletSubmissionError, withTreasuryReadStage } from '../services/treasuryActionDiagnostics';
import { parseUSDC } from '../../usdc/services/usdcService';

const adapterPreviewRedeemAbi = [{
  type: 'function',
  name: 'previewRedeem',
  stateMutability: 'view',
  inputs: [{ name: 'shares', type: 'uint256' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

function readWithdrawalEvent(
  receipt: { readonly logs: readonly { readonly address: Address; readonly data: `0x${string}`; readonly topics: readonly `0x${string}`[] }[] },
  treasuryAddress: Address,
  walletAddress: string,
  recipient: string,
): { readonly amount: bigint; readonly userBalance: bigint } | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== treasuryAddress.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: veloxTreasuryAbi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (event.eventName === 'Withdrawal'
        && event.args.recipient?.toLowerCase() === recipient.toLowerCase()
        && event.args.user?.toLowerCase() === walletAddress.toLowerCase()) {
        return { amount: event.args.amount, userBalance: event.args.userBalance };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function useTreasuryWithdraw(
  walletAddress: string | undefined,
  isArcMainnet: boolean,
  onConfirmed: () => Promise<unknown>,
) {
  const treasuryAddress = getArcMainnetTreasuryAddress();
  const { data: client } = useConnectorClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canWithdraw = Boolean(treasuryAddress && walletAddress && isArcMainnet);

  const withdraw = useCallback(async (recipientInput: string, amountInput: string) => {
    if (!treasuryAddress) throw new Error('Treasury is not configured on Arc Mainnet');
    if (!walletAddress) throw new Error('Connect a wallet to withdraw your Treasury balance');
    if (!isArcMainnet) throw new Error('Withdrawals require Arc Mainnet (Chain ID 5042)');
    if (!client || await getChainId(client) !== ARC_MAINNET_CHAIN_ID) throw new Error('Withdrawals require Arc Mainnet (Chain ID 5042)');
    if (!isAddress(recipientInput) || recipientInput.toLowerCase() === zeroAddress) throw new Error('Enter a valid non-zero recipient address');
    if (recipientInput.toLowerCase() !== walletAddress.toLowerCase()) throw new Error('Withdrawal recipient must match the connected wallet');
    let amount: bigint;
    try { amount = parseUSDC(amountInput); } catch { throw new Error('Enter a valid USDC amount with up to 6 decimal places'); }
    if (amount <= 0n) throw new Error('Enter a USDC amount greater than zero');

    const { isPaused, userBalance, immediatelyWithdrawableValue, liquidUSDC, planningBlock } = await withTreasuryReadStage(
      'Withdrawal',
      'preflight',
      arcMainnetReadClient,
      async () => {
        const planningBlock = await getBlockNumber(arcMainnetReadClient);
        const [
          isPaused,
          userBalance,
          immediatelyWithdrawableValue,
          liquidUSDC,
        ] = await Promise.all([
          readContract(arcMainnetReadClient, {
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'paused',
            blockNumber: planningBlock,
          }),
          readContract(arcMainnetReadClient, {
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'userBalance',
            args: [walletAddress as Address],
            blockNumber: planningBlock,
          }),
          readContract(arcMainnetReadClient, {
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'immediatelyWithdrawableValue',
            args: [walletAddress as Address],
            blockNumber: planningBlock,
          }),
          readContract(arcMainnetReadClient, {
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'liquidUSDC',
            blockNumber: planningBlock,
          }),
        ]);
        return { isPaused, userBalance, immediatelyWithdrawableValue, liquidUSDC, planningBlock };
      },
    );
    let withdrawalCall:
      | { readonly functionName: 'withdraw'; readonly args: readonly [bigint, Address] }
      | { readonly functionName: 'withdrawWithDeallocation'; readonly args: readonly [bigint, Address, readonly Address[], readonly bigint[]] };
    let unwindShares = 0n;
    let beforeUserStrategyShares = 0n;
    let beforeUserStrategyPosition = 0n;
    let beforeStrategyShares = 0n;
    let beforeStrategyPosition = 0n;
    let beforeTotalDeployed = 0n;
    if (amount <= immediatelyWithdrawableValue) {
      withdrawalCall = buildImmediateWithdrawalCall({
        recipient: recipientInput,
        walletAddress,
        amount,
        userBalance,
        immediatelyWithdrawableValue,
        paused: isPaused,
      });
    } else {
      if (isPaused) throw new Error('Treasury withdrawals are paused.');
      if (amount > userBalance) throw new Error('Withdrawal exceeds your Treasury balance');
      if (amount <= liquidUSDC) {
        throw new Error('The requested amount is liquid but exceeds the current reserve-aware withdrawal limit; strategy deallocation cannot bypass Core reserve policy.');
      }
      if (!ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS) {
        throw new Error('The configured strategy adapter is unavailable; no transaction was submitted.');
      }
      const strategyAddress = ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS;
      const [userStrategyPosition, strategyState, totalDeployed] = await withTreasuryReadStage(
        'Withdrawal',
        'strategy preflight',
        arcMainnetReadClient,
        () => Promise.all([
          readContract(arcMainnetReadClient, {
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'userStrategyPosition',
            args: [walletAddress as Address, strategyAddress],
            blockNumber: planningBlock,
          }),
          readContract(arcMainnetReadClient, {
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'strategies',
            args: [strategyAddress],
            blockNumber: planningBlock,
          }),
          readContract(arcMainnetReadClient, {
            address: treasuryAddress,
            abi: veloxTreasuryAbi,
            functionName: 'totalDeployed',
            blockNumber: planningBlock,
          }),
        ]),
      );
      beforeUserStrategyShares = userStrategyPosition[0];
      beforeUserStrategyPosition = userStrategyPosition[1];
      beforeStrategyShares = strategyState[5];
      beforeStrategyPosition = strategyState[6];
      beforeTotalDeployed = totalDeployed;

      const requiredAssets = amount - liquidUSDC;
      unwindShares = await buildStrategyUnwindPlan({
        availableShares: beforeUserStrategyShares,
        requiredAssets,
        previewRedeem: (shares) => withTreasuryReadStage(
          'Withdrawal',
          'strategy withdrawal preview',
          arcMainnetReadClient,
          () => readContract(arcMainnetReadClient, {
            address: strategyAddress,
            abi: adapterPreviewRedeemAbi,
            functionName: 'previewRedeem',
            args: [shares],
            blockNumber: planningBlock,
          }),
        ),
      });
      withdrawalCall = {
        functionName: 'withdrawWithDeallocation',
        args: [
          amount,
          recipientInput as Address,
          [strategyAddress],
          [unwindShares],
        ],
      };
    }

    let failureStage = 'transaction submission';
    setIsSubmitting(true);
    setStatus(unwindShares > 0n ? 'Submitting Treasury withdrawal with strategy deallocation…' : 'Submitting Treasury withdrawal…');
    try {
      let hash: `0x${string}`;
      try {
        hash = await writeContractAsync({
          address: treasuryAddress,
          abi: veloxTreasuryAbi,
          functionName: withdrawalCall.functionName,
          args: withdrawalCall.args,
          chainId: ARC_MAINNET_CHAIN_ID,
        });
      } catch (cause) {
        throw walletSubmissionError('Withdrawal', 'transaction', cause);
      }
      failureStage = 'receipt';
      let receipt;
      try {
        receipt = await withVerifiedArcMainnetPublicClient(
          arcMainnetReadClient,
          () => arcMainnetReadClient.waitForTransactionReceipt({ hash }),
        );
      } catch {
        throw receiptWaitError('Withdrawal', 'receipt', hash);
      }
      if (receipt.status !== 'success') throw new Error('Withdrawal receipt shows an on-chain revert.');
      const withdrawalEvent = readWithdrawalEvent(receipt, treasuryAddress, walletAddress, recipientInput);
      if (!withdrawalEvent) throw new Error('Withdrawal receipt succeeded but the expected Core Withdrawal event was not verified. Check the receipt before retrying.');

      failureStage = 'post-receipt';
      if (unwindShares === 0n) {
        if (withdrawalEvent.amount !== amount) {
          throw new Error('Withdrawal event amount did not match the requested amount.');
        }
        await confirmUserBalanceChange({
          previousBalance: userBalance,
          amount,
          change: 'withdrawal',
          refresh: async () => {
            try {
              await onConfirmed();
            } catch {
              throw new Error('Withdrawal post-receipt balance refresh failed. The transaction receipt may already be confirmed; check it before retrying.');
            }
          },
          readCoreBalance: () => withTreasuryReadStage(
            'Withdrawal',
            'post-receipt balance readback',
            arcMainnetReadClient,
            () => readContract(arcMainnetReadClient, {
              address: treasuryAddress,
              abi: veloxTreasuryAbi,
              functionName: 'userBalance',
              args: [walletAddress as Address],
            }),
          ),
        });
      } else {
        try {
          await onConfirmed();
        } catch {
          throw new Error('Withdrawal post-receipt balance refresh failed. The transaction receipt may already be confirmed; check it before retrying.');
        }
        const strategyAddress = ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS;
        if (!strategyAddress) throw new Error('The configured strategy adapter is unavailable.');
        const [actualBalance, actualUserPosition, actualStrategy, actualTotalDeployed] = await withTreasuryReadStage(
          'Withdrawal',
          'post-receipt strategy readback',
          arcMainnetReadClient,
          () => Promise.all([
            readContract(arcMainnetReadClient, {
              address: treasuryAddress,
              abi: veloxTreasuryAbi,
              functionName: 'userBalance',
              args: [walletAddress as Address],
              blockNumber: receipt.blockNumber,
            }),
            readContract(arcMainnetReadClient, {
              address: treasuryAddress,
              abi: veloxTreasuryAbi,
              functionName: 'userStrategyPosition',
              args: [walletAddress as Address, strategyAddress],
              blockNumber: receipt.blockNumber,
            }),
            readContract(arcMainnetReadClient, {
              address: treasuryAddress,
              abi: veloxTreasuryAbi,
              functionName: 'strategies',
              args: [strategyAddress],
              blockNumber: receipt.blockNumber,
            }),
            readContract(arcMainnetReadClient, {
              address: treasuryAddress,
              abi: veloxTreasuryAbi,
              functionName: 'totalDeployed',
              blockNumber: receipt.blockNumber,
            }),
          ]),
        );
        verifyStrategyWithdrawalReadback({
          requestedAmount: amount,
          preWithdrawalBalance: userBalance,
          eventAmount: withdrawalEvent.amount,
          eventUserBalance: withdrawalEvent.userBalance,
          actualUserBalance: actualBalance,
          preUserStrategyShares: beforeUserStrategyShares,
          postUserStrategyShares: actualUserPosition[0],
          preUserStrategyPosition: beforeUserStrategyPosition,
          postUserStrategyPosition: actualUserPosition[1],
          unwindShares,
          preAggregateStrategyShares: beforeStrategyShares,
          postAggregateStrategyShares: actualStrategy[5],
          preAggregateStrategyPosition: beforeStrategyPosition,
          postAggregateStrategyPosition: actualStrategy[6],
          preTotalDeployed: beforeTotalDeployed,
          postTotalDeployed: actualTotalDeployed,
        });
      }
      setStatus(unwindShares > 0n
        ? 'Withdrawal and strategy deallocation confirmed on Arc Mainnet.'
        : 'Withdrawal confirmed on Arc Mainnet.');
      return receipt;
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      const message = isSafeTreasuryActionDiagnostic(detail)
        ? detail
        : failureStage === 'transaction submission'
          ? 'Withdrawal transaction submission failed. Check wallet activity before retrying.'
          : failureStage === 'receipt'
            ? 'Withdrawal receipt or event verification failed. The transaction may be pending or reverted; check wallet activity before retrying.'
            : 'Withdrawal post-receipt verification failed. The withdrawal may already be confirmed; check the transaction before retrying.';
      setStatus(message);
      throw new Error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [treasuryAddress, walletAddress, isArcMainnet, client, writeContractAsync, onConfirmed]);

  return { treasuryAddress, canWithdraw, withdraw, status, isSubmitting };
}