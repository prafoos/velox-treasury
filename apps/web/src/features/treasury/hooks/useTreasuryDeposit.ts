import { useCallback, useState } from 'react';
import { isAddress, zeroAddress, type Address } from 'viem';
import { getChainId, readContract } from 'viem/actions';
import { getAccount, getConnectorClient } from 'wagmi/actions';
import { useConfig, useWriteContract } from 'wagmi';

import { getArcMainnetTreasuryAddress, veloxTreasuryAbi } from '../../../contracts/treasury';
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_CONTRACT_ADDRESS, usdcReadAbi, usdcWriteAbi } from '../../../contracts/usdc';
import { arcMainnetReadClient, withVerifiedArcMainnetPublicClient } from '../services/arcMainnetPublicClient';
import { createDepositApprovalFlow, hasExpectedDepositEvent, runDepositApprovalFlow, verifyDepositPreflight } from '../services/depositPreflight';
import { STEAKHOUSE_CORE_ADDRESS } from '../services/protocolVaultMapping';
import { isSafeTreasuryActionDiagnostic, receiptWaitError, walletSubmissionError, withTreasuryReadStage } from '../services/treasuryActionDiagnostics';
import { confirmUserBalanceChange } from '../services/userBalanceReadback';

export function useTreasuryDeposit(address: string | undefined, isArcMainnet: boolean, onConfirmed: () => Promise<unknown>) {
  const treasuryAddress = getArcMainnetTreasuryAddress();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canDeposit = Boolean(
    treasuryAddress
      && treasuryAddress.toLowerCase() === STEAKHOUSE_CORE_ADDRESS.toLowerCase()
      && address
      && isAddress(address)
      && address.toLowerCase() !== zeroAddress
      && isArcMainnet,
  );

  const deposit = useCallback(async (amount: bigint) => {
    if (!treasuryAddress) throw new Error('Treasury not deployed/configured on Arc Mainnet');
    if (!address || !isAddress(address) || address.toLowerCase() === zeroAddress) throw new Error('Connect a valid wallet address');
    if (!isArcMainnet) throw new Error('Deposits require Arc Mainnet (Chain ID 5042). No approval was requested.');
    if (amount <= 0n) throw new Error('Enter a USDC amount greater than zero');
    const verifiedAddress = address as Address;
    const assertCurrentWalletIdentity = async () => {
      const currentAccount = getAccount(config);
      if (
        !currentAccount.isConnected
        || !currentAccount.address
        || !currentAccount.connector
        || currentAccount.address.toLowerCase() !== verifiedAddress.toLowerCase()
      ) {
        throw new Error('The connected wallet account changed. Reconnect the original account and retry; no further transaction was submitted.');
      }
      let walletChainId: number;
      try {
        const currentWalletClient = await getConnectorClient(config, {
          connector: currentAccount.connector,
          chainId: ARC_MAINNET_CHAIN_ID,
        });
        if (currentWalletClient.account.address.toLowerCase() !== verifiedAddress.toLowerCase()) {
          throw new Error('The wallet connector is using a different account.');
        }
        walletChainId = await getChainId(currentWalletClient);
      } catch (cause) {
        throw new Error('The connected wallet account or network could not be verified. No transaction was submitted.', { cause });
      }
      const rpcChainId = await withTreasuryReadStage(
        'Deposit',
        'preflight',
        arcMainnetReadClient,
        () => arcMainnetReadClient.getChainId(),
      );
      if (
        walletChainId !== ARC_MAINNET_CHAIN_ID
        || currentAccount.chainId !== ARC_MAINNET_CHAIN_ID
        || rpcChainId !== ARC_MAINNET_CHAIN_ID
      ) {
        throw new Error('The connected wallet changed away from Arc Mainnet (Chain ID 5042). No transaction was submitted.');
      }
    };
    let previousBalance: bigint | null = null;
    let failureStage = 'preflight';
    setIsSubmitting(true); setStatus('Verifying Arc Mainnet and Treasury identity…');
    try {
      const flow = createDepositApprovalFlow({
        account: verifiedAddress,
        chainId: ARC_MAINNET_CHAIN_ID,
        tokenAddress: ARC_USDC_CONTRACT_ADDRESS,
        coreAddress: treasuryAddress,
        amount,
        assertCurrentWalletIdentity,
        preflight: () => verifyDepositPreflight({
          configuredCoreAddress: treasuryAddress,
          approvedCoreAddress: STEAKHOUSE_CORE_ADDRESS,
          configuredUsdcAddress: ARC_USDC_CONTRACT_ADDRESS,
          getWalletChainId: async () => {
            await assertCurrentWalletIdentity();
            const currentAccount = getAccount(config);
            if (!currentAccount.connector) throw new Error('Reconnect your wallet before depositing.');
            const currentWalletClient = await getConnectorClient(config, {
              connector: currentAccount.connector,
              chainId: ARC_MAINNET_CHAIN_ID,
            });
            return getChainId(currentWalletClient);
          },
          getRpcChainId: () => withTreasuryReadStage(
            'Deposit',
            'preflight',
            arcMainnetReadClient,
            () => arcMainnetReadClient.getChainId(),
          ),
          getCoreBytecode: () => withTreasuryReadStage(
            'Deposit',
            'preflight Core verification',
            arcMainnetReadClient,
            () => arcMainnetReadClient.getBytecode({ address: treasuryAddress }),
          ),
          getCoreUsdcAddress: () => withTreasuryReadStage(
            'Deposit',
            'preflight USDC verification',
            arcMainnetReadClient,
            () => readContract(arcMainnetReadClient, {
              address: treasuryAddress,
              abi: veloxTreasuryAbi,
              functionName: 'usdc',
            }),
          ),
        }),
        writeApproval: ({ account, chainId, tokenAddress, spender, amount: approvalAmount }) => {
          failureStage = 'approval';
          setStatus('Requesting exact USDC approval…');
          return assertCurrentWalletIdentity()
            .then(() => writeContractAsync({
              account,
              address: tokenAddress,
              abi: usdcWriteAbi,
              functionName: 'approve',
              args: [spender, approvalAmount],
              chainId,
            }))
            .catch((cause: unknown) => { throw walletSubmissionError('Deposit', 'USDC approval', cause); });
        },
        waitForApproval: async (hash) => {
          failureStage = 'approval receipt';
          let receipt;
          try {
            receipt = await withVerifiedArcMainnetPublicClient(
              arcMainnetReadClient,
              () => arcMainnetReadClient.waitForTransactionReceipt({ hash }),
            );
          } catch {
            throw receiptWaitError('Deposit', 'approval receipt', hash);
          }
          if (receipt.status !== 'success') throw new Error('Deposit approval receipt shows an on-chain revert.');
          return true;
        },
        writeDeposit: async ({ account, chainId, coreAddress, amount: depositAmount }) => {
          failureStage = 'deposit preflight';
          setStatus('Submitting Treasury deposit…');
          previousBalance = await withTreasuryReadStage(
            'Deposit',
            'preflight balance read',
            arcMainnetReadClient,
            () => readContract(arcMainnetReadClient, {
              address: coreAddress,
              abi: veloxTreasuryAbi,
              functionName: 'userBalance',
              args: [account],
            }),
          );
          await assertCurrentWalletIdentity();
          failureStage = 'deposit';
          try {
            return await writeContractAsync({
              account,
              address: coreAddress,
              abi: veloxTreasuryAbi,
              functionName: 'deposit',
              args: [depositAmount],
              chainId,
            });
          } catch (cause) {
            throw walletSubmissionError('Deposit', 'transaction', cause);
          }
        },
        waitForDeposit: async (hash) => {
          failureStage = 'deposit receipt';
          let receipt;
          try {
            receipt = await withVerifiedArcMainnetPublicClient(
              arcMainnetReadClient,
              () => arcMainnetReadClient.waitForTransactionReceipt({ hash }),
            );
          } catch {
            throw receiptWaitError('Deposit', 'receipt', hash);
          }
          if (receipt.status !== 'success') throw new Error('Deposit receipt shows an on-chain revert.');
          const hasDepositEvent = hasExpectedDepositEvent(
            receipt.logs,
            treasuryAddress,
            verifiedAddress,
            amount,
          );
          if (!hasDepositEvent) throw new Error('Deposit confirmation did not include the expected Treasury Deposit event');
          return true;
        },
        readRemainingAllowance: () => withTreasuryReadStage(
          'Deposit',
          'approval allowance check',
          arcMainnetReadClient,
          () => readContract(arcMainnetReadClient, {
            address: ARC_USDC_CONTRACT_ADDRESS,
            abi: usdcReadAbi,
            functionName: 'allowance',
            args: [verifiedAddress, treasuryAddress],
          }),
        ),
      });
      const depositHash = await runDepositApprovalFlow(flow);
      if (previousBalance === null) throw new Error('Treasury deposit baseline balance was not recorded.');
      failureStage = 'post-receipt';
      try {
        await confirmUserBalanceChange({
          previousBalance,
          amount,
          change: 'deposit',
          refresh: async () => {
            try {
              await onConfirmed();
            } catch {
              throw new Error('Deposit post-receipt balance refresh failed. The deposit receipt may already be confirmed; check the transaction before retrying.');
            }
          },
          readCoreBalance: () => withTreasuryReadStage(
            'Deposit',
            'post-receipt balance readback',
            arcMainnetReadClient,
            () => readContract(arcMainnetReadClient, {
              address: treasuryAddress,
              abi: veloxTreasuryAbi,
              functionName: 'userBalance',
              args: [verifiedAddress],
            }),
            'confirmed',
          ),
        });
      } catch (cause) {
        if (cause instanceof Error && isSafeTreasuryActionDiagnostic(cause.message)) throw cause;
        throw new Error('Deposit post-receipt verification failed. The deposit receipt may already be confirmed; check the transaction before retrying.');
      }
      setStatus('Deposit confirmed. Checking eligible Steakhouse strategy capacity…');
      try {
        const response = await fetch('/api/strategy-automation', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: 'deploy-surplus',
            depositTransactionHash: depositHash,
          }),
        });
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!response.ok || !payload) {
          throw new Error(typeof payload?.error === 'string'
            ? payload.error
            : 'The automatic strategy deployment could not be verified.');
        }
        if (payload.status === 'deployed'
          && typeof payload.allocation === 'object'
          && payload.allocation !== null
          && 'blockNumber' in payload.allocation
          && typeof payload.allocation.blockNumber === 'string') {
          setStatus(`Deposit confirmed. Eligible surplus was deployed to the verified Steakhouse strategy at Core block ${payload.allocation.blockNumber}.`);
        } else if (payload.status === 'skipped' && payload.reason === 'NO_ELIGIBLE_SURPLUS') {
          setStatus('Deposit confirmed. No surplus is currently eligible for Steakhouse deployment under the active Core reserves and policy caps.');
        } else if (payload.status === 'skipped' && payload.reason === 'DUPLICATE_DEPOSIT_TRIGGER') {
          setStatus('Deposit confirmed. Its automatic Steakhouse deployment trigger already completed earlier.');
        } else if (payload.status === 'skipped' && payload.reason === 'PREVIOUS_ATTEMPT_FAILED') {
          setStatus('Deposit confirmed, but a previous automatic Steakhouse deployment attempt for this deposit failed. Funds were NOT confirmed as deployed and it will not be retried automatically; an operator must review the Core state before any manual retry.');
        } else if (payload.status === 'skipped' && payload.reason === 'PREVIOUS_ATTEMPT_INTERRUPTED') {
          setStatus('Deposit confirmed, but a previous automatic Steakhouse deployment attempt for this deposit was interrupted and its outcome is unknown. Funds were NOT confirmed as deployed and it will not be retried automatically; an operator must review the Core state before any manual retry.');
        } else if (payload.status === 'skipped' && payload.reason === 'RUN_IN_PROGRESS') {
          setStatus('Deposit confirmed. Another Steakhouse deployment check is in progress; this trigger was not submitted.');
        } else {
          throw new Error('The automatic strategy deployment returned an invalid result.');
        }
        try {
          await onConfirmed();
        } catch {
          setStatus('Deposit confirmed. Automatic strategy results were verified, but the Treasury display could not be refreshed.');
        }
      } catch (deploymentError) {
        const reason = deploymentError instanceof Error
          ? deploymentError.message
          : 'The automatic strategy deployment could not be verified.';
        setStatus(`Deposit confirmed, but automatic Steakhouse deployment did not complete: ${reason}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      const message = isSafeTreasuryActionDiagnostic(detail)
        ? detail
        : detail.includes('Deposit approval receipt shows an on-chain revert')
          ? 'Deposit approval receipt failed: the USDC approval transaction reverted on Arc Mainnet. No deposit transaction was submitted; check its receipt before retrying.'
        : detail.includes('USDC approval was rejected by the wallet')
          ? 'Deposit USDC approval was rejected by the wallet. No deposit transaction was submitted.'
        : detail.includes('simulation reverted before wallet submission')
          ? 'Deposit transaction simulation reverted before wallet submission. No deposit transaction was submitted.'
        : detail.includes('Deposit receipt shows an on-chain revert')
          ? 'Deposit transaction reverted on Arc Mainnet. Check its receipt before retrying.'
        : detail.includes('Deposit confirmation did not include the expected Treasury Deposit event')
          ? 'Deposit receipt succeeded but its expected Core Deposit event was not verified. Check the receipt and Core balance before retrying.'
        : failureStage === 'preflight' || failureStage === 'deposit preflight'
          ? 'Deposit preflight failed: Arc Mainnet and active Core/USDC verification could not be completed. No deposit transaction was submitted.'
          : failureStage === 'approval'
            ? 'Deposit approval could not be confirmed. Check the approval transaction and allowance before retrying.'
            : failureStage === 'approval receipt'
              ? 'Deposit approval receipt could not be confirmed. Check for a pending approval before retrying.'
              : failureStage === 'deposit'
                ? 'Deposit transaction submission failed. Check wallet activity before retrying.'
                : 'Deposit receipt or post-receipt verification failed. The deposit may already be confirmed; check the transaction before retrying.';
      setStatus(message);
      throw new Error(message);
    } finally { setIsSubmitting(false); }
  }, [treasuryAddress, address, isArcMainnet, config, writeContractAsync, onConfirmed]);
  return { treasuryAddress, canDeposit, deposit, status, isSubmitting };
}
