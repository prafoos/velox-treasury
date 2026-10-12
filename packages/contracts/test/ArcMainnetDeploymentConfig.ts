import { expect } from 'chai';
import { RETIRED_ARC_MAINNET_ADDRESSES } from '../scripts/address-safety';
import {
  assertLegacyMainnetDeploymentOptIn,
  loadArcMainnetDeploymentConfig,
  validateArcMainnetDeploymentConfig,
} from '../scripts/arc-mainnet-deployment-config';

const environment = {
  ARC_MAINNET_GOVERNANCE: '0x1111111111111111111111111111111111111111',
  ARC_MAINNET_POLICY_ADMIN: '0x2222222222222222222222222222222222222222',
  ARC_MAINNET_PAUSER: '0x3333333333333333333333333333333333333333',
  ARC_MAINNET_WITHDRAWER: '0x4444444444444444444444444444444444444444',
};

describe('Arc Mainnet deployment configuration', () => {
  it('requires explicit opt-in before the legacy Mainnet deployment path can run', () => {
    expect(() => assertLegacyMainnetDeploymentOptIn({})).to.throw(/legacy VeloxTreasury Mainnet deployment/i);
    expect(() => assertLegacyMainnetDeploymentOptIn({ ALLOW_LEGACY_MAINNET_DEPLOYMENT: '1' })).not.to.throw();
  });

  it('requires chain 5042, externally supplied distinct role holders, and 6-decimal ERC-20 policy values', () => {
    const config = loadArcMainnetDeploymentConfig(environment);
    expect(config.network).to.equal('arc-mainnet');
    expect(config.chainId).to.equal(5_042);
    expect(config.usdc.decimals).to.equal(6);
    expect(config.policy.minimumLiquidReserve).to.equal(10_000_000n);
    expect(config.policy.surplusSweepThreshold).to.equal(50_000_000n);
    expect(config.policy.dailyOutflowCap).to.equal(100_000_000n);
    expect(config.policy.maximumSingleWithdrawal).to.equal(50_000_000n);
    expect(config.constructor).to.deep.equal({
      usdc: config.usdc.address,
      governance: environment.ARC_MAINNET_GOVERNANCE,
      policyAdmin: environment.ARC_MAINNET_POLICY_ADMIN,
      pauser: environment.ARC_MAINNET_PAUSER,
      withdrawer: environment.ARC_MAINNET_WITHDRAWER,
    });
  });

  it('rejects missing and duplicate Mainnet role holders', () => {
    expect(() => loadArcMainnetDeploymentConfig({})).to.throw('Invalid Arc Mainnet deployment role holder: governance.');
    const config = loadArcMainnetDeploymentConfig(environment);
    expect(() => validateArcMainnetDeploymentConfig({
      ...config,
      roles: { ...config.roles, pauser: config.roles.governance },
    })).to.throw('The four Arc Mainnet deployment role holders must be distinct.');
  });

  it('rejects retired addresses as legacy Mainnet deployment role holders', () => {
    const config = loadArcMainnetDeploymentConfig(environment);
    for (const address of Object.values(RETIRED_ARC_MAINNET_ADDRESSES)) {
      expect(() => validateArcMainnetDeploymentConfig({
        ...config,
        roles: { ...config.roles, governance: address },
        constructor: { ...config.constructor, governance: address },
      })).to.throw('Retired deployment address');
    }
  });

  it('retains the legacy Mainnet network and chain guards', () => {
    const config = loadArcMainnetDeploymentConfig(environment);
    expect(() => validateArcMainnetDeploymentConfig({ ...config, network: 'wrong-network' as 'arc-mainnet' }))
      .to.throw('requires arc-mainnet');
    expect(() => validateArcMainnetDeploymentConfig({ ...config, chainId: 5042002 }))
      .to.throw('requires chain ID 5042');
  });
});
