export const ARC_MAINNET_CURRENT_LIVE_REFERENCES = {
  core: '0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7',
  adapter: '0xac5aB6e98d281f49B87Bf943A248Ff8559d9Ed86',
} as const;

export const ARC_MAINNET_CORE_ROLE_HOLDERS = {
  governance: '0x37ab81b0b9C326F91426E57aa2E2D9273EF16F06',
  policyAdmin: '0xeE55Baf61e6727FC48b141a10f0AB7A14aE0E9Df',
  timelockExecutor: '0x7bb9655B227E6d47f8B929a0bd6261fa4063df4c',
  automationExecutor: '0x0ebad7ecda409d72aacc529efd46077d1cf012be',
  emergency: '0x616647825Fc3cf69E5e7c5E474fF49a71FFB2596',
} as const;

export const ARC_MAINNET_RETIRED_ADDRESSES = {
  treasury: '0x3033876A3283d0B4CCCAE9C2D562915ca369d9C6',
  core: '0xcc058cFcC77061Ff1c47DbA50dF064B75053aC27',
  legacyCoreReference: '0x2D7637937e71cbdfC8a8771f644aEbEC5A6d0d2e',
  adapter: '0xE886A619584a1fF017E744D5B55F0D5dc59018c4',
} as const;

export function isRetiredArcMainnetAddress(address: string): boolean {
  const candidate = address.trim().toLowerCase();
  return Object.values(ARC_MAINNET_RETIRED_ADDRESSES)
    .some((retiredAddress) => retiredAddress.toLowerCase() === candidate);
}