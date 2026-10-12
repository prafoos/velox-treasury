import hre from 'hardhat';
import { isAddress, ZeroAddress } from 'ethers';
import { assertLegacyMainnetDeploymentOptIn, loadArcMainnetDeploymentConfig } from './arc-mainnet-deployment-config';

const EXPECTED_NETWORK = 'arcMainnet';
const EXPECTED_CHAIN_ID = 5_042n;
const EXPECTED_USDC = '0x3600000000000000000000000000000000000000';

function assertRoleAddresses(roles: ReturnType<typeof loadArcMainnetDeploymentConfig>['roles']): void {
  for (const [role, address] of Object.entries(roles)) {
    if (!isAddress(address) || address.toLowerCase() === ZeroAddress) {
      throw new Error(`Invalid Arc Mainnet ${role} address.`);
    }
  }
  if (new Set(Object.values(roles).map((address) => address.toLowerCase())).size !== 4) {
    throw new Error('Arc Mainnet role addresses must be distinct.');
  }
}

async function main(): Promise<void> {
  assertLegacyMainnetDeploymentOptIn();
  const config = loadArcMainnetDeploymentConfig();
  if (hre.network.name !== EXPECTED_NETWORK) throw new Error(`Refusing deployment on unexpected network: ${hre.network.name}.`);

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Refusing deployment on chain ${network.chainId}; expected ${EXPECTED_CHAIN_ID}.`);
  }
  if (config.usdc.address !== EXPECTED_USDC || config.constructor.usdc !== config.usdc.address) {
    throw new Error('Refusing deployment because the configured USDC address is unexpected.');
  }

  assertRoleAddresses(config.roles);
  const args: [string, string, string, string, string] = [
    config.constructor.usdc,
    config.constructor.governance,
    config.constructor.policyAdmin,
    config.constructor.pauser,
    config.constructor.withdrawer,
  ];
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('No external deployer signer is configured.');

  const factory = await hre.ethers.getContractFactory('VeloxTreasury', deployer);
  const treasury = await factory.deploy(...args);
  await treasury.waitForDeployment();
  console.log(`VeloxTreasury deployed to ${await treasury.getAddress()}`);
  console.log(`Deployer: ${await deployer.getAddress()}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
