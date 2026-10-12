import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BucketConfigurationPanel } from './BucketConfigurationPanel';

describe('BucketConfigurationPanel', () => {
  it('surfaces incomplete discovery instead of reporting no pending operation', () => {
    const markup = renderToStaticMarkup(
      <BucketConfigurationPanel
        draftPolicy={null}
        currentPolicy={null}
        canViewAdmin={false}
        canExecuteBucketPolicy
        currentCoreSupported
        pendingDiscoveryError={new Error('Historical event discovery failed.')}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Historical event discovery failed.');
    expect(markup).not.toContain('No pending Bucket Policy operation was found');
  });
});
