export async function buildStrategyUnwindPlan(input: {
  readonly availableShares: bigint;
  readonly requiredAssets: bigint;
  readonly previewRedeem: (shares: bigint) => Promise<bigint>;
}): Promise<bigint> {
  if (input.availableShares <= 0n) {
    throw new Error('No authoritative user strategy shares are available to unwind.');
  }
  if (input.requiredAssets <= 0n) {
    throw new Error('A positive strategy unwind amount is required.');
  }

  const availableValue = await input.previewRedeem(input.availableShares);
  if (availableValue < input.requiredAssets) {
    throw new Error('Your authoritative strategy share position cannot cover the required liquidity.');
  }

  let low = 1n;
  let high = input.availableShares;
  while (low < high) {
    const middle = low + (high - low) / 2n;
    const preview = await input.previewRedeem(middle);
    if (preview >= input.requiredAssets) high = middle;
    else low = middle + 1n;
  }

  return low;
}
