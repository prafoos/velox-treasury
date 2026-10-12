import hre from 'hardhat';
import {
  loadArcMainnetCoreDeploymentConfig,
  requireConfiguredInitialPolicyValue,
} from './arc-mainnet-core-deployment-config';
import {
  assertAdapterDeploymentReadbackMatchesConfig,
  loadArcMainnetSteakhouseAdapterDeploymentConfig,
} from './arc-mainnet-steakhouse-adapter-deployment-config';

const EXPECTED_CONTRACT = 'SteakhousePrimeUSDCAdapter';
const EXPECTED_CORE_CONTRACT = 'VeloxTreasuryCore';

async function verifyCoreTarget(
  config: ReturnType<typeof loadArcMainnetSteakhouseAdapterDeploymentConfig>,
  corePolicyConfig: ReturnType<typeof loadArcMainnetCoreDeploymentConfig>,
) {
  const coreCode = await hre.ethers.provider.getCode(config.core);
  if (coreCode === '0x') throw new Error('Supplied final Core address has no deployed bytecode.');

  const core = await hre.ethers.getContractAt(EXPECTED_CORE_CONTRACT, config.core);
  const [coreUsdc, timelockDelay, riskPolicy, bucketPolicy, freshness, totalDeployed, approvedProtocolCount, approvedAssetCount, approvedStrategyCount] = await Promise.all([
    core.usdc(),
    core.TIMELOCK_DELAY(),
    core.riskPolicy(),
    core.bucketPolicy(),
    core.valuationFreshnessBlocks(),
    core.totalDeployed(),
    core.approvedProtocolCount(),
    core.approvedAssetCount(),
    core.approvedStrategyCount(),
  ]);

  if (coreUsdc.toLowerCase() !== config.usdc.toLowerCase()) throw new Error('Supplied Core does not use official Arc Mainnet USDC.');
  if (timelockDelay !== 2n * 24n * 60n * 60n) throw new Error('Supplied Core does not have the configured two-day timelock.');
  const expectedMinimumLiquidReserve = requireConfiguredInitialPolicyValue(
    'minimumLiquidReserve',
    corePolicyConfig.initialState.minimumLiquidReserve,
  );
  const expectedMinimumLiquidReserveBps = BigInt(requireConfiguredInitialPolicyValue(
    'minimumLiquidReserveBps',
    corePolicyConfig.initialState.minimumLiquidReserveBps,
  ));
  const expectedMaximumTotalDeployed = requireConfiguredInitialPolicyValue(
    'maximumTotalDeployed',
    corePolicyConfig.initialState.maximumTotalDeployed,
  );
  if (
    riskPolicy.minimumLiquidReserve !== expectedMinimumLiquidReserve
    || riskPolicy.minimumLiquidReserveBps !== expectedMinimumLiquidReserveBps
    || riskPolicy.maximumTotalDeployed !== expectedMaximumTotalDeployed
  ) {
    throw new Error('Supplied Core initial risk policy does not match the verified initial Core deployment configuration.');
  }
  const expectedBucketPolicy = {
    liquidOperationalReserveBps: BigInt(requireConfiguredInitialPolicyValue(
      'bucketPolicy.liquidOperationalReserveBps',
      corePolicyConfig.initialState.bucketPolicy.liquidOperationalReserveBps,
    )),
    yieldStrategyBufferBps: BigInt(requireConfiguredInitialPolicyValue(
      'bucketPolicy.yieldStrategyBufferBps',
      corePolicyConfig.initialState.bucketPolicy.yieldStrategyBufferBps,
    )),
    sweepLiquidityBufferBps: BigInt(requireConfiguredInitialPolicyValue(
      'bucketPolicy.sweepLiquidityBufferBps',
      corePolicyConfig.initialState.bucketPolicy.sweepLiquidityBufferBps,
    )),
    automationAgentPoolBps: BigInt(requireConfiguredInitialPolicyValue(
      'bucketPolicy.automationAgentPoolBps',
      corePolicyConfig.initialState.bucketPolicy.automationAgentPoolBps,
    )),
  };
  const bucketTotal = bucketPolicy.liquidOperationalReserveBps
    + bucketPolicy.yieldStrategyBufferBps
    + bucketPolicy.sweepLiquidityBufferBps
    + bucketPolicy.automationAgentPoolBps;
  const expectedFreshness = requireConfiguredInitialPolicyValue(
    'valuationFreshnessBlocks',
    corePolicyConfig.initialState.valuationFreshnessBlocks,
  );
  if (
    bucketTotal !== 10_000n
    || bucketPolicy.liquidOperationalReserveBps !== expectedBucketPolicy.liquidOperationalReserveBps
    || bucketPolicy.yieldStrategyBufferBps !== expectedBucketPolicy.yieldStrategyBufferBps
    || bucketPolicy.sweepLiquidityBufferBps !== expectedBucketPolicy.sweepLiquidityBufferBps
    || bucketPolicy.automationAgentPoolBps !== expectedBucketPolicy.automationAgentPoolBps
    || freshness !== expectedFreshness
  ) {
    throw new Error('Supplied Core initial bucket or valuation freshness state does not match the configured deployment policy.');
  }
  if (totalDeployed !== 0n || approvedProtocolCount !== 0n || approvedAssetCount !== 0n || approvedStrategyCount !== 0n) {
    throw new Error('Supplied Core is not in the expected zero-deployed, zero-approval initial state.');
  }

  return {
    address: config.core,
    bytecodePresent: true,
    usdc: coreUsdc,
    timelockDelay: timelockDelay.toString(),
    totalDeployed: totalDeployed.toString(),
    valuationFreshnessBlocks: freshness.toString(),
    approvedProtocolCount: approvedProtocolCount.toString(),
    approvedAssetCount: approvedAssetCount.toString(),
    approvedStrategyCount: approvedStrategyCount.toString(),
  };
}

