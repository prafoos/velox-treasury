import hre from 'hardhat';
import { isAddress, ZeroAddress } from 'ethers';
import { ARC_TESTNET_DEPLOYMENT } from './arc-testnet-deployment-config';

const EXPECTED_NETWORK = 'arcTestnet';
const EXPECTED_CHAIN_ID = 5_042_002n;
const EXPECTED_USDC = '0x3600000000000000000000000000000000000000';

function assertRoleAddresses(): void {
  const roles = ARC_TESTNET_DEPLOYMENT.roles;
  for (const [role, address] of Object.entries(roles)) {
    if (!isAddress(address) || address.toLowerCase() === ZeroAddress) {
      throw new Error(`Invalid Arc Testnet ${role} address.`);
    }
  }

  if (new Set(Object.values(roles).map((address) => address.toLowerCase())).size !== 4) {
    throw new Error('Arc Testnet role addresses must be distinct.');
  }
}

function constructorArguments(): [string, string, string, string, string] {
  const { constructor: values, roles } = ARC_TESTNET_DEPLOYMENT;
  const args: [string, string, string, string, string] = [
    values.usdc,
    values.governance,
    values.policyAdmin,
    values.pauser,
    values.withdrawer,
  ];

  if (
    args[0] !== EXPECTED_USDC
    || args[0] !== ARC_TESTNET_DEPLOYMENT.usdc.address
    || args[1] !== roles.governance
    || args[2] !== roles.policyAdmin
    || args[3] !== roles.pauser
    || args[4] !== roles.withdrawer
  ) {
    throw new Error('Arc Testnet constructor arguments do not match the validated role map and USDC address.');
  }

  return args;
}

async function main(): Promise<void> {
  if (hre.network.name !== EXPECTED_NETWORK) {
    throw new Error(`Refusing deployment on unexpected network: ${hre.network.name}.`);
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Refusing deployment on chain ${network.chainId}; expected ${EXPECTED_CHAIN_ID}.`);
  }

  if (ARC_TESTNET_DEPLOYMENT.rpcUrl !== 'https://rpc.testnet.arc.io') {
    throw new Error('Refusing deployment because the configured RPC is not Arc Testnet.');
  }
  if (ARC_TESTNET_DEPLOYMENT.usdc.address !== EXPECTED_USDC) {
    throw new Error('Refusing deployment because the configured USDC address is unexpected.');
  }

  assertRoleAddresses();
  const args = constructorArguments();
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error('No external deployer signer is configured.');
  }

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