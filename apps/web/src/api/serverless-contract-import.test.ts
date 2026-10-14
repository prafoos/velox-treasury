import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('serverless contract module import', () => {
  it('guards Vite environment access and initializes through the Core API module', async () => {
    const source = readFileSync(new URL('../contracts/treasury.ts', import.meta.url), 'utf8');

    expect(source).toContain('const viteEnvironment = import.meta.env ?? {};');
    expect(source).not.toMatch(/import\.meta\.env\.(?:VITE_|PROD)/);

    const coreState = await import('../../api/core-state.js');
    expect(coreState.ARC_MAINNET_CORE_ADDRESS).toBeTruthy();
    expect(coreState.ARC_MAINNET_STEAKHOUSE_ADAPTER_ADDRESS).toBeTruthy();
  });

  it('initializes the strategy executor from shared role configuration, not the deployment script module', async () => {
    const sharedConfig = await import('../../../../packages/domain/src/treasury-addresses.js');
    const deploymentConfig = await import('../../../../packages/contracts/scripts/arc-mainnet-core-deployment-config.js');
    const strategyAutomation = await import('../../api/strategy-automation.js');

    expect(deploymentConfig.ARC_MAINNET_CORE_ROLE_HOLDERS).toBe(sharedConfig.ARC_MAINNET_CORE_ROLE_HOLDERS);
    expect(strategyAutomation.executeStrategyAutomation).toBeTypeOf('function');
    expect(strategyAutomation.createProductionDependencies).toBeTypeOf('function');
  });
});