async function main(): Promise<void> {
  const config = loadArcMainnetSteakhouseAdapterDeploymentConfig();
  const corePolicyConfig = loadArcMainnetCoreDeploymentConfig();

  if (hre.network.name !== config.network) {
    throw new Error(`Refusing deployment on ${hre.network.name}; expected ${config.network}.`);
  }

  const network = await hre.ethers.provider.getNetwork();
  if (Number(network.chainId) !== Number(config.chainId)) {
    throw new Error(`Refusing deployment on chain ${network.chainId}; expected ${config.chainId.toString()}.`);
  }

  const coreTargetValidation = await verifyCoreTarget(config, corePolicyConfig);

  if (process.env.ALLOW_DEPLOYMENT !== '1') {
    console.log(JSON.stringify({
      mode: 'deployment-input-and-core-validation-only',
      contract: EXPECTED_CONTRACT,
      network: config.network,
      chainId: network.chainId.toString(),
      vault: config.vault,
      core: config.core,
      coreTargetValidation,
      protocolId: config.protocolId,
      usdc: config.usdc,
      constructorArgs: config.constructorArgs,
      deploymentAttempted: false,
      transactionSent: false,
      adapterLiveVerification: 'NOT_PERFORMED',
    }, null, 2));
    return;
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error('No deployer signer is configured. Use the existing DEPLOYER_PRIVATE_KEY environment mechanism.');
  }

  const factory = await hre.ethers.getContractFactory(EXPECTED_CONTRACT, deployer);
  const adapter = await factory.deploy(...config.constructorArgs);
  await adapter.waitForDeployment();

  const deployedAddress = await adapter.getAddress();
  const adapterCode = await hre.ethers.provider.getCode(deployedAddress);
  if (adapterCode === '0x') throw new Error('Deployed Adapter address has no contract bytecode.');

  const instance = await hre.ethers.getContractAt(EXPECTED_CONTRACT, deployedAddress, deployer);
  const [asset, protocolId, core, vault] = await Promise.all([
    instance.asset(),
    instance.protocol(),
    instance.core(),
    instance.vault(),
  ]);
  assertAdapterDeploymentReadbackMatchesConfig(config, { asset, protocolId, core, vault });

  console.log(JSON.stringify({
    mode: 'deployment-verification',
    contract: EXPECTED_CONTRACT,
    network: config.network,
    chainId: network.chainId.toString(),
    vault: config.vault,
    core: config.core,
    protocolId: config.protocolId,
    usdc: config.usdc,
    constructorArgs: config.constructorArgs,
    deployedAddress,
    adapterBytecodePresent: true,
    checks: {
      asset,
      protocolId,
      core,
      vault,
      immutableCoreMatchesSuppliedFinalCore: true,
    },
    deploymentAttempted: true,
    transactionSent: true,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
