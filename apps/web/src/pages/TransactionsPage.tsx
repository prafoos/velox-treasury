import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import { TransactionHistory } from '../features/transactions/components/TransactionHistory';
import {
  createArcMainnetTransactionHistorySource,
  readTransactionHistory,
  verifyCurrentTreasuryCore,
} from '../features/transactions/services/transactionService';
import { ARC_MAINNET_CHAIN_ID } from '../contracts/usdc';
import { getArcMainnetTreasuryAddress } from '../contracts/treasury';
import { useWalletStatus } from '../hooks/useWalletStatus';

export function TransactionsPage() {
  const { address, isArcMainnet, isConnected } = useWalletStatus();
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID });
  const treasuryAddress = getArcMainnetTreasuryAddress();
  const coreVerificationQuery = useQuery({
    queryKey: ['transactions-core-verification', treasuryAddress],
    enabled: Boolean(publicClient && treasuryAddress),
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      if (!publicClient) throw new Error('Arc Mainnet RPC client is unavailable.');
      return verifyCurrentTreasuryCore(publicClient);
    },
  });
  const historyQuery = useQuery({
    queryKey: ['verified-treasury-transaction-history', ARC_MAINNET_CHAIN_ID, address?.toLowerCase(), treasuryAddress],
    enabled: Boolean(isConnected && isArcMainnet && address && publicClient && coreVerificationQuery.data),
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      if (!address || !publicClient || !coreVerificationQuery.data) {
        throw new Error('Connect an Arc Mainnet wallet and verify the current Core to read transaction history.');
      }
      const source = createArcMainnetTransactionHistorySource(publicClient, coreVerificationQuery.data);
      return readTransactionHistory(address, source);
    },
  });
  const retryReads = async () => {
    if (coreVerificationQuery.data) {
      await historyQuery.refetch();
      return;
    }
    await coreVerificationQuery.refetch();
  };

  return (
    <div className="vx-treasury-page">
      <header className="vx-page-header">
        <div className="vx-page-title-group">
          <h1>Transaction History</h1>
          <p>Read-only Arc Mainnet records from the designated current Core.</p>
        </div>
      </header>
      <TransactionHistory
        transactions={historyQuery.data ?? []}
        isLoading={coreVerificationQuery.isLoading || historyQuery.isLoading}
        error={historyQuery.error instanceof Error
          ? historyQuery.error
          : coreVerificationQuery.error instanceof Error ? coreVerificationQuery.error : null}
        onRetry={() => { void retryReads(); }}
        walletUnavailableMessage={!isConnected
          ? 'Connect a wallet to view its recent Treasury transactions.'
          : !isArcMainnet
            ? 'Switch to Arc Mainnet (Chain ID 5042) to view this wallet’s Treasury transactions.'
            : null}
      />
      {coreVerificationQuery.isLoading ? (
        <div className="vx-step-callout info" role="status">Verifying the designated Core on Arc Mainnet…</div>
      ) : coreVerificationQuery.data ? (
        <div className="vx-step-callout info" role="status">
          Current Core verified on Arc Mainnet (Chain ID 5042), with deployed bytecode and the approved USDC identity. This history view is read-only; Treasury actions use separate wallet, role, allowance, and transaction preflights.
        </div>
      ) : (
        <div className="vx-step-callout warning" role="alert">
          <strong>Core verification unavailable:</strong> {coreVerificationQuery.error instanceof Error
            ? coreVerificationQuery.error.message
            : 'The designated current Core is not configured.'}
          <button type="button" className="vx-btn vx-btn-outline" onClick={() => { void coreVerificationQuery.refetch(); }}>
            Retry Core verification
          </button>
        </div>
      )}
    </div>
  );
}
