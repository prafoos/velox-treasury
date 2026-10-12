import { expect } from 'chai';
import {
  ARC_TESTNET,
  ARC_TESTNET_REHEARSAL_ROLES,
  loadArcTestnetRehearsalConfig,
  validateArcTestnetRehearsalRoles,
} from '../scripts/arc-testnet-rehearsal';

function validEnvironment() {
  return {
    ARC_REHEARSAL_NETWORK: 'arc-testnet',
    ARC_REHEARSAL_CHAIN_ID: '5042002',
    ARC_REHEARSAL_RPC_URL: 'https://rpc.testnet.arc.io',
    ARC_REHEARSAL_MINIMUM_LIQUID_RESERVE: '2000000',
    ARC_REHEARSAL_SURPLUS_SWEEP_THRESHOLD: '5000000',
    ARC_REHEARSAL_DAILY_OUTFLOW_CAP: '6000000',
    ARC_REHEARSAL_MAXIMUM_SINGLE_WITHDRAWAL: '4000000',
    ARC_REHEARSAL_AUTOMATED_SWEEP_ENABLED: 'true',
    ARC_REHEARSAL_LIQUID_OPERATIONAL_RESERVE_BPS: '4000',
    ARC_REHEARSAL_YIELD_STRATEGY_BUFFER_BPS: '3000',
    ARC_REHEARSAL_SWAP_LIQUIDITY_BUFFER_BPS: '2000',
    ARC_REHEARSAL_AUTOMATION_AGENT_POOL_BPS: '1000',
  };
}

describe('Arc Testnet rehearsal configuration', () => {
  it('accepts only the official Testnet network and six-decimal ERC-20 policy inputs', async () => {
    const config = loadArcTestnetRehearsalConfig(validEnvironment());
    expect(config.network).to.equal(ARC_TESTNET);
    expect(config.roles).to.equal(ARC_TESTNET_REHEARSAL_ROLES);
    expect(config.network.usdc.decimals).to.equal(6);
    expect(config.network.nativeCurrency.decimals).to.equal(18);
    expect(config.policy.minimumLiquidReserve).to.equal(2_000_000n);
  });

  it('rejects Mainnet and non-official RPC selections', async () => {
    const environment = validEnvironment();
    expect(() => loadArcTestnetRehearsalConfig({ ...environment, ARC_REHEARSAL_NETWORK: 'arc-mainnet' }))
      .to.throw('Rehearsal is restricted to arc-testnet');
    expect(() => loadArcTestnetRehearsalConfig({ ...environment, ARC_REHEARSAL_RPC_URL: 'https://rpc.mainnet.arc.io' }))
      .to.throw('official Arc Testnet RPC URL');
  });

  it('validates the configured public role map and rejects invalid role/policy/allocation bounds', () => {
    expect(validateArcTestnetRehearsalRoles(ARC_TESTNET_REHEARSAL_ROLES)).to.equal(ARC_TESTNET_REHEARSAL_ROLES);
    expect(() => validateArcTestnetRehearsalRoles({ ...ARC_TESTNET_REHEARSAL_ROLES, pauser: ARC_TESTNET_REHEARSAL_ROLES.governance }))
      .to.throw('must be distinct');
    expect(() => validateArcTestnetRehearsalRoles({ ...ARC_TESTNET_REHEARSAL_ROLES, pauser: '0x0000000000000000000000000000000000000000' }))
      .to.throw('Invalid controlled rehearsal address');
    const environment = validEnvironment();
    expect(() => loadArcTestnetRehearsalConfig({ ...environment, ARC_REHEARSAL_MAXIMUM_SINGLE_WITHDRAWAL: '6000001' }))
      .to.throw('cannot exceed');
    expect(() => loadArcTestnetRehearsalConfig({ ...environment, ARC_REHEARSAL_AUTOMATION_AGENT_POOL_BPS: '999' }))
      .to.throw('exactly 10000 bps');
  });
});
