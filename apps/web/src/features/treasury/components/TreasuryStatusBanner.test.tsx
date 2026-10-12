import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TreasuryStatusBanner } from './TreasuryStatusBanner';

describe('TreasuryStatusBanner', () => {
  const status = {
    type: 'info' as const,
    title: 'User-scoped Treasury view',
    message: 'Treasury-wide balances and shared strategy accounting are not included in this user view.',
  };

  it('shows neutral Treasury status copy to normal users', () => {
    const markup = renderToStaticMarkup(
      <TreasuryStatusBanner status={status} isConnected isArcMainnet />,
    );

    expect(markup).toContain('Your Treasury');
    expect(markup).toContain('Your Treasury information will appear here when available.');
    expect(markup).not.toMatch(/user-scoped|shared strategy|accounting/i);
  });

  it('preserves diagnostic status copy for authorized Admins', () => {
    const markup = renderToStaticMarkup(
      <TreasuryStatusBanner status={status} isConnected isArcMainnet canViewAdmin />,
    );

    expect(markup).toContain('User-scoped Treasury view');
    expect(markup).toContain('shared strategy accounting');
  });
});
