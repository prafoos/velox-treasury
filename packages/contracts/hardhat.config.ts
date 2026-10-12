import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import { config as loadEnv } from 'dotenv';
import type { HardhatUserConfig } from 'hardhat/config';
import { subtask } from 'hardhat/config';
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from 'hardhat/builtin-tasks/task-names';
import path from 'node:path';

loadEnv({ path: path.join(__dirname, '.env') });
loadEnv({ path: path.join(__dirname, '..', '..', '.env.example') });

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async (taskArguments, _, runSuper) => {
  if (taskArguments.solcVersion === '0.8.28') {
    return {
      compilerPath: require.resolve('solc/soljson.js'),
      isSolcJs: true,
      version: '0.8.28',
      longVersion: '0.8.28+commit.7893614a',
    };
  }
  return runSuper();
});

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {},
    arcTestnet: {
      url: 'https://rpc.testnet.arc.io',
      chainId: 5_042_002,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    arcMainnet: {
      url: 'https://rpc.mainnet.arc.io',
      chainId: 5_042,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  solidity: {
    compilers: [{
      version: '0.8.28',
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
      },
    }],
    overrides: {
      'contracts/VeloxTreasuryCore.sol': {
        version: '0.8.28',
        settings: {
          viaIR: true,
          metadata: { bytecodeHash: 'none' },
          optimizer: { enabled: true, runs: 1 },
        },
      },
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    artifacts: './artifacts',
    cache: './cache',
  },
};

export default config;
