import { describe, expect, it } from 'vitest';
import {
  ARC_MAINNET_CURRENT_LIVE_REFERENCES,
  ARC_MAINNET_RETIRED_ADDRESSES,
  isRetiredArcMainnetAddress,
} from './treasury-addresses';

describe('Arc Mainnet contract address classification', () => {
  it('keeps current live Core and Adapter distinct from retired targets', () => {
    expect(ARC_MAINNET_CURRENT_LIVE_REFERENCES.core).toBe('0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7');
    expect(isRetiredArcMainnetAddress(ARC_MAINNET_CURRENT_LIVE_REFERENCES.core)).toBe(false);
    expect(isRetiredArcMainnetAddress(ARC_MAINNET_CURRENT_LIVE_REFERENCES.adapter)).toBe(false);
  });

  it('recognizes retired addresses case-insensitively', () => {
    for (const address of Object.values(ARC_MAINNET_RETIRED_ADDRESSES)) {
      expect(isRetiredArcMainnetAddress(address)).toBe(true);
      expect(isRetiredArcMainnetAddress(address.toUpperCase())).toBe(true);
    }
  });

  it('retains the former live Core reference only as a retired historical address', () => {
    const formerReference = '0x2D7637937e71cbdfC8a8771f644aEbEC5A6d0d2e';
    expect(ARC_MAINNET_RETIRED_ADDRESSES.legacyCoreReference).toBe(formerReference);
    expect(ARC_MAINNET_CURRENT_LIVE_REFERENCES.core).not.toBe(formerReference);
    expect(isRetiredArcMainnetAddress(formerReference)).toBe(true);
  });
});