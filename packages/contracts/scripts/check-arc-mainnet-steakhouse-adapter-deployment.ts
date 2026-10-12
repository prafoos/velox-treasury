import {
  CURRENT_LIVE_CORE_REFERENCE,
  loadArcMainnetSteakhouseAdapterDeploymentConfig,
} from './arc-mainnet-steakhouse-adapter-deployment-config';

const suppliedCore = process.env.ARC_MAINNET_FINAL_CORE_ADDRESS;

try {
  const config = loadArcMainnetSteakhouseAdapterDeploymentConfig();
  console.log(JSON.stringify({
    mode: 'static-validation-only',
    contract: 'SteakhousePrimeUSDCAdapter',
    network: config.network,
    chainId: config.chainId.toString(),
    rpcUrl: config.rpcUrl,
    coreInput: { status: 'CONFIGURED', value: config.core, purpose: config.purpose },
    currentLiveCoreReference: CURRENT_LIVE_CORE_REFERENCE,
    vault: config.vault,
    protocolId: config.protocolId,
    usdc: config.usdc,
    constructorArgs: config.constructorArgs,
    coreBytecodeCheck: 'NOT_PERFORMED',
    adapterLiveVerification: 'NOT_PERFORMED',
    deploymentAttempted: false,
    transactionSent: false,
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    mode: 'static-validation-only',
    contract: 'SteakhousePrimeUSDCAdapter',
    network: 'arcMainnet',
    chainId: '5042',
    coreInput: {
      status: suppliedCore === undefined || suppliedCore.trim() === '' ? 'UNAVAILABLE' : 'INVALID',
      environmentVariable: 'ARC_MAINNET_FINAL_CORE_ADDRESS',
    },
    currentLiveCoreReference: CURRENT_LIVE_CORE_REFERENCE,
    validationError: error instanceof Error ? error.message : String(error),
    coreBytecodeCheck: 'NOT_PERFORMED',
    adapterLiveVerification: 'NOT_PERFORMED',
    deploymentAttempted: false,
    transactionSent: false,
  }, null, 2));
  process.exitCode = 1;
}