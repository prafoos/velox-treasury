import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TreasuryAllocationOverview } from './TreasuryAllocationOverview';
import { getTreasuryAllocations } from '../services/treasuryService';
import { createDefaultPolicy } from '../services/policyService';

describe('TreasuryAllocationOverview', () => {
  it('labels percentages as accounting targets and makes clear deposits do not fund separate buckets', () => {
    const defaultPolicy = createDefaultPolicy();
    const allocations = getTreasuryAllocations(
      { isConnected: true, isArcMainnet: true },
      {
        ...defaultPolicy,
        allocations: {
          operational_reserve: 5_000n,
          yield_strategy: 3_000n,
          swap_liquidity: 1_000n,
          automation_agent: 1_000n,
        },
      },
      [500n, 300n, 100n, 100n],
      [500n, 100n, 100n],
    );
    const markup = renderToStaticMarkup(
      <TreasuryAllocationOverview allocations={allocations} canViewAdmin />,
    );

    expect(markup).toContain('Accounting target: 50%');
    expect(markup).toContain('Accounting target: 30%');
    expect(markup).toContain('Accounting target: 10%');
    expect(markup).toContain('not separate funded pools');
    expect(markup).toContain('Depositing USDC does not transfer funds between buckets');
    expect(markup).toContain('strategy deployment is a separate role-gated operation');
    expect(markup).not.toContain('Draft target');
  });
});
