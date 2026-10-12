import { zeroAddress, type Address, type Hash } from 'viem';

export const STEAKHOUSE_CORE_ADDRESS: Address = '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7';
export const STEAKHOUSE_POLICY_ADMIN_ADDRESS: Address = '0xeE55Baf61e6727FC48b141a10f0AB7A14aE0E9Df';
export const STEAKHOUSE_PROTOCOL_ID: `0x${string}` =
  '0x7347374483c6aab1ba2d51afa8ad4aeab1810c57e9c27e657adff58eb13f6450';
export const STEAKHOUSE_VAULT_ADDRESS: Address = '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298';

export type ProtocolVaultMappingReceipt = {
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
};

export type ConfigureProtocolVaultPorts = {
  readonly chainId: number;
  readonly accountAddress: Address;
  readonly readPolicyAdminRole: () => Promise<boolean>;
  readonly readProtocolVault: () => Promise<Address>;
  readonly submit: () => Promise<Hash>;
  readonly waitForReceipt: (hash: Hash) => Promise<ProtocolVaultMappingReceipt>;
};

export async function configureSteakhouseProtocolVault(
  ports: ConfigureProtocolVaultPorts,
): Promise<{ readonly hash: Hash; readonly blockNumber: bigint }> {
  if (ports.chainId !== 5042) throw new Error('Protocol-vault configuration requires Arc Mainnet (chain ID 5042).');
  if (ports.accountAddress.toLowerCase() !== STEAKHOUSE_POLICY_ADMIN_ADDRESS.toLowerCase()) {
    throw new Error('Connect the configured Steakhouse POLICY_ADMIN_ROLE wallet.');
  }
  if (!await ports.readPolicyAdminRole()) {
    throw new Error('Connected wallet does not have POLICY_ADMIN_ROLE on the target Core.');
  }
  if ((await ports.readProtocolVault()).toLowerCase() !== zeroAddress) {
    throw new Error('Protocol-vault mapping is already configured; refusing to overwrite it.');
  }

  const hash = await ports.submit();
  const receipt = await ports.waitForReceipt(hash);
  if (receipt.status !== 'success') throw new Error('configureProtocolVault transaction failed or was reverted.');

  const mappedVault = await ports.readProtocolVault();
  if (mappedVault.toLowerCase() !== STEAKHOUSE_VAULT_ADDRESS.toLowerCase()) {
    throw new Error('Core protocolVaults readback does not match the Steakhouse Vault.');
  }

  return { hash, blockNumber: receipt.blockNumber };
}
