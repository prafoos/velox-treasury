import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TreasuryTransactionModel } from '@velox/domain';
import { TransactionHistory } from './TransactionHistory';

const verifiedDeposit: TreasuryTransactionModel = {
  hash: '0xae3a80d30660f82fcbee17067d5b93caf54af8fe7dfdcda07d69811d50aaf8f0',
  chainId: 5042,
  asset: 'USDC',
  rawAmount: 1_000_000n,
  sender: '0x0EbAd7EcDa409d72aAcc529eFD46077D1cf012Be',
  recipient: '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7',
  type: 'deposit',
  status: 'confirmed',
  blockNumber: 25_552_056n,
  timestamp: 1_760_256_992n,
  explorerUrl: 'https://explorer.arc.io/tx/0xae3a80d30660f82fcbee17067d5b93caf54af8fe7dfdcda07d69811d50aaf8f0',
};

describe('TransactionHistory', () => {
  it('renders verified Core deposit details and the bounded-history limitation', () => {
    const markup = renderToStaticMarkup(
      <TransactionHistory transactions={[verifiedDeposit]} isLoading={false} />,
    );

    expect(markup).toContain('deposit · 1.00 USDC');
    expect(markup).toContain(verifiedDeposit.hash);
    expect(markup).toContain(verifiedDeposit.sender);
    expect(markup).toContain(verifiedDeposit.recipient);
    expect(markup).toContain('Block: 25,552,056');
    expect(markup).toContain('confirmed');
    expect(markup).toContain('not a complete historical index');
    expect(markup).toContain('View on Arc Explorer');
  });

  it('surfaces history errors instead of presenting a successful empty state', () => {
    const markup = renderToStaticMarkup(
      <TransactionHistory
        transactions={[]}
        isLoading={false}
        error={new Error('RPC rate limit')}
      />,
    );

    expect(markup).toContain('Verified recent transaction history is unavailable');
    expect(markup).toContain('RPC rate limit');
    expect(markup).not.toContain('No verified recent transactions.');
  });
});
