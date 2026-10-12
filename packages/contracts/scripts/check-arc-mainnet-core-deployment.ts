import {
  assessInitialPolicyConfiguration,
  createArcMainnetCoreDeploymentConfig,
  validateArcMainnetCoreDeploymentConfig,
} from './arc-mainnet-core-deployment-config';

const config = createArcMainnetCoreDeploymentConfig();
const policyAssessment = assessInitialPolicyConfiguration(config.initialState);
const toJsonValue = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toJsonValue(nested)]));
  }
  return value;
};
const show = <T>(configured: { status: 'CONFIGURED'; value: T } | { status: 'UNAVAILABLE'; reason: string }) =>
  configured.status === 'CONFIGURED'
    ? { status: configured.status, value: toJsonValue(configured.value) }
    : configured;
let validationError: string | undefined;
try {
  validateArcMainnetCoreDeploymentConfig(config);
} catch (error) {
  validationError = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify({
  mode: 'static-validation-only',
  contract: 'VeloxTreasuryCore',
  network: config.network,
  chainId: config.chainId.toString(),
  rpcUrl: config.rpcUrl,
  usdc: config.usdc,
  roles: config.roles,
  roleConstructorArgs: config.roleConstructorArgs,
  preflightStatus: validationError ? 'BLOCKED' : 'PASS',
  initialPolicyStatus: policyAssessment.status,
  initialPolicyUnavailable: policyAssessment.unavailable,
  initialPolicyInvalid: policyAssessment.invalid,
  bucketPolicyDeploymentStatus: 'ADMIN-CONFIGURED-LATER / UNAVAILABLE',
  initialState: {
    minimumLiquidReserve: show(config.initialState.minimumLiquidReserve),
    minimumLiquidReserveBps: show(config.initialState.minimumLiquidReserveBps),
    maximumTotalDeployed: show(config.initialState.maximumTotalDeployed),
    timelockDelay: show(config.initialState.timelockDelay),
    bucketPolicy: {
      liquidOperationalReserveBps: show(config.initialState.bucketPolicy.liquidOperationalReserveBps),
      yieldStrategyBufferBps: show(config.initialState.bucketPolicy.yieldStrategyBufferBps),
      sweepLiquidityBufferBps: show(config.initialState.bucketPolicy.sweepLiquidityBufferBps),
      automationAgentPoolBps: show(config.initialState.bucketPolicy.automationAgentPoolBps),
    },
    valuationFreshnessBlocks: show(config.initialState.valuationFreshnessBlocks),
    exposureCaps: {
      strategy: show(config.initialState.exposureCaps.strategy),
      protocol: show(config.initialState.exposureCaps.protocol),
      asset: show(config.initialState.exposureCaps.asset),
    },
  },
  validationError,
  deploymentAttempted: false,
  transactionSent: false,
}, null, 2));
if (validationError) process.exitCode = 1;
