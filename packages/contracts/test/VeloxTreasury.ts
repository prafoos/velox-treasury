import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';

const USDC = 1_000_000n;
const TEN_USDC = 10n * USDC;

async function deployTreasury() {
  const [governance, policyAdmin, pauser, withdrawer, user, recipient, outsider] = await ethers.getSigners();
  const token = await ethers.deployContract('MockUSDC');
  const treasury = await ethers.deployContract('VeloxTreasury', [await token.getAddress(), governance.address, policyAdmin.address, pauser.address, withdrawer.address]);
  return { governance, policyAdmin, pauser, withdrawer, user, recipient, outsider, token, treasury };
}

function standardPolicy() {
  return {
    minimumLiquidReserve: 2n * USDC,
    surplusSweepThreshold: 5n * USDC,
    dailyOutflowCap: 6n * USDC,
    maximumSingleWithdrawal: 4n * USDC,
    automatedSweepEnabled: true,
  };
}

function standardAllocations() {
  return {
    liquidOperationalReserveBps: 4_000,
    yieldStrategyBufferBps: 3_000,
    swapLiquidityBufferBps: 2_000,
    automationAgentPoolBps: 1_000,
  };
}

describe('VeloxTreasury', () => {
  it('deploys with immutable USDC configuration and governance roles', async () => {
    const { governance, policyAdmin, pauser, withdrawer, user, token, treasury } = await deployTreasury();
    expect(await treasury.usdc()).to.equal(await token.getAddress());
    expect(await treasury.hasRole(await treasury.DEFAULT_ADMIN_ROLE(), governance.address)).to.equal(true);
    expect(await treasury.hasRole(await treasury.POLICY_ADMIN_ROLE(), policyAdmin.address)).to.equal(true);
    expect(await treasury.hasRole(await treasury.PAUSER_ROLE(), pauser.address)).to.equal(true);
    expect(await treasury.hasRole(await treasury.WITHDRAWER_ROLE(), withdrawer.address)).to.equal(true);
    expect(await treasury.hasRole(await treasury.WITHDRAWER_ROLE(), governance.address)).to.equal(false);
    expect(await treasury.hasRole(await treasury.POLICY_ADMIN_ROLE(), governance.address)).to.equal(false);
    expect(await treasury.hasRole(await treasury.PAUSER_ROLE(), governance.address)).to.equal(false);
    await expect(ethers.deployContract('VeloxTreasury', [ethers.ZeroAddress, governance.address, policyAdmin.address, pauser.address, withdrawer.address]))
      .to.be.revertedWithCustomError(treasury, 'InvalidUSDC');
    await expect(ethers.deployContract('VeloxTreasury', [user.address, governance.address, policyAdmin.address, pauser.address, withdrawer.address]))
      .to.be.revertedWithCustomError(treasury, 'InvalidUSDC');
    await expect(ethers.deployContract('VeloxTreasury', [await token.getAddress(), ethers.ZeroAddress, policyAdmin.address, pauser.address, withdrawer.address]))
      .to.be.revertedWithCustomError(treasury, 'ZeroRecipient');
    await expect(ethers.deployContract('VeloxTreasury', [await token.getAddress(), governance.address, governance.address, pauser.address, withdrawer.address]))
      .to.be.revertedWithCustomError(treasury, 'DuplicateRoleHolder');
  });

  it('accepts a 10 USDC deposit and emits indexer-ready details', async () => {
    const { user, token, treasury } = await deployTreasury();
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await expect(treasury.connect(user).deposit(TEN_USDC))
      .to.emit(treasury, 'Deposit')
      .withArgs(user.address, TEN_USDC, TEN_USDC);
    expect(await token.balanceOf(await treasury.getAddress())).to.equal(TEN_USDC);
    await expect(treasury.connect(user).deposit(0)).to.be.revertedWithCustomError(treasury, 'ZeroAmount');
  });

  it('enforces roles, single-withdrawal cap, reserve, token balance, and exact withdrawal event', async () => {
    const { withdrawer, policyAdmin, user, recipient, token, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updatePolicy(standardPolicy());
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await treasury.connect(user).deposit(TEN_USDC);
    await expect(treasury.connect(user).withdraw(recipient.address, USDC))
      .to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 5n * USDC))
      .to.be.revertedWithCustomError(treasury, 'MaximumSingleWithdrawalExceeded');
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC))
      .to.emit(treasury, 'Withdrawal')
      .withArgs(withdrawer.address, recipient.address, 4n * USDC, 6n * USDC, 4n * USDC);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 3n * USDC))
      .to.be.revertedWithCustomError(treasury, 'RollingOutflowLimitExceeded');
    await treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), minimumLiquidReserve: 3n * USDC, dailyOutflowCap: 8n * USDC });
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC))
      .to.be.revertedWithCustomError(treasury, 'MinimumLiquidReserveBreached');
  });

  it('enforces an exact rolling 24-hour outflow limit and restores capacity after expiry', async () => {
    const { withdrawer, policyAdmin, user, recipient, token, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updatePolicy(standardPolicy());
    await token.mint(user.address, 20n * USDC);
    await token.connect(user).approve(await treasury.getAddress(), 20n * USDC);
    await treasury.connect(user).deposit(20n * USDC);
    await treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 3n * USDC))
      .to.be.revertedWithCustomError(treasury, 'RollingOutflowLimitExceeded');
    await time.increase(24 * 60 * 60);
    expect(await treasury.rolling24HourOutflow()).to.equal(0);
    await treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC);
  });

  it('allows valid policy and allocation updates, and rejects unsafe or non-100% inputs', async () => {
    const { policyAdmin, outsider, treasury } = await deployTreasury();
    await expect(treasury.connect(policyAdmin).updatePolicy(standardPolicy())).to.emit(treasury, 'PolicyUpdated');
    await expect(treasury.connect(policyAdmin).updateAllocations(standardAllocations())).to.emit(treasury, 'AllocationUpdated');
    expect((await treasury.allocations()).liquidOperationalReserveBps).to.equal(4_000);
    await expect(treasury.connect(outsider).updatePolicy(standardPolicy()))
      .to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), maximumSingleWithdrawal: 7n * USDC }))
      .to.be.revertedWithCustomError(treasury, 'InvalidPolicy');
    await expect(treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), surplusSweepThreshold: USDC }))
      .to.be.revertedWithCustomError(treasury, 'InvalidPolicy');
    await expect(treasury.connect(policyAdmin).updateAllocations({ ...standardAllocations(), automationAgentPoolBps: 999 }))
      .to.be.revertedWithCustomError(treasury, 'InvalidAllocationTotal');
    await treasury.connect(policyAdmin).updatePolicy({
      minimumLiquidReserve: 0,
      surplusSweepThreshold: 0,
      dailyOutflowCap: 0,
      maximumSingleWithdrawal: 0,
      automatedSweepEnabled: false,
    });
  });

  it('pause blocks deposits and withdrawals, while unpause restores them', async () => {
    const { pauser, withdrawer, policyAdmin, user, recipient, token, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updatePolicy(standardPolicy());
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await expect(treasury.connect(pauser).pause()).to.emit(treasury, 'TreasuryPaused');
    await expect(treasury.connect(user).deposit(TEN_USDC)).to.be.revertedWithCustomError(treasury, 'EnforcedPause');
    await expect(treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), dailyOutflowCap: 7n * USDC }))
      .to.emit(treasury, 'PolicyUpdated');
    await expect(treasury.connect(user).unpause()).to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(pauser).unpause()).to.emit(treasury, 'TreasuryUnpaused');
    await treasury.connect(user).deposit(TEN_USDC);
    await treasury.connect(withdrawer).withdraw(recipient.address, USDC);
  });

  it('rejects a reentrant token callback before it can make a second withdrawal', async () => {
    const [governance, policyAdmin, pauser, withdrawer, user, recipient] = await ethers.getSigners();
    const token = await ethers.deployContract('ReentrantUSDC');
    const treasury = await ethers.deployContract('VeloxTreasury', [await token.getAddress(), governance.address, policyAdmin.address, pauser.address, withdrawer.address]);
    await treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), dailyOutflowCap: 8n * USDC, maximumSingleWithdrawal: 4n * USDC });
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await treasury.connect(user).deposit(TEN_USDC);
    await treasury.connect(governance).grantRole(await treasury.WITHDRAWER_ROLE(), await token.getAddress());
    const callback = treasury.interface.encodeFunctionData('withdraw', [recipient.address, USDC]);
    await token.setTransferCallback(await treasury.getAddress(), callback);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, USDC)).to.be.revertedWithCustomError(treasury, 'ReentrancyGuardReentrantCall');
  });

  it('enforces every privileged boundary and prevents non-admin role escalation', async () => {
    const { governance, policyAdmin, pauser, withdrawer, user, recipient, outsider, token, treasury } = await deployTreasury();
    await expect(treasury.connect(outsider).pause()).to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(outsider).unpause()).to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(outsider).grantRole(await treasury.WITHDRAWER_ROLE(), outsider.address))
      .to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(outsider).revokeRole(await treasury.WITHDRAWER_ROLE(), governance.address))
      .to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(policyAdmin).grantRole(await treasury.WITHDRAWER_ROLE(), policyAdmin.address))
      .to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
    await expect(treasury.connect(policyAdmin).updateAllocations(standardAllocations())).to.emit(treasury, 'AllocationUpdated');
    await treasury.connect(governance).grantRole(await treasury.AUTOMATION_ROLE(), outsider.address);
    await token.mint(await treasury.getAddress(), TEN_USDC);
    await treasury.connect(policyAdmin).updatePolicy(standardPolicy());
    await expect(treasury.connect(outsider).withdraw(recipient.address, USDC))
      .to.be.revertedWithCustomError(treasury, 'AccessControlUnauthorizedAccount');
  });

  it('enforces zero values, exact boundaries, and reserve using live token balance', async () => {
    const { withdrawer, policyAdmin, user, recipient, token, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updatePolicy(standardPolicy());
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await treasury.connect(user).deposit(TEN_USDC);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 0)).to.be.revertedWithCustomError(treasury, 'ZeroAmount');
    await expect(treasury.connect(withdrawer).withdraw(ethers.ZeroAddress, USDC)).to.be.revertedWithCustomError(treasury, 'ZeroRecipient');
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC)).to.not.be.reverted;
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC)).to.be.revertedWithCustomError(treasury, 'RollingOutflowLimitExceeded');
    await time.increase(24 * 60 * 60 - 2);
    expect(await treasury.rolling24HourOutflow()).to.equal(4n * USDC);
    await time.increase(3);
    expect(await treasury.rolling24HourOutflow()).to.equal(0);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC + 1n))
      .to.be.revertedWithCustomError(treasury, 'MaximumSingleWithdrawalExceeded');
    await treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), maximumSingleWithdrawal: 5n * USDC, dailyOutflowCap: 8n * USDC });
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 5n * USDC))
      .to.be.revertedWithCustomError(treasury, 'MinimumLiquidReserveBreached');
  });

  it('enforces cumulative outflow at its exact limit and one unit above it', async () => {
    const { withdrawer, policyAdmin, user, recipient, token, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), minimumLiquidReserve: 0, maximumSingleWithdrawal: 4n * USDC, dailyOutflowCap: 6n * USDC });
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await treasury.connect(user).deposit(TEN_USDC);
    await treasury.connect(withdrawer).withdraw(recipient.address, 4n * USDC);
    await treasury.connect(withdrawer).withdraw(recipient.address, 2n * USDC);
    expect(await treasury.rolling24HourOutflow()).to.equal(6n * USDC);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, 1n)).to.be.revertedWithCustomError(treasury, 'RollingOutflowLimitExceeded');
  });

  it('keeps rolling-window reads and new withdrawals correct after expired history', async () => {
    const { withdrawer, policyAdmin, user, recipient, token, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), minimumLiquidReserve: 0, maximumSingleWithdrawal: USDC, dailyOutflowCap: 100n * USDC });
    await token.mint(user.address, 200n * USDC);
    await token.connect(user).approve(await treasury.getAddress(), 200n * USDC);
    await treasury.connect(user).deposit(200n * USDC);
    for (let i = 0; i < 32; i += 1) await treasury.connect(withdrawer).withdraw(recipient.address, USDC);
    expect(await treasury.rolling24HourOutflow()).to.equal(32n * USDC);
    await time.increase(24 * 60 * 60);
    expect(await treasury.rolling24HourOutflow()).to.equal(0);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, USDC)).to.not.be.reverted;
    expect(await treasury.rolling24HourOutflow()).to.equal(USDC);
  });

  it('rejects false-returning token transfers without corrupting withdrawal accounting', async () => {
    const [governance, policyAdmin, pauser, withdrawer, user, recipient] = await ethers.getSigners();
    const token = await ethers.deployContract('FalseReturnUSDC');
    const treasury = await ethers.deployContract('VeloxTreasury', [await token.getAddress(), governance.address, policyAdmin.address, pauser.address, withdrawer.address]);
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await expect(treasury.connect(user).deposit(TEN_USDC)).to.be.revertedWithCustomError(treasury, 'SafeERC20FailedOperation');
    await token.mint(await treasury.getAddress(), TEN_USDC);
    await treasury.connect(policyAdmin).updatePolicy(standardPolicy());
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, USDC)).to.be.revertedWithCustomError(treasury, 'SafeERC20FailedOperation');
    expect(await treasury.rolling24HourOutflow()).to.equal(0);
    expect(await token.balanceOf(await treasury.getAddress())).to.equal(TEN_USDC);
  });

  it('allows policy values above the current balance but enforces them only at withdrawal time', async () => {
    const { withdrawer, policyAdmin, user, recipient, token, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updatePolicy({ ...standardPolicy(), minimumLiquidReserve: 100n * USDC, dailyOutflowCap: 200n * USDC, maximumSingleWithdrawal: 100n * USDC, automatedSweepEnabled: false });
    await token.mint(user.address, TEN_USDC);
    await token.connect(user).approve(await treasury.getAddress(), TEN_USDC);
    await treasury.connect(user).deposit(TEN_USDC);
    await expect(treasury.connect(withdrawer).withdraw(recipient.address, USDC)).to.be.revertedWithCustomError(treasury, 'MinimumLiquidReserveBreached');
  });

  it('accepts allocation extremes only when the aggregate is exactly 10,000 bps', async () => {
    const { policyAdmin, treasury } = await deployTreasury();
    await treasury.connect(policyAdmin).updateAllocations({ liquidOperationalReserveBps: 10_000, yieldStrategyBufferBps: 0, swapLiquidityBufferBps: 0, automationAgentPoolBps: 0 });
    await treasury.connect(policyAdmin).updateAllocations({ liquidOperationalReserveBps: 0, yieldStrategyBufferBps: 10_000, swapLiquidityBufferBps: 0, automationAgentPoolBps: 0 });
    await expect(treasury.connect(policyAdmin).updateAllocations({ liquidOperationalReserveBps: 9_999, yieldStrategyBufferBps: 0, swapLiquidityBufferBps: 0, automationAgentPoolBps: 0 }))
      .to.be.revertedWithCustomError(treasury, 'InvalidAllocationTotal');
    await expect(treasury.connect(policyAdmin).updateAllocations({ liquidOperationalReserveBps: 10_001, yieldStrategyBufferBps: 0, swapLiquidityBufferBps: 0, automationAgentPoolBps: 0 }))
      .to.be.revertedWithCustomError(treasury, 'InvalidAllocationTotal');
  });
});
