export const CURRENT_LIVE_ARC_MAINNET_REFERENCES = {
  core: '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7',
  adapter: '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86',
} as const;

export const RETIRED_ARC_MAINNET_ADDRESSES = {
  treasury: '0x3033876A3283d0B4CCCAE9C2D562915ca369d9C6',
  core: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
  legacyCoreReference: '0x2D7637937e71cbdfC8a8771f644aEbEC5A6d0d2e',
  adapter: '0xE886A619584a1fF017E744D5B55F0D5dc59018c4',
} as const;

export const RETIRED_TREASURY_ADDRESS = RETIRED_ARC_MAINNET_ADDRESSES.treasury;

export function isRetiredArcMainnetAddress(address: string): boolean {
  const candidate = address.trim().toLowerCase();
  return Object.values(RETIRED_ARC_MAINNET_ADDRESSES)
    .some((retiredAddress) => retiredAddress.toLowerCase() === candidate);
}