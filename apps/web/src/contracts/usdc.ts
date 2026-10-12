import { isAddress, type Address } from 'viem';

/**
 * Arc Mainnet Chain ID (EIP-155: 5042).
 */
export const ARC_MAINNET_CHAIN_ID = 5042 as const;

/**
 * Officially verified Native USDC ERC-20 contract address on Arc Mainnet.
 * Source: Official Circle developer documentation and Arc network specification.
 * 
 * Address: 0x3600000000000000000000000000000000000000
 */
export const ARC_USDC_CONTRACT_ADDRESS: Address =
  '0x3600000000000000000000000000000000000000' as const;

/**
 * Native USDC ERC-20 token decimals on Arc Mainnet.
 * Note: While Arc gas accounting uses 18 decimals internally,
 * the ERC-20 contract interface strictly uses 6 decimals.
 */
export const ARC_USDC_DECIMALS = 6 as const;
export const ARC_USDC_SYMBOL = 'USDC' as const;
export const ARC_USDC_NAME = 'USDC' as const;

if (!isAddress(ARC_USDC_CONTRACT_ADDRESS)) {
  throw new Error(`Invalid Arc USDC contract address configured: ${ARC_USDC_CONTRACT_ADDRESS}`);
}

/**
 * Standard ERC-20 ABI restricted strictly to read operations.
 * Write operations and transaction submission are isolated to prevent unauthorized transactions.
 */
export const usdcReadAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** Exact-amount approval ABI for the guarded Treasury deposit path. */
export const usdcWriteAbi = [
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const usdcContractConfig = {
  address: ARC_USDC_CONTRACT_ADDRESS,
  abi: usdcReadAbi,
  chainId: ARC_MAINNET_CHAIN_ID,
} as const;
