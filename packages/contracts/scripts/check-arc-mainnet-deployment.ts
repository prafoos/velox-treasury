import { loadArcMainnetDeploymentConfig } from './arc-mainnet-deployment-config';

const config = loadArcMainnetDeploymentConfig();
console.log(
  `Validated Arc Mainnet deployment configuration for chain ${config.chainId}; no deployment or transaction was attempted.`,
);
