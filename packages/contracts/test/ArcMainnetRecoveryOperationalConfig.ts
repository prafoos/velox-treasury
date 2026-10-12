import { expect } from 'chai';
import { RETIRED_ARC_MAINNET_ADDRESSES, CURRENT_LIVE_ARC_MAINNET_REFERENCES } from '../scripts/address-safety';

const recoverySafety = require('../scripts/arc-mainnet-recovery-operational-config.js') as {
  assertArcMainnetChain(chainId: number | string | bigint): void;
  assertCurrentCore(core: string): void;
  assertCurrentRecoveryTargets(core: string, adapter: string): void;
};

describe('Arc Mainnet read-only recovery target guards', () => {
  it('accepts only the explicitly current live Core and Adapter pair on chain 5042', () => {
    expect(() => recoverySafety.assertArcMainnetChain(5_042)).not.to.throw();
    expect(CURRENT_LIVE_ARC_MAINNET_REFERENCES.core).to.equal('0x3D1D1620E5Dd0DEA146bB5cEC8b4954e0ec210B7');
    expect(() => recoverySafety.assertCurrentRecoveryTargets(
      CURRENT_LIVE_ARC_MAINNET_REFERENCES.core,
      CURRENT_LIVE_ARC_MAINNET_REFERENCES.adapter,
    )).not.to.throw();
  });

  it('rejects all retired addresses as Core or Adapter recovery targets', () => {
    for (const address of Object.values(RETIRED_ARC_MAINNET_ADDRESSES)) {
      expect(() => recoverySafety.assertCurrentCore(address)).to.throw();
      expect(() => recoverySafety.assertCurrentRecoveryTargets(
        CURRENT_LIVE_ARC_MAINNET_REFERENCES.core,
        address,
      )).to.throw();
    }
    expect(() => recoverySafety.assertCurrentCore(RETIRED_ARC_MAINNET_ADDRESSES.legacyCoreReference)).to.throw();
  });

  it('rejects a non-Arc chain and exposes no retired Core fallback', () => {
    expect(() => recoverySafety.assertArcMainnetChain(1)).to.throw('requires Arc Mainnet chain ID 5042');
    expect(recoverySafety.CURRENT_CORE).to.equal(CURRENT_LIVE_ARC_MAINNET_REFERENCES.core);
  });
});