import hre from 'hardhat';
import { isAddress, ZeroAddress } from 'ethers';
import { isRetiredArcMainnetAddress } from './address-safety';
import {
  ARC_MAINNET_CORE_CHAIN_ID,
  ARC_MAINNET_CORE_NETWORK,
  ARC_MAINNET_CORE_USDC,
  loadArcMainnetCoreDeploymentConfig,
  requireConfiguredInitialPolicyValue,
} from './arc-mainnet-core-deployment-config';

const EXPECTED_CONTRACT = 'VeloxTreasuryCore';

async function main(): Promise<void> {
  const config = loadArcMainnetCoreDeploymentConfig();
  if (hre.network.name !== ARC_MAINNET_CORE_NETWORK) {
    throw new Error(`Refusing deployment on ${hre.network.name}; expected ${ARC_MAINNET_CORE_NETWORK}.`);
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== ARC_MAINNET_CORE_CHAIN_ID) {
    throw new Error(`Refusing deployment on chain ${network.chainId}; expected ${ARC_MAINNET_CORE_CHAIN_ID}.`);
  }
  if (config.usdc.toLowerCase() !== ARC_MAINNET_CORE_USDC.toLowerCase()) {
    throw new Error('Refusing deployment because the configured USDC address is not official Arc Mainnet USDC.');
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('No deployer signer is configured. Use the existing DEPLOYER_PRIVATE_KEY environment mechanism.');
  const deployerAddress = await deployer.getAddress();
  if (!isAddress(deployerAddress) || deployerAddress.toLowerCase() === ZeroAddress) throw new Error('Invalid deployer address.');

  const initialState = config.initialState;
  const initialRiskPolicy = [
    requireConfiguredInitialPolicyValue('minimumLiquidReserve', initialState.minimumLiquidReserve),
    requireConfiguredInitialPolicyValue('minimumLiquidReserveBps', initialState.minimumLiquidReserveBps),
    requireConfiguredInitialPolicyValue('maximumTotalDeployed', initialState.maximumTotalDeployed),
  ];
  const initialBucketPolicy = [
    requireConfiguredInitialPolicyValue('bucketPolicy.liquidOperationalReserveBps', initialState.bucketPolicy.liquidOperationalReserveBps),
    requireConfiguredInitialPolicyValue('bucketPolicy.yieldStrategyBufferBps', initialState.bucketPolicy.yieldStrategyBufferBps),
    requireConfiguredInitialPolicyValue('bucketPolicy.sweepLiquidityBufferBps', initialState.bucketPolicy.sweepLiquidityBufferBps),
    requireConfiguredInitialPolicyValue('bucketPolicy.automationAgentPoolBps', initialState.bucketPolicy.automationAgentPoolBps),
  ];
  const initialValuationFreshnessBlocks = requireConfiguredInitialPolicyValue(
    'valuationFreshnessBlocks',
    initialState.valuationFreshnessBlocks,
  );
  const initialTimelockDelay = requireConfiguredInitialPolicyValue('timelockDelay', initialState.timelockDelay);

  const factory = await hre.ethers.getContractFactory(EXPECTED_CONTRACT, deployer);
  const treasury = await factory.deploy(...config.roleConstructorArgs, initialRiskPolicy, initialBucketPolicy, initialValuationFreshnessBlocks);
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();

  if (isRetiredArcMainnetAddress(treasuryAddress)) {
    throw new Error('Deployment resolved to a retired deployment address.');
  }
  if ((await hre.ethers.provider.getCode(treasuryAddress)) === '0x') {
    throw new Error('Deployment address has no contract bytecode.');
  }

  const deployed = await hre.ethers.getContractAt(EXPECTED_CONTRACT, treasuryAddress, deployer);
  const roleNames = {
    DEFAULT_ADMIN_ROLE: await deployed.DEFAULT_ADMIN_ROLE(),
    POLICY_ADMIN_ROLE: await deployed.POLICY_ADMIN_ROLE(),
    TIMELOCK_EXECUTOR_ROLE: await deployed.TIMELOCK_EXECUTOR_ROLE(),
    AUTOMATION_ROLE: await deployed.AUTOMATION_ROLE(),
    EMERGENCY_ROLE: await deployed.EMERGENCY_ROLE(),
  } as const;
  const expectedRoles = {
    DEFAULT_ADMIN_ROLE: config.roles.governance,
    POLICY_ADMIN_ROLE: config.roles.policyAdmin,
    TIMELOCK_EXECUTOR_ROLE: config.roles.timelockExecutor,
    AUTOMATION_ROLE: config.roles.automationExecutor,
    EMERGENCY_ROLE: config.roles.emergency,
  } as const;

  for (const [roleName, roleHash] of Object.entries(roleNames)) {
    const holder = expectedRoles[roleName as keyof typeof expectedRoles];
    if (!(await deployed.hasRole(roleHash, holder))) throw new Error(`${roleName} was not granted to the configured holder.`);
  }

  const policy = await deployed.riskPolicy();
  const usdcAddress = await deployed.usdc();
  const paused = await deployed.paused();
  const totalLiabilities = await deployed.totalUserLiabilities();
  const totalDeployed = await deployed.totalDeployed();
  const requiredReserve = await deployed.requiredLiquidReserve();
  const configuredBucketPolicy = await deployed.bucketPolicy();
  const valuationFreshnessBlocks = await deployed.valuationFreshnessBlocks();
  const timelockDelay = await deployed.TIMELOCK_DELAY();
  const zeroProtocolCap = await deployed.protocolCaps(hre.ethers.ZeroHash);
  const usdcAssetCap = await deployed.assetCaps(config.usdc);
  const zeroStrategy = await deployed.strategies(ZeroAddress);
  const approvedProtocolCount = await deployed.approvedProtocolCount();
  const approvedAssetCount = await deployed.approvedAssetCount();
  const approvedStrategyCount = await deployed.approvedStrategyCount();

  if (usdcAddress.toLowerCase() !== ARC_MAINNET_CORE_USDC.toLowerCase()) throw new Error('Verified contract USDC address mismatch.');
  if (paused) throw new Error('Verified contract is unexpectedly paused.');
  if (totalLiabilities !== 0n) throw new Error('Verified contract has unexpected user liabilities.');
  if (totalDeployed !== 0n) throw new Error('Verified contract has unexpected deployed amount.');
  if (requiredReserve !== initialRiskPolicy[0]) throw new Error('Verified contract initial required reserve mismatch.');
  if (policy.minimumLiquidReserve !== initialRiskPolicy[0]) throw new Error('Initial minimum reserve mismatch.');
  if (policy.minimumLiquidReserveBps !== BigInt(initialRiskPolicy[1])) throw new Error('Initial liquidity requirement mismatch.');
  if (policy.maximumTotalDeployed !== initialRiskPolicy[2]) throw new Error('Initial deployment cap mismatch.');
  if (configuredBucketPolicy.liquidOperationalReserveBps !== BigInt(initialBucketPolicy[0])) throw new Error('Liquid Operational Reserve mismatch.');
  if (configuredBucketPolicy.yieldStrategyBufferBps !== BigInt(initialBucketPolicy[1])) throw new Error('Yield Strategy Buffer mismatch.');
  if (configuredBucketPolicy.sweepLiquidityBufferBps !== BigInt(initialBucketPolicy[2])) throw new Error('Sweep Liquidity Buffer mismatch.');
  if (configuredBucketPolicy.automationAgentPoolBps !== BigInt(initialBucketPolicy[3])) throw new Error('Automation / AI Agent Pool mismatch.');
  if (valuationFreshnessBlocks !== initialValuationFreshnessBlocks) throw new Error('Valuation freshness mismatch.');
  if (timelockDelay !== initialTimelockDelay) throw new Error('Timelock delay mismatch.');
  if (approvedProtocolCount !== 0n || approvedAssetCount !== 0n || approvedStrategyCount !== 0n) {
    throw new Error('Initial allowlist state is not empty.');
  }
  if (zeroProtocolCap.approved || zeroProtocolCap.enabled || usdcAssetCap.approved || usdcAssetCap.enabled || zeroStrategy.approved || zeroStrategy.enabled) {
    throw new Error('Initial representative allowlist entries are not empty.');
  }

  console.log(JSON.stringify({
    mode: 'deployment-and-post-deployment-verification',
    contract: EXPECTED_CONTRACT,
    network: config.network,
    chainId: network.chainId.toString(),
    usdc: usdcAddress,
    deployer: deployerAddress,
    roles: expectedRoles,
    roleConstructorArgs: config.roleConstructorArgs,
    resultingContractAddress: treasuryAddress,
    verification: {
      paused,
      totalUserLiabilities: totalLiabilities.toString(),
      totalDeployed: totalDeployed.toString(),
      requiredLiquidReserve: requiredReserve.toString(),
      minimumLiquidReserve: policy.minimumLiquidReserve.toString(),
      minimumLiquidReserveBps: policy.minimumLiquidReserveBps.toString(),
      maximumTotalDeployed: policy.maximumTotalDeployed.toString(),
      bucketPolicy: {
        liquidOperationalReserveBps: configuredBucketPolicy.liquidOperationalReserveBps.toString(),
        yieldStrategyBufferBps: configuredBucketPolicy.yieldStrategyBufferBps.toString(),
        sweepLiquidityBufferBps: configuredBucketPolicy.sweepLiquidityBufferBps.toString(),
        automationAgentPoolBps: configuredBucketPolicy.automationAgentPoolBps.toString(),
      },
      valuationFreshnessBlocks: valuationFreshnessBlocks.toString(),
      timelockDelay: timelockDelay.toString(),
      allowlistsEmpty: true,
      approvedProtocolCount: approvedProtocolCount.toString(),
      approvedAssetCount: approvedAssetCount.toString(),
      approvedStrategyCount: approvedStrategyCount.toString(),
    },
    postDeploymentPolicyTransactionSent: false,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
