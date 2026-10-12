import { expect } from 'chai';
import {
  ARC_MAINNET_STEAKHOUSE_ADAPTER_CHAIN_ID,
  ARC_MAINNET_STEAKHOUSE_ADAPTER_PROTOCOL_ID,
  ARC_MAINNET_STEAKHOUSE_ADAPTER_USDC,
  ARC_MAINNET_STEAKHOUSE_ADAPTER_VAULT,
  CURRENT_LIVE_CORE_REFERENCE,
  createArcMainnetSteakhouseAdapterDeploymentConfig,
  loadArcMainnetSteakhouseAdapterDeploymentConfig,
  assertAdapterDeploymentReadbackMatchesConfig,
} from '../scripts/arc-mainnet-steakhouse-adapter-deployment-config';
import { RETIRED_TREASURY_ADDRESS } from '../scripts/arc-mainnet-core-deployment-config';
import { RETIRED_ARC_MAINNET_ADDRESSES } from '../scripts/address-safety';

const testFinalCoreInput = '0x1111111111111111111111111111111111111111';

describe('Arc Mainnet Steakhouse Adapter deployment configuration', () => {
  it('requires an explicit final Core input and never falls back to the current live Core', () => {
    expect(() => loadArcMainnetSteakhouseAdapterDeploymentConfig({})).to.throw('ARC_MAINNET_FINAL_CORE_ADDRESS is required');
    expect(() => loadArcMainnetSteakhouseAdapterDeploymentConfig({
      ARC_MAINNET_FINAL_CORE_ADDRESS: CURRENT_LIVE_CORE_REFERENCE,
    })).to.throw('reference-only');
    expect(() => createArcMainnetSteakhouseAdapterDeploymentConfig({ coreAddress: undefined })).to.throw('required');
  });

  it('rejects zero and malformed Core addresses', () => {
    expect(() => createArcMainnetSteakhouseAdapterDeploymentConfig({
      coreAddress: '0x0000000000000000000000000000000000000000',
    })).to.throw('Invalid or missing core address');
    expect(() => createArcMainnetSteakhouseAdapterDeploymentConfig({ coreAddress: 'not-an-address' }))
      .to.throw('Invalid or missing core address');
  });

  it('allows the current live Core only when explicitly marked as a reference', () => {
    const config = createArcMainnetSteakhouseAdapterDeploymentConfig({
      coreAddress: CURRENT_LIVE_CORE_REFERENCE,
      purpose: 'REFERENCE',
    });
    expect(config.core).to.equal(CURRENT_LIVE_CORE_REFERENCE);
    expect(config.purpose).to.equal('REFERENCE');
  });

  it('passes the explicit final Core into the constructor args and preserves Mainnet dependencies', () => {
    const config = createArcMainnetSteakhouseAdapterDeploymentConfig({ coreAddress: testFinalCoreInput });
    expect(config.chainId).to.equal(5_042n);
    expect(config.chainId).to.equal(ARC_MAINNET_STEAKHOUSE_ADAPTER_CHAIN_ID);
    expect(config.core).to.equal(testFinalCoreInput);
    expect(config.constructorArgs).to.deep.equal([
      ARC_MAINNET_STEAKHOUSE_ADAPTER_VAULT,
      testFinalCoreInput,
      ARC_MAINNET_STEAKHOUSE_ADAPTER_PROTOCOL_ID,
      ARC_MAINNET_STEAKHOUSE_ADAPTER_USDC,
    ]);
    expect(config.vault).to.equal('0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298');
    expect(config.usdc).to.equal('0x3600000000000000000000000000000000000000');
    expect(config.protocolId).to.equal('0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450');
    expect(config.core).not.to.equal(CURRENT_LIVE_CORE_REFERENCE);
    expect(config.core).not.to.equal(RETIRED_TREASURY_ADDRESS);
  });

  it('rejects the retired Core as a deployment target', () => {
    for (const address of Object.values(RETIRED_ARC_MAINNET_ADDRESSES)) {
      expect(() => createArcMainnetSteakhouseAdapterDeploymentConfig({ coreAddress: address }))
        .to.throw('retired deployment address');
    }
    expect(RETIRED_TREASURY_ADDRESS).to.equal(RETIRED_ARC_MAINNET_ADDRESSES.treasury);
  });

  it('compares every Adapter getter against the supplied Core and dependency configuration', () => {
    const config = createArcMainnetSteakhouseAdapterDeploymentConfig({ coreAddress: testFinalCoreInput });
    expect(() => assertAdapterDeploymentReadbackMatchesConfig(config, {
      core: testFinalCoreInput,
      asset: config.usdc,
      vault: config.vault,
      protocolId: config.protocolId,
    })).not.to.throw();
    expect(() => assertAdapterDeploymentReadbackMatchesConfig(config, {
      core: CURRENT_LIVE_CORE_REFERENCE,
      asset: config.usdc,
      vault: config.vault,
      protocolId: config.protocolId,
    })).to.throw('immutable Core');
  });
});