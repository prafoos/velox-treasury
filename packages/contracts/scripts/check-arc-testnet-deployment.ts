import { validateArcTestnetDeploymentConfig, ARC_TESTNET_DEPLOYMENT } from './arc-testnet-deployment-config';

const config = validateArcTestnetDeploymentConfig(ARC_TESTNET_DEPLOYMENT);
console.log(
  `Validated Arc Testnet deployment configuration for chain ${config.chainId}; no deployment or transaction was attempted.`,
);
