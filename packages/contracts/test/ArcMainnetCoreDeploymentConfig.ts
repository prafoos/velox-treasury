import { expect } from 'chai';
import {
  CURRENT_LIVE_ARC_MAINNET_REFERENCES,
  RETIRED_ARC_MAINNET_ADDRESSES,
} from '../scripts/address-safety';
import {
  ARC_MAINNET_CORE_CHAIN_ID,
  ARC_MAINNET_CORE_INITIAL_POLICY_ENV,
  ARC_MAINNET_CORE_RPC,
  ARC_MAINNET_CORE_ROLE_HOLDERS,
  ARC_MAINNET_CORE_USDC,
  ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV,
  RETIRED_TREASURY_ADDRESS,
  assessInitialPolicyConfiguration,
  createArcMainnetCoreDeploymentConfig,
  loadArcMainnetCoreDeploymentConfig,
  requireConfiguredInitialPolicyValue,
  validateArcMainnetCoreDeploymentConfig,
  type ArcMainnetCoreDeploymentConfig,
  type PolicyConfigurationValue,
} from '../scripts/arc-mainnet-core-deployment-config';

const validEnvironment = {
  ARC_MAINNET_CORE_GOVERNANCE: ARC_MAINNET_CORE_ROLE_HOLDERS.governance,
  ARC_MAINNET_CORE_POLICY_ADMIN: ARC_MAINNET_CORE_ROLE_HOLDERS.policyAdmin,
  ARC_MAINNET_CORE_TIMELOCK_EXECUTOR: ARC_MAINNET_CORE_ROLE_HOLDERS.timelockExecutor,
  ARC_MAINNET_CORE_AUTOMATION_EXECUTOR: ARC_MAINNET_CORE_ROLE_HOLDERS.automationExecutor,
  ARC_MAINNET_CORE_EMERGENCY: ARC_MAINNET_CORE_ROLE_HOLDERS.emergency,
  [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.minimumLiquidReserve]: '2500000',
  [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.minimumLiquidReserveBps]: '7500',
  [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.maximumTotalDeployed]: '1',
  [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.liquidOperationalReserveBps]: '0',
  [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.yieldStrategyBufferBps]: '10000',
  [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.sweepLiquidityBufferBps]: '0',
  [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.automationAgentPoolBps]: '0',
  [ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV]: '100',
};

function configured<T>(value: T): PolicyConfigurationValue<T> {
  return { status: 'CONFIGURED', value };
}

function withCompleteTestPolicy(config: ArcMainnetCoreDeploymentConfig): ArcMainnetCoreDeploymentConfig {
  return {
    ...config,
    initialState: {
      ...config.initialState,
      bucketPolicy: {
        liquidOperationalReserveBps: configured(0),
        yieldStrategyBufferBps: configured(10_000),
        sweepLiquidityBufferBps: configured(0),
        automationAgentPoolBps: configured(0),
      },
      valuationFreshnessBlocks: configured(100n),
      exposureCaps: {
        strategy: configured({ absoluteCap: 1n, relativeCapBps: 0 }),
        protocol: configured({ absoluteCap: 1n, relativeCapBps: 0 }),
        asset: configured({ absoluteCap: 1n, relativeCapBps: 0 }),
      },
    },
  };
}

