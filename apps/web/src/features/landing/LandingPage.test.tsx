import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('presents the product hero and links to the existing Treasury page', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter><LandingPage /></MemoryRouter>,
    );

    expect(markup).toContain('Manage your USDC. Simply.');
    expect(markup).toContain('Keep, grow and manage your USDC from one place, with clear tools and helpful guidance whenever you need it.');
    expect(markup).toContain('Enter Velox Treasury');
    expect(markup).toContain('href="/treasury"');
    expect(markup).not.toContain('vx-landing-mark');
    expect(markup).not.toContain('Quote unavailable');
    expect(markup).not.toContain('Strategy data unavailable');
    expect(markup).not.toContain('No transactions yet');
    expect(markup).not.toContain('Explore the platform');
    expect(markup).not.toContain('smart contracts');
    expect(markup).not.toContain('liquidity infrastructure');
  });

  it('links every feature card to its existing page route', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter><LandingPage /></MemoryRouter>,
    );

    expect(markup).toContain('Move between supported assets easily.');
    expect(markup).toContain('Explore ways your USDC can work for you.');
    expect(markup).toContain('See your Treasury activity clearly.');
    expect(markup).toContain('Get helpful guidance while you manage your Treasury.');
    expect(markup).toContain('href="/swap" data-discover="true">Explore Swap<span aria-hidden="true">→</span>');
    expect(markup).toContain('href="/earn" data-discover="true">Explore Earn<span aria-hidden="true">→</span>');
    expect(markup).toContain('href="/transactions" data-discover="true">View Transactions<span aria-hidden="true">→</span>');
    expect(markup).toContain('href="/ai-assistant" data-discover="true">Open AI Assistant<span aria-hidden="true">→</span>');
    expect(markup).not.toMatch(/vx-landing-feature-number|>0[1-4]</);
  });

  it('visually connects USDC to Velox and its Treasury destinations', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter><LandingPage /></MemoryRouter>,
    );

    for (const content of [
      'Your USDC',
      'Velox',
      'Your Treasury, in one place.',
      'Ready',
      'Available when needed',
      'Grow',
      'Selected earning options',
      'Stay Ready',
      'Liquidity within reach',
      'Smart Guidance',
      'Helpful guidance &amp; planning',
      'Your USDC, working with purpose.',
      'How Velox manages your USDC',
      'One Treasury. Four ways to support your goals.',
      'Liquid Operational Reserve',
      'USDC liquidity for operational needs and user withdrawals, subject to available liquidity and existing controls.',
      'Yield Strategy',
      'Explore approved yield opportunities when strategy eligibility and existing controls permit.',
      'Liquidity Availability',
      'Keep liquidity accessible when needed; this is not a separate swap balance.',
      'Automation &amp; AI Guidance',
      'Use planning and recommendations for approved operations; AI guidance does not move funds or bypass existing controls.',
      'These are product concepts, not separate on-chain balances or a claim that funds have been allocated among them.',
      'Ready to manage your USDC?',
    ]) {
      expect(markup).toContain(content);
    }
    expect(markup).not.toMatch(/blockchain|smart.contract|protocol|defi|architecture|developer/i);
    expect(markup).not.toMatch(/4 buckets|bucket policy|BPS|timelock|strategy cap|automation role/i);
    expect(markup).not.toMatch(/Step [1-9]/i);
    expect(markup).not.toMatch(/>0[1-4]</);
    expect(markup.match(/href="\/treasury"/g)).toHaveLength(2);
  });
});