describe('Arc Mainnet VeloxTreasuryCore deployment configuration', () => {
  it('aligns the approved Core registry with Arc Mainnet chain and USDC configuration', () => {
    const config = createArcMainnetCoreDeploymentConfig(validEnvironment);
    expect(CURRENT_LIVE_ARC_MAINNET_REFERENCES.core).to.equal('0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7');
    expect(config.chainId).to.equal(5_042n);
    expect(config.usdc).to.equal('0x3600000000000000000000000000000000000000');
    expect(CURRENT_LIVE_ARC_MAINNET_REFERENCES.core).not.to.equal(RETIRED_ARC_MAINNET_ADDRESSES.legacyCoreReference);
  });

  it('uses approved initial risk defaults while leaving Admin bucket values unavailable', () => {
    const config = createArcMainnetCoreDeploymentConfig({
      ARC_MAINNET_CORE_GOVERNANCE: validEnvironment.ARC_MAINNET_CORE_GOVERNANCE,
      ARC_MAINNET_CORE_POLICY_ADMIN: validEnvironment.ARC_MAINNET_CORE_POLICY_ADMIN,
      ARC_MAINNET_CORE_TIMELOCK_EXECUTOR: validEnvironment.ARC_MAINNET_CORE_TIMELOCK_EXECUTOR,
      ARC_MAINNET_CORE_AUTOMATION_EXECUTOR: validEnvironment.ARC_MAINNET_CORE_AUTOMATION_EXECUTOR,
      ARC_MAINNET_CORE_EMERGENCY: validEnvironment.ARC_MAINNET_CORE_EMERGENCY,
    });
    expect(config.chainId).to.equal(ARC_MAINNET_CORE_CHAIN_ID);
    expect(config.rpcUrl).to.equal(ARC_MAINNET_CORE_RPC);
    expect(config.usdc).to.equal(ARC_MAINNET_CORE_USDC);
    expect(config.roleConstructorArgs).to.deep.equal([
      ARC_MAINNET_CORE_USDC,
      validEnvironment.ARC_MAINNET_CORE_GOVERNANCE,
      validEnvironment.ARC_MAINNET_CORE_POLICY_ADMIN,
      validEnvironment.ARC_MAINNET_CORE_TIMELOCK_EXECUTOR,
      validEnvironment.ARC_MAINNET_CORE_AUTOMATION_EXECUTOR,
      validEnvironment.ARC_MAINNET_CORE_EMERGENCY,
    ]);
    expect(config.initialState.minimumLiquidReserve).to.deep.equal(configured(0n));
    expect(config.initialState.minimumLiquidReserveBps).to.deep.equal(configured(1_000));
    expect(config.initialState.maximumTotalDeployed).to.deep.equal(configured(5_000_000_000_000n));
    expect(config.initialState.timelockDelay).to.deep.equal(configured(2n * 24n * 60n * 60n));
    expect(Object.values(config.initialState.bucketPolicy).every((value) => value.status === 'UNAVAILABLE')).to.equal(true);
    expect(config.initialState.valuationFreshnessBlocks).to.deep.equal(configured(1_200n));
    expect(assessInitialPolicyConfiguration(config.initialState).unavailable).to.include('bucketPolicy.liquidOperationalReserveBps');
    expect(loadArcMainnetCoreDeploymentConfig({
      ARC_MAINNET_CORE_GOVERNANCE: validEnvironment.ARC_MAINNET_CORE_GOVERNANCE,
      ARC_MAINNET_CORE_POLICY_ADMIN: validEnvironment.ARC_MAINNET_CORE_POLICY_ADMIN,
      ARC_MAINNET_CORE_TIMELOCK_EXECUTOR: validEnvironment.ARC_MAINNET_CORE_TIMELOCK_EXECUTOR,
      ARC_MAINNET_CORE_AUTOMATION_EXECUTOR: validEnvironment.ARC_MAINNET_CORE_AUTOMATION_EXECUTOR,
      ARC_MAINNET_CORE_EMERGENCY: validEnvironment.ARC_MAINNET_CORE_EMERGENCY,
    }).initialState.bucketPolicy.liquidOperationalReserveBps.status).to.equal('UNAVAILABLE');

    const fullyConfigured = createArcMainnetCoreDeploymentConfig(validEnvironment);
    expect(fullyConfigured.initialState.minimumLiquidReserve).to.deep.equal(configured(2_500_000n));
    expect(fullyConfigured.initialState.minimumLiquidReserveBps).to.deep.equal(configured(7_500));
    expect(fullyConfigured.initialState.maximumTotalDeployed).to.deep.equal(configured(1n));
    expect(fullyConfigured.initialState.timelockDelay).to.deep.equal(configured(2n * 24n * 60n * 60n));
    expect(fullyConfigured.initialState.bucketPolicy).to.deep.equal({
      liquidOperationalReserveBps: configured(0),
      yieldStrategyBufferBps: configured(10_000),
      sweepLiquidityBufferBps: configured(0),
      automationAgentPoolBps: configured(0),
    });
    expect(assessInitialPolicyConfiguration(fullyConfigured.initialState).status).to.equal('CONFIGURED');
  });

  it('allows unavailable Admin bucket policy values without blocking deployment readiness', () => {
    const missingBucket = createArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.sweepLiquidityBufferBps]: '',
    });
    expect(missingBucket.initialState.bucketPolicy.sweepLiquidityBufferBps.status).to.equal('UNAVAILABLE');
    expect(assessInitialPolicyConfiguration(missingBucket.initialState).status).to.equal('UNAVAILABLE');
    expect(loadArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.sweepLiquidityBufferBps]: '',
    }).initialState.bucketPolicy.sweepLiquidityBufferBps.status).to.equal('UNAVAILABLE');

    const invalidTotal = createArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.automationAgentPoolBps]: '1',
    });
    expect(assessInitialPolicyConfiguration(invalidTotal.initialState).invalid).to.include('bucketPolicy.totalBps');
    expect(() => loadArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      [ARC_MAINNET_CORE_INITIAL_POLICY_ENV.automationAgentPoolBps]: '1',
    })).to.throw('Initial Core policy is INVALID');
  });

  it('continues to require constructor policy values other than Admin bucket policy', () => {
    const complete = withCompleteTestPolicy(createArcMainnetCoreDeploymentConfig(validEnvironment));
    const missingRequiredValue: ArcMainnetCoreDeploymentConfig = {
      ...complete,
      initialState: {
        ...complete.initialState,
        valuationFreshnessBlocks: { status: 'UNAVAILABLE', reason: 'Required for Core construction.' },
      },
    };
    expect(() => validateArcMainnetCoreDeploymentConfig(missingRequiredValue))
      .to.throw('Initial Core policy is UNAVAILABLE');
  });

  it('represents exposure caps as optional post-deployment settings', () => {
    const config = createArcMainnetCoreDeploymentConfig(validEnvironment);
    expect(config.initialState.exposureCaps).to.deep.equal({
      strategy: { status: 'CONFIGURED', value: { absoluteCap: 0n, relativeCapBps: 0 } },
      protocol: { status: 'CONFIGURED', value: { absoluteCap: 0n, relativeCapBps: 0 } },
      asset: { status: 'CONFIGURED', value: { absoluteCap: 0n, relativeCapBps: 0 } },
    });
  });

  it('distinguishes explicit zero from unavailable configuration', () => {
    const config = createArcMainnetCoreDeploymentConfig(validEnvironment);
    expect(requireConfiguredInitialPolicyValue('minimumLiquidReserve', config.initialState.minimumLiquidReserve)).to.equal(2_500_000n);
    expect(requireConfiguredInitialPolicyValue('maximumTotalDeployed', config.initialState.maximumTotalDeployed)).to.equal(1n);
    expect(requireConfiguredInitialPolicyValue('liquidOperationalReserveBps', config.initialState.bucketPolicy.liquidOperationalReserveBps)).to.equal(0);
    expect(requireConfiguredInitialPolicyValue('strategy exposure cap', config.initialState.exposureCaps.strategy)).to.deep.equal({ absoluteCap: 0n, relativeCapBps: 0 });
    expect(requireConfiguredInitialPolicyValue(
      'valuationFreshnessBlocks',
      config.initialState.valuationFreshnessBlocks,
    )).to.equal(100n);
  });

  it('uses the established role-holder configuration only for its matching Core role', () => {
    const config = createArcMainnetCoreDeploymentConfig({});
    expect(config.roles).to.deep.equal(ARC_MAINNET_CORE_ROLE_HOLDERS);
    expect(config.roleConstructorArgs).to.deep.equal([
      ARC_MAINNET_CORE_USDC,
      ARC_MAINNET_CORE_ROLE_HOLDERS.governance,
      ARC_MAINNET_CORE_ROLE_HOLDERS.policyAdmin,
      ARC_MAINNET_CORE_ROLE_HOLDERS.timelockExecutor,
      ARC_MAINNET_CORE_ROLE_HOLDERS.automationExecutor,
      ARC_MAINNET_CORE_ROLE_HOLDERS.emergency,
    ]);
    expect(validateArcMainnetCoreDeploymentConfig(config)).to.equal(config);
    expect(assessInitialPolicyConfiguration(config.initialState).unavailable).to.include(
      'bucketPolicy.liquidOperationalReserveBps',
    );
  });

  it('defaults valuation freshness to 1200 blocks and accepts only valid overrides', () => {
    const missingEnvironment: NodeJS.ProcessEnv = { ...validEnvironment };
    delete missingEnvironment[ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV];
    const missing = createArcMainnetCoreDeploymentConfig(missingEnvironment);
    expect(missing.initialState.valuationFreshnessBlocks).to.deep.equal(configured(1_200n));
    expect(() => loadArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      [ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV]: '0',
    })).to.throw('Initial Core policy is INVALID');
    expect(() => loadArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      [ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV]: 'not-a-number',
    })).to.throw('must be an explicitly supplied non-negative integer');

    const explicit = createArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      [ARC_MAINNET_CORE_VALUATION_FRESHNESS_ENV]: '1',
    });
    expect(explicit.initialState.valuationFreshnessBlocks).to.deep.equal(configured(1n));
    expect(() => validateArcMainnetCoreDeploymentConfig({
      ...withCompleteTestPolicy(explicit),
      initialState: {
        ...withCompleteTestPolicy(explicit).initialState,
        valuationFreshnessBlocks: configured(0n),
      },
    })).to.throw('valuationFreshnessBlocks');
  });

  it('classifies complete and invalid policy values before deployment validation', () => {
    const completeConfig = withCompleteTestPolicy(createArcMainnetCoreDeploymentConfig(validEnvironment));
    expect(assessInitialPolicyConfiguration(completeConfig.initialState).status).to.equal('CONFIGURED');
    expect(validateArcMainnetCoreDeploymentConfig(completeConfig)).to.equal(completeConfig);

    const invalidConfig = {
      ...completeConfig,
      initialState: {
        ...completeConfig.initialState,
        bucketPolicy: {
          ...completeConfig.initialState.bucketPolicy,
          automationAgentPoolBps: configured(999),
        },
      },
    };
    expect(assessInitialPolicyConfiguration(invalidConfig.initialState)).to.deep.include({ status: 'INVALID' });
    expect(() => validateArcMainnetCoreDeploymentConfig(invalidConfig)).to.throw('Initial Core policy is INVALID');
  });

  it('allows Admin-defined reserve values and requires a positive deployment ceiling', () => {
    const complete = withCompleteTestPolicy(createArcMainnetCoreDeploymentConfig(validEnvironment));
    expect(validateArcMainnetCoreDeploymentConfig(complete)).to.equal(complete);
    const zeroDeploymentCap = {
      ...complete,
      initialState: {
        ...complete.initialState,
        maximumTotalDeployed: configured(0n),
      },
    };
    expect(assessInitialPolicyConfiguration(zeroDeploymentCap.initialState).invalid).to.include('maximumTotalDeployed');
    expect(() => validateArcMainnetCoreDeploymentConfig(zeroDeploymentCap)).to.throw('Initial Core policy is INVALID');
    const explicitDistribution = {
      ...complete,
      initialState: {
        ...complete.initialState,
        bucketPolicy: {
          liquidOperationalReserveBps: configured(1_000),
          yieldStrategyBufferBps: configured(9_000),
          sweepLiquidityBufferBps: configured(0),
          automationAgentPoolBps: configured(0),
        },
      },
    };
    expect(validateArcMainnetCoreDeploymentConfig(explicitDistribution)).to.equal(explicitDistribution);
  });

  it('does not require post-deployment exposure cap values for constructor readiness', () => {
    const complete = withCompleteTestPolicy(createArcMainnetCoreDeploymentConfig(validEnvironment));
    const withoutExposureCapValues: ArcMainnetCoreDeploymentConfig = {
      ...complete,
      initialState: {
        ...complete.initialState,
        exposureCaps: {
          strategy: { status: 'UNAVAILABLE', reason: 'Configured after deployment.' },
          protocol: { status: 'UNAVAILABLE', reason: 'Configured after deployment.' },
          asset: { status: 'UNAVAILABLE', reason: 'Configured after deployment.' },
        },
      },
    };
    expect(assessInitialPolicyConfiguration(withoutExposureCapValues.initialState).status).to.equal('CONFIGURED');
    expect(validateArcMainnetCoreDeploymentConfig(withoutExposureCapValues)).to.equal(withoutExposureCapValues);
  });

  it('rejects missing role holders and duplicate roles', () => {
    expect(() => validateArcMainnetCoreDeploymentConfig(withCompleteTestPolicy(createArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      ARC_MAINNET_CORE_GOVERNANCE: '',
    })))).to.throw('Invalid or missing new Treasury role holder');
    expect(() => validateArcMainnetCoreDeploymentConfig(withCompleteTestPolicy(createArcMainnetCoreDeploymentConfig({
      ...validEnvironment,
      ARC_MAINNET_CORE_EMERGENCY: validEnvironment.ARC_MAINNET_CORE_GOVERNANCE,
    })))).to.throw('must be distinct');
  });

  it('rejects all retired deployment addresses as role holders', () => {
    for (const address of Object.values(RETIRED_ARC_MAINNET_ADDRESSES)) {
      expect(() => validateArcMainnetCoreDeploymentConfig(withCompleteTestPolicy(createArcMainnetCoreDeploymentConfig({
        ...validEnvironment,
        ARC_MAINNET_CORE_GOVERNANCE: address,
      })))).to.throw('retired deployment address');
    }
    expect(RETIRED_TREASURY_ADDRESS).to.equal(RETIRED_ARC_MAINNET_ADDRESSES.treasury);
  });
});
