import { ethers } from 'hardhat';
import { mine, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';

const USDC = 1_000_000n;

async function deployCore() {
  const [governance, policyAdmin, timelockExecutor, automation, emergency, userA, userB, recipient, protocol, outsider] = await ethers.getSigners();
  const protocolId = ethers.keccak256(ethers.toUtf8Bytes('STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2'));
  const token = await ethers.deployContract('MockUSDC');
  const core = await ethers.deployContract('VeloxTreasuryCore', [
    await token.getAddress(),
    governance.address,
    policyAdmin.address,
    timelockExecutor.address,
    automation.address,
    emergency.address,
    [0n, 10_000, 0n],
    [0, 10_000, 0, 0],
    100n,
  ]);
  const strategy = await ethers.deployContract('MockStrategyAdapter', [await token.getAddress(), protocolId]);
  return { governance, policyAdmin, timelockExecutor, automation, emergency, userA, userB, recipient, protocol, outsider, protocolId, token, core, strategy };
}

async function operationId(core: any, transaction: Promise<any>): Promise<string> {
  const receipt = await (await transaction).wait();
  const event = receipt.logs
    .map((log: any) => {
      try { return core.interface.parseLog({ topics: log.topics, data: log.data }); } catch { return null; }
    })
    .find((parsed: any) => parsed?.name === 'TimelockScheduled');
  if (!event) throw new Error('TimelockScheduled event was not found');
  return event.args.operationId;
}

async function authorizeStrategy(
  context: Awaited<ReturnType<typeof deployCore>>,
  strategyCap = 5n * USDC,
  relativeCapBps = 5_000,
  strategyOverride?: any,
) {
  const { core, policyAdmin, timelockExecutor, protocolId, token } = context;
  const strategy = strategyOverride ?? context.strategy;
  if ((await core.protocolVaults(protocolId)) === ethers.ZeroAddress) {
    await core.connect(policyAdmin).configureProtocolVault(protocolId, await strategy.vault());
  }
  const protocolApprovalId = await operationId(core, core.connect(policyAdmin).scheduleProtocolApproval(protocolId, strategyCap, relativeCapBps));
  const assetId = await operationId(core, core.connect(policyAdmin).scheduleAssetApproval(await token.getAddress(), strategyCap, relativeCapBps));
  await time.increase(2 * 24 * 60 * 60 + 1);
  await core.connect(timelockExecutor).executeProtocolApproval(protocolApprovalId);
  await core.connect(timelockExecutor).executeAssetApproval(assetId);
  const strategyId = await operationId(core, core.connect(policyAdmin).scheduleStrategyApproval(await strategy.getAddress(), protocolId, await token.getAddress(), strategyCap, relativeCapBps));
  await time.increase(2 * 24 * 60 * 60 + 1);
  await core.connect(timelockExecutor).executeStrategyApproval(strategyId);
}

async function deploySteakhouseAdapter(context: Awaited<ReturnType<typeof deployCore>>) {
  const vault = await ethers.deployContract('MockERC4626Vault', [await context.token.getAddress()]);
  const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
    await vault.getAddress(),
    await context.core.getAddress(),
    context.protocolId,
    await context.token.getAddress(),
  ]);
  return { vault, adapter };
}

async function setDeployablePolicy(context: Awaited<ReturnType<typeof deployCore>>, minimumBps = 5_000, maximumDeployed = 5n * USDC) {
  const { core, policyAdmin, timelockExecutor } = context;
  const policyId = await operationId(core, core.connect(policyAdmin).scheduleRiskPolicy(0, minimumBps, maximumDeployed));
  await expect(core.connect(timelockExecutor).executeRiskPolicy(policyId)).to.be.revertedWithCustomError(core, 'TimelockNotReady');
  await time.increase(2 * 24 * 60 * 60 + 1);
  await core.connect(timelockExecutor).executeRiskPolicy(policyId);
}

function bucketPolicy(
  liquidOperationalReserveBps: number,
  yieldStrategyBufferBps: number,
  sweepLiquidityBufferBps: number,
  automationAgentPoolBps: number,
) {
  return { liquidOperationalReserveBps, yieldStrategyBufferBps, sweepLiquidityBufferBps, automationAgentPoolBps };
}

async function fund(context: Awaited<ReturnType<typeof deployCore>>, user: any, amount: bigint) {
  await context.token.mint(user.address, amount);
  await context.token.connect(user).approve(await context.core.getAddress(), amount);
  await context.core.connect(user).deposit(amount);
}

describe('VeloxTreasuryCore', () => {
  it('initializes constructor policy from explicit values and exposes matching readback', async () => {
    const context = await deployCore();
    const riskPolicy = await context.core.riskPolicy();
    const buckets = await context.core.bucketPolicy();
    expect(riskPolicy.minimumLiquidReserve).to.equal(0n);
    expect(riskPolicy.minimumLiquidReserveBps).to.equal(10_000);
    expect(riskPolicy.maximumTotalDeployed).to.equal(0n);
    expect(buckets.liquidOperationalReserveBps).to.equal(0);
    expect(buckets.yieldStrategyBufferBps).to.equal(10_000);
    expect(buckets.sweepLiquidityBufferBps).to.equal(0);
    expect(buckets.automationAgentPoolBps).to.equal(0);
    expect(await context.core.valuationFreshnessBlocks()).to.equal(100n);
    expect(await context.core.TIMELOCK_DELAY()).to.equal(2n * 24n * 60n * 60n);
    expect(await context.core.totalDeployed()).to.equal(0n);
    expect(await context.core.approvedProtocolCount()).to.equal(0n);
    expect(await context.core.approvedAssetCount()).to.equal(0n);
    expect(await context.core.approvedStrategyCount()).to.equal(0n);
  });

  it('tracks User A deposits independently', async () => {
    const context = await deployCore();
    await fund(context, context.userA, 10n * USDC);
    expect(await context.core.userBalance(context.userA.address)).to.equal(10n * USDC);
    expect(await context.core.totalUserLiabilities()).to.equal(10n * USDC);
  });

  it('derives each user strategy position from their authoritative Core share units', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await authorizeStrategy(context, 100n * USDC, 10_000);
    await fund(context, context.userA, 3n * USDC);
    await fund(context, context.userB, 1n * USDC);

    let userA = await context.core.userStrategyPosition(context.userA.address, await context.strategy.getAddress());
    let userB = await context.core.userStrategyPosition(context.userB.address, await context.strategy.getAddress());
    expect(userA.shares).to.equal(0);
    expect(userA.position).to.equal(0);
    expect(userB.shares).to.equal(0);

    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 2n * USDC);
    userA = await context.core.userStrategyPosition(context.userA.address, await context.strategy.getAddress());
    userB = await context.core.userStrategyPosition(context.userB.address, await context.strategy.getAddress());
    const aggregate = await context.core.strategies(await context.strategy.getAddress());
    expect(userA.shares).to.equal(1_500_000n);
    expect(userB.shares).to.equal(500_000n);
    expect(userA.position).to.equal(1_500_000n);
    expect(userB.position).to.equal(500_000n);
    expect(userA.shares + userB.shares).to.equal(aggregate.shares);
    expect(userA.position + userB.position).to.equal(aggregate.position);

    await context.core.connect(context.automation).deallocateFromStrategy(await context.strategy.getAddress(), 1n * USDC);
    userA = await context.core.userStrategyPosition(context.userA.address, await context.strategy.getAddress());
    userB = await context.core.userStrategyPosition(context.userB.address, await context.strategy.getAddress());
    const afterDeallocation = await context.core.strategies(await context.strategy.getAddress());
    expect(userA.shares).to.equal(750_000n);
    expect(userB.shares).to.equal(250_000n);
    expect(userA.position).to.equal(750_000n);
    expect(userB.position).to.equal(250_000n);
    expect(userA.shares + userB.shares).to.equal(afterDeallocation.shares);
    expect(userA.position + userB.position).to.equal(afterDeallocation.position);
  });

  it('enforces the Admin-configured maximum single withdrawal on both withdrawal paths', async () => {
    const context = await deployCore();
    await fund(context, context.userA, 5n * USDC);
    await expect(context.core.connect(context.policyAdmin).setWithdrawalPolicy(2n * USDC, 5n * USDC))
      .to.emit(context.core, 'WithdrawalPolicyChanged')
      .withArgs(2n * USDC, 5n * USDC, context.policyAdmin.address, true);

    await expect(context.core.connect(context.userA).withdraw(3n * USDC, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'WithdrawalLimitExceeded')
      .withArgs(3n * USDC, 2n * USDC);
    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      3n * USDC,
      context.userA.address,
      [],
      [],
    )).to.be.revertedWithCustomError(context.core, 'WithdrawalLimitExceeded')
      .withArgs(3n * USDC, 2n * USDC);

    await context.core.connect(context.userA).withdraw(2n * USDC, context.userA.address);
    expect(await context.core.userBalance(context.userA.address)).to.equal(3n * USDC);
  });

  it('enforces one fixed 24-hour outflow window across liquid and deallocation withdrawals', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    await context.core.connect(context.userA).withdraw(3n * USDC, context.userA.address);
    await context.core.connect(context.policyAdmin).setWithdrawalPolicy(4n * USDC, 4n * USDC);
    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      3n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [USDC],
    )).to.be.revertedWithCustomError(context.core, 'WithdrawalLimitExceeded')
      .withArgs(3n * USDC, USDC);

    expect(await context.core.totalDeployed()).to.equal(5n * USDC);
    expect(await context.core.liquidUSDC()).to.equal(2n * USDC);
    expect(await context.core.userBalance(context.userA.address)).to.equal(7n * USDC);

    await time.increase(24 * 60 * 60);
    await context.core.connect(context.userA).withdrawWithDeallocation(
      3n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [USDC],
    );
    expect(await context.core.userBalance(context.userA.address)).to.equal(4n * USDC);
  });

  it('timelocks increases to the maximum withdrawal and daily outflow limits', async () => {
    const context = await deployCore();
    await context.core.connect(context.policyAdmin).setWithdrawalPolicy(2n * USDC, 3n * USDC);
    const policyId = await operationId(
      context.core,
      context.core.connect(context.policyAdmin).setWithdrawalPolicy(4n * USDC, 5n * USDC),
    );

    await expect(context.core.connect(context.timelockExecutor).executeRiskPolicy(policyId))
      .to.be.revertedWithCustomError(context.core, 'TimelockNotReady');
    await time.increase(2 * 24 * 60 * 60 + 1);
    await expect(context.core.connect(context.timelockExecutor).executeRiskPolicy(policyId))
      .to.emit(context.core, 'WithdrawalPolicyChanged')
      .withArgs(4n * USDC, 5n * USDC, context.timelockExecutor.address, false);
    expect(await context.core.maximumSingleWithdrawal()).to.equal(4n * USDC);
    expect(await context.core.dailyOutflowCap()).to.equal(5n * USDC);
  });

  it('keeps User A and User B balances separate', async () => {
    const context = await deployCore();
    await fund(context, context.userA, 10n * USDC);
    await fund(context, context.userB, 7n * USDC);
    expect(await context.core.userBalance(context.userA.address)).to.equal(10n * USDC);
    expect(await context.core.userBalance(context.userB.address)).to.equal(7n * USDC);
    expect(await context.core.totalUserLiabilities()).to.equal(17n * USDC);
  });

  it('allows a user to withdraw only from their own balance', async () => {
    const context = await deployCore();
    await fund(context, context.userA, 10n * USDC);
    await expect(context.core.connect(context.userB).withdraw(1n * USDC, context.userB.address))
      .to.be.revertedWithCustomError(context.core, 'InsufficientUserBalance');
  });

  it('allows a user to withdraw to msg.sender', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await fund(context, context.userA, 10n * USDC);

    await context.core.connect(context.userA).withdraw(3n * USDC, context.userA.address);

    expect(await context.core.userBalance(context.userA.address)).to.equal(7n * USDC);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(3n * USDC);
    const receipt = await context.core.queryFilter(context.core.filters.Withdrawal(context.userA.address, context.userA.address));
    expect(receipt.length).to.equal(1);
    expect(receipt[0].args.user).to.equal(context.userA.address);
    expect(receipt[0].args.recipient).to.equal(context.userA.address);
  });

  it('rejects withdrawing to another user address', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await fund(context, context.userA, 10n * USDC);

    await expect(context.core.connect(context.userA).withdraw(3n * USDC, context.userB.address))
      .to.be.revertedWithCustomError(context.core, 'InvalidRecipient');
    expect(await context.core.userBalance(context.userA.address)).to.equal(10n * USDC);
    expect(await context.core.userBalance(context.userB.address)).to.equal(0);
    expect(await context.token.balanceOf(context.userB.address)).to.equal(0);
  });

  it('rejects withdrawing to an arbitrary third-party address', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await fund(context, context.userA, 10n * USDC);

    await expect(context.core.connect(context.userA).withdraw(3n * USDC, context.outsider.address))
      .to.be.revertedWithCustomError(context.core, 'InvalidRecipient');
    expect(await context.core.userBalance(context.userA.address)).to.equal(10n * USDC);
    expect(await context.token.balanceOf(context.outsider.address)).to.equal(0);
  });

  it('rejects withdrawWithDeallocation to a different recipient and preserves strategy state', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      5n * USDC,
      context.userB.address,
      [await context.strategy.getAddress()],
      [5n * USDC],
    )).to.be.revertedWithCustomError(context.core, 'InvalidRecipient');

    expect(await context.core.userBalance(context.userA.address)).to.equal(10n * USDC);
    expect(await context.core.userBalance(context.userB.address)).to.equal(0);
    const strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.shares).to.equal(5n * USDC);
    expect(strategyState.position).to.equal(5n * USDC);
    expect(await context.token.balanceOf(context.userB.address)).to.equal(0);
  });

  it('preserves user accounting after invalid-recipient revert', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await fund(context, context.userA, 10n * USDC);
    await fund(context, context.userB, 5n * USDC);

    await expect(context.core.connect(context.userA).withdraw(3n * USDC, context.userB.address))
      .to.be.revertedWithCustomError(context.core, 'InvalidRecipient');

    expect(await context.core.userBalance(context.userA.address)).to.equal(10n * USDC);
    expect(await context.core.userBalance(context.userB.address)).to.equal(5n * USDC);
    expect(await context.core.totalUserLiabilities()).to.equal(15n * USDC);
  });

  it('has no arbitrary 70 percent withdrawal cap', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await fund(context, context.userA, 10n * USDC);
    expect((await context.core.userFinancialState(context.userA.address)).immediatelyWithdrawableValue).to.equal(10n * USDC);
    await context.core.connect(context.userA).withdraw(10n * USDC, context.userA.address);
    expect(await context.core.userBalance(context.userA.address)).to.equal(0);
    expect(await context.core.totalUserLiabilities()).to.equal(0);
  });

  it('reports only liquid funds above the current reserve when strategy assets are deployed', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    const state = await context.core.userFinancialState(context.userA.address);
    expect(state.currentValue).to.equal(10n * USDC);
    expect(state.immediatelyWithdrawableValue).to.equal(5n * USDC);
    await context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [5n * USDC],
    );
    expect(await context.core.userBalance(context.userA.address)).to.equal(0);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(10n * USDC);
  });

  it('reports and enforces the exact immediate amount allowed by reserve rounding', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 5_000, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    const state = await context.core.userFinancialState(context.userA.address);
    expect(state.currentValue).to.equal(10n * USDC);
    expect(state.immediatelyWithdrawableValue).to.equal(1n);
    await context.core.connect(context.userA).withdraw(1n, context.userA.address);
    expect((await context.core.userFinancialState(context.userA.address)).immediatelyWithdrawableValue).to.equal(0n);
    await expect(context.core.connect(context.userA).withdraw(1n, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'LiquidityRequirementBreached');
  });

  it('allows the final user to withdraw the full balance without stranding the fixed reserve', async () => {
    const context = await deployCore();
    const riskPolicyId = await operationId(
      context.core,
      context.core.connect(context.policyAdmin).scheduleRiskPolicy(0, 0, 0),
    );
    await time.increase(2 * 24 * 60 * 60 + 1);
    await context.core.connect(context.timelockExecutor).executeRiskPolicy(riskPolicyId);
    await context.core.connect(context.policyAdmin).reduceRiskPolicy(2n * USDC, 0, 0);
    await fund(context, context.userA, 10n * USDC);

    await context.core.connect(context.userA).withdraw(10n * USDC, context.userA.address);

    expect(await context.core.userBalance(context.userA.address)).to.equal(0n);
    expect(await context.core.totalUserLiabilities()).to.equal(0n);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(10n * USDC);
  });

  it('reports only idle liquidity when strategy valuation is stale and preserves the unwind freshness check', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.core.connect(context.automation).markStrategyValuationStale(await context.strategy.getAddress());

    const state = await context.core.userFinancialState(context.userA.address);
    expect(state.currentValue).to.equal(10n * USDC);
    expect(state.immediatelyWithdrawableValue).to.equal(5n * USDC);
    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [5n * USDC],
    )).to.be.revertedWithCustomError(context.core, 'ValuationNotCurrent');
    expect(await context.core.liquidUSDC()).to.equal(5n * USDC);
    expect(await context.core.totalDeployed()).to.equal(5n * USDC);
  });

  it('allows atomic unwind of an approved disabled strategy without allowing new allocations', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.core.connect(context.policyAdmin).disableStrategy(await context.strategy.getAddress());

    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'Disabled');
    await context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [5n * USDC],
    );
    expect(await context.core.userBalance(context.userA.address)).to.equal(0);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(10n * USDC);
  });

  it('withdraws the post-unwind balance after a full withdrawal realizes strategy loss', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.strategy.setWithdrawalBps(9_000);

    await context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [5n * USDC],
    );

    const state = await context.core.userFinancialState(context.userA.address);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(9_500_000n);
    expect(state.currentValue).to.equal(0);
    expect(state.principal).to.equal(0);
    expect(state.realizedPnl).to.equal(-500_000n);
    expect(state.totalPnl).to.equal(-500_000n);
  });

  it('updates liabilities on withdrawal and rejects excess withdrawals', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.userA).withdraw(4n * USDC, context.userA.address);
    expect(await context.core.totalUserLiabilities()).to.equal(6n * USDC);
    await expect(context.core.connect(context.userA).withdraw(7n * USDC, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'InsufficientUserBalance');
  });

  it('withdraws liquid funds directly without deallocating strategy shares', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    await context.core.connect(context.userA).withdrawWithDeallocation(2n * USDC, context.userA.address, [], []);

    expect(await context.core.userBalance(context.userA.address)).to.equal(8n * USDC);
    expect(await context.core.totalDeployed()).to.equal(5n * USDC);
    const strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.shares).to.equal(5n * USDC);
    expect(strategyState.position).to.equal(5n * USDC);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(2n * USDC);
  });

  it('atomically unwinds one strategy before a withdrawal', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 8n * USDC);

    await context.core.connect(context.userA).withdrawWithDeallocation(
      5n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [3n * USDC],
    );

    expect(await context.token.balanceOf(context.userA.address)).to.equal(5n * USDC);
    expect(await context.core.liquidUSDC()).to.equal(0);
    expect(await context.core.totalDeployed()).to.equal(5n * USDC);
    expect(await context.core.userBalance(context.userA.address)).to.equal(5n * USDC);
  });

  it('supports full withdrawal and multiple-strategy unwinds', async () => {
    const context = await deployCore();
    const secondStrategy = await ethers.deployContract('MockStrategyAdapter', [await context.token.getAddress(), context.protocolId]);
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await authorizeStrategy(context, 10n * USDC, 10_000, secondStrategy);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 4n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await secondStrategy.getAddress(), 6n * USDC);

    await context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await context.strategy.getAddress(), await secondStrategy.getAddress()],
      [4n * USDC, 6n * USDC],
    );

    expect(await context.token.balanceOf(context.userA.address)).to.equal(10n * USDC);
    expect(await context.core.userBalance(context.userA.address)).to.equal(0);
    expect(await context.core.totalDeployed()).to.equal(0);
    expect(await context.core.totalManagedAssets()).to.equal(0);
  });

  it('reverts the entire withdrawal when the unwind plan is insufficient', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      8n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [2n * USDC],
    )).to.be.revertedWithCustomError(context.core, 'InsufficientLiquidity');

    expect(await context.core.liquidUSDC()).to.equal(5n * USDC);
    expect(await context.core.totalDeployed()).to.equal(5n * USDC);
    expect((await context.core.strategies(await context.strategy.getAddress())).shares).to.equal(5n * USDC);
  });

  it('prevents a user from unwinding strategy shares attributable to another user', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await authorizeStrategy(context, 100n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await fund(context, context.userB, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 15n * USDC);

    const userAPosition = await context.core.userStrategyPosition(context.userA.address, await context.strategy.getAddress());
    const userBPosition = await context.core.userStrategyPosition(context.userB.address, await context.strategy.getAddress());
    expect(userAPosition.shares).to.equal(7_500_000n);
    expect(userBPosition.shares).to.equal(7_500_000n);

    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      8n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [8n * USDC],
    )).to.be.revertedWithCustomError(context.core, 'InvalidUnwindPlan');

    expect((await context.core.strategies(await context.strategy.getAddress())).shares).to.equal(15n * USDC);
    expect((await context.core.userStrategyPosition(context.userB.address, await context.strategy.getAddress())).shares)
      .to.equal(userBPosition.shares);
  });

  it('withdraws using only the caller share position derived from Core user units', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await authorizeStrategy(context, 100n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await fund(context, context.userB, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 15n * USDC);

    const strategyAddress = await context.strategy.getAddress();
    const callerPosition = await context.core.userStrategyPosition(context.userA.address, strategyAddress);
    expect(callerPosition.shares).to.equal(7_500_000n);
    await context.core.connect(context.userA).withdrawWithDeallocation(
      8n * USDC,
      context.userA.address,
      [strategyAddress],
      [3n * USDC],
    );

    const userAPositionAfter = await context.core.userStrategyPosition(context.userA.address, strategyAddress);
    const userBPositionAfter = await context.core.userStrategyPosition(context.userB.address, strategyAddress);
    const strategyAfter = await context.core.strategies(strategyAddress);
    expect(userAPositionAfter.shares).to.equal(2n * USDC);
    expect(userBPositionAfter.shares).to.equal(10n * USDC);
    expect(userAPositionAfter.position).to.equal(2n * USDC);
    expect(userBPositionAfter.position).to.equal(10n * USDC);
    expect(userAPositionAfter.shares + userBPositionAfter.shares).to.equal(strategyAfter.shares);
    expect(userAPositionAfter.position + userBPositionAfter.position).to.equal(strategyAfter.position);
    expect(await context.core.totalDeployed()).to.equal(strategyAfter.position);
    expect(await context.core.userBalance(context.userA.address)).to.equal(2n * USDC);
    expect(await context.core.userBalance(context.userB.address)).to.equal(10n * USDC);
  });

  it('rejects failed, stale, unauthorized, duplicate, and excessive unwind plans', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    await context.strategy.setFailWithdrawal(true);
    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      8n * USDC, context.userA.address, [await context.strategy.getAddress()], [5n * USDC],
    )).to.be.reverted;
    await context.strategy.setFailWithdrawal(false);

    await context.core.connect(context.automation).markStrategyValuationStale(await context.strategy.getAddress());
    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      8n * USDC, context.userA.address, [await context.strategy.getAddress()], [1n],
    )).to.be.revertedWithCustomError(context.core, 'ValuationNotCurrent');

    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      8n * USDC, context.userA.address, [context.outsider.address], [1n],
    )).to.be.revertedWithCustomError(context.core, 'NotApproved');
  });

  it('reverts atomically when the recovered liquidity still violates the reserve', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await context.core.connect(context.policyAdmin).reduceRiskPolicy(8n * USDC, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 2n * USDC);

    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      3n * USDC, context.userA.address, [await context.strategy.getAddress()], [1n * USDC],
    )).to.be.revertedWithCustomError(context.core, 'LiquidityRequirementBreached');

    expect(await context.core.liquidUSDC()).to.equal(8n * USDC);
    expect(await context.core.totalDeployed()).to.equal(2n * USDC);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(0);
  });

  it('preserves realized loss and shortfall through atomic withdrawal recovery', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.strategy.setWithdrawalBps(9_000);

    await context.core.connect(context.userA).withdrawWithDeallocation(
      7n * USDC, context.userA.address, [await context.strategy.getAddress()], [5n * USDC],
    );

    const state = await context.core.strategies(await context.strategy.getAddress());
    expect(state.realizedLoss).to.equal(500_000n);
    expect(state.withdrawalShortfall).to.equal(500_000n);
    expect(await context.core.totalDeployed()).to.equal(0);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(7n * USDC);
  });

  it('reverts atomic withdrawal recovery on an adapter token-delta failure', async () => {
    const context = await deployCore();
    const { vault, adapter } = await deploySteakhouseAdapter(context);
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000, adapter);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await adapter.getAddress(), 5n * USDC);
    await context.token.mint(await vault.getAddress(), 1n);
    await vault.setUnexpectedTransferGap(1n);

    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      7n * USDC, context.userA.address, [await adapter.getAddress()], [5n * USDC],
    )).to.be.reverted;

    expect(await context.core.liquidUSDC()).to.equal(5n * USDC);
    expect(await context.core.totalDeployed()).to.equal(5n * USDC);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(0);
  });

  it('successfully redeems Steakhouse vault shares before completing a withdrawal', async () => {
    const context = await deployCore();
    const { vault, adapter } = await deploySteakhouseAdapter(context);
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000, adapter);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await adapter.getAddress(), 5n * USDC);

    expect(await adapter.core()).to.equal(await context.core.getAddress());
    expect(await adapter.asset()).to.equal(await context.token.getAddress());
    expect(await adapter.protocol()).to.equal(context.protocolId);
    expect(await adapter.vault()).to.equal(await vault.getAddress());
    expect((await context.core.userFinancialState(context.userA.address)).immediatelyWithdrawableValue).to.equal(5n * USDC);

    await context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await adapter.getAddress()],
      [5n * USDC],
    );

    expect(await context.token.balanceOf(context.userA.address)).to.equal(10n * USDC);
    expect(await context.core.userBalance(context.userA.address)).to.equal(0);
    expect(await context.core.userPrincipal(context.userA.address)).to.equal(0);
    expect(await context.core.userRealizedPnl(context.userA.address)).to.equal(0);
    expect(await context.core.totalUserLiabilities()).to.equal(0);
    expect(await context.core.totalDeployed()).to.equal(0);
    expect(await adapter.sharesOfCore()).to.equal(0);
    const strategyState = await context.core.strategies(await adapter.getAddress());
    expect(strategyState.shares).to.equal(0);
    expect(strategyState.position).to.equal(0);
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(0);
  });

  it('reverts a full withdrawal atomically when Steakhouse vault redemption fails', async () => {
    const context = await deployCore();
    const { vault, adapter } = await deploySteakhouseAdapter(context);
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000, adapter);
    await fund(context, context.userA, 10n * USDC);
    await fund(context, context.userB, 5n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await adapter.getAddress(), 8n * USDC);

    const userBalanceBefore = await context.core.userBalance(context.userA.address);
    const otherUserBalanceBefore = await context.core.userBalance(context.userB.address);
    const principalBefore = await context.core.userPrincipal(context.userA.address);
    const realizedPnlBefore = await context.core.userRealizedPnl(context.userA.address);
    const liabilitiesBefore = await context.core.totalUserLiabilities();
    const liquidBefore = await context.core.liquidUSDC();
    const totalDeployedBefore = await context.core.totalDeployed();
    const strategyBefore = await context.core.strategies(await adapter.getAddress());
    const sharesBefore = await adapter.sharesOfCore();
    const strategyValueBefore = await adapter.currentValue();
    const coreBalanceBefore = await context.token.balanceOf(await context.core.getAddress());
    const userTokenBalanceBefore = await context.token.balanceOf(context.userA.address);

    await vault.setFailRedeem(true);
    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await adapter.getAddress()],
      [3n * USDC],
    )).to.be.revertedWithCustomError(vault, 'RedeemFailed');

    const strategyAfter = await context.core.strategies(await adapter.getAddress());
    expect(await context.core.userBalance(context.userA.address)).to.equal(userBalanceBefore);
    expect(await context.core.userBalance(context.userB.address)).to.equal(otherUserBalanceBefore);
    expect(await context.core.userPrincipal(context.userA.address)).to.equal(principalBefore);
    expect(await context.core.userRealizedPnl(context.userA.address)).to.equal(realizedPnlBefore);
    expect(await context.core.totalUserLiabilities()).to.equal(liabilitiesBefore);
    expect(await context.core.liquidUSDC()).to.equal(liquidBefore);
    expect(await context.core.totalDeployed()).to.equal(totalDeployedBefore);
    expect(await adapter.sharesOfCore()).to.equal(sharesBefore);
    expect(await adapter.currentValue()).to.equal(strategyValueBefore);
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(coreBalanceBefore);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(userTokenBalanceBefore);
    expect(strategyAfter.principal).to.equal(strategyBefore.principal);
    expect(strategyAfter.shares).to.equal(strategyBefore.shares);
    expect(strategyAfter.position).to.equal(strategyBefore.position);
    expect(strategyAfter.realizedYield).to.equal(strategyBefore.realizedYield);
    expect(strategyAfter.realizedLoss).to.equal(strategyBefore.realizedLoss);
    expect(strategyAfter.withdrawalShortfall).to.equal(strategyBefore.withdrawalShortfall);
    expect(await context.core.queryFilter(context.core.filters.Withdrawal(context.userA.address, context.userA.address))).to.have.length(0);
  });

  it('configures dynamic bucket policy and derives bounded targets without splitting Core USDC', async () => {
    const context = await deployCore();
    const reducedPolicy = bucketPolicy(4_000, 3_000, 2_000, 1_000);
    await expect(context.core.connect(context.policyAdmin).reduceBucketPolicy(reducedPolicy))
      .to.emit(context.core, 'BucketPolicyChanged');

    const configured = await context.core.bucketPolicy();
    expect(configured.liquidOperationalReserveBps).to.equal(4_000);
    expect(configured.yieldStrategyBufferBps).to.equal(3_000);
    expect(configured.sweepLiquidityBufferBps).to.equal(2_000);
    expect(configured.automationAgentPoolBps).to.equal(1_000);

    await fund(context, context.userA, 10n * USDC);
    const targets = await context.core.bucketTargets();
    expect(targets[0] + targets[1] + targets[2] + targets[3]).to.be.at.most(await context.core.totalManagedAssets());
    expect(await context.core.liquidUSDC()).to.equal(10n * USDC);
    const classifications = await context.core.liquidBucketClassifications();
    expect(classifications[0] + classifications[1] + classifications[2]).to.equal(await context.core.liquidUSDC());
    expect(await context.core.yieldStrategyBufferCapacity()).to.equal(3n * USDC);
  });

  it('rejects invalid bucket totals and timelocks risk-increasing changes', async () => {
    const context = await deployCore();
    await expect(context.core.connect(context.policyAdmin).reduceBucketPolicy(bucketPolicy(4_000, 3_000, 2_000, 999)))
      .to.be.revertedWithCustomError(context.core, 'InvalidBucketAllocationTotal');

    await context.core.connect(context.policyAdmin).reduceBucketPolicy(bucketPolicy(4_000, 3_000, 2_000, 1_000));
    const operationIdValue = await operationId(
      context.core,
      context.core.connect(context.policyAdmin).scheduleBucketPolicy(bucketPolicy(3_000, 5_000, 1_000, 1_000)),
    );
    await expect(context.core.connect(context.timelockExecutor).executeBucketPolicy(operationIdValue))
      .to.be.revertedWithCustomError(context.core, 'TimelockNotReady');
    await time.increase(2 * 24 * 60 * 60 + 1);
    await expect(context.core.connect(context.timelockExecutor).executeBucketPolicy(operationIdValue))
      .to.emit(context.core, 'BucketPolicyChanged');
  });

  it('limits strategy allocation by the Yield Strategy Buffer in addition to existing caps', async () => {
    const context = await deployCore();
    await context.core.connect(context.policyAdmin).reduceBucketPolicy(bucketPolicy(5_000, 3_000, 1_000, 1_000));
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);

    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 4n * USDC))
      .to.be.revertedWithCustomError(context.core, 'YieldStrategyBufferExceeded')
      .withArgs(4n * USDC, 3n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 3n * USDC);
    expect(await context.core.totalDeployed()).to.equal(3n * USDC);
    expect(await context.core.totalManagedAssets()).to.equal(10n * USDC);
  });

  it('requires strategy deployment to preserve the configured liquidity reserve', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 5_000, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 6n * USDC))
      .to.be.revertedWithCustomError(context.core, 'InsufficientLiquidity');
  });

  it('enforces Liquid Operational Reserve BPS when calculating deployable liquidity', async () => {
    const context = await deployCore();
    await context.core.connect(context.policyAdmin).reduceBucketPolicy(bucketPolicy(6_000, 4_000, 0, 0));
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);

    expect(await context.core.requiredLiquidReserve()).to.equal(6n * USDC);
    expect(await context.core.availableLiquidity()).to.equal(4n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 4n * USDC);
    expect(await context.core.liquidUSDC()).to.equal(6n * USDC);
    expect(await context.core.liquidUSDC()).to.be.at.least(await context.core.requiredLiquidReserve());
  });

  it('includes Liquid Operational Reserve BPS in withdrawal availability and enforcement', async () => {
    const context = await deployCore();
    await context.core.connect(context.policyAdmin).reduceBucketPolicy(bucketPolicy(6_000, 4_000, 0, 0));
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 4n * USDC);

    const available = (await context.core.userFinancialState(context.userA.address)).immediatelyWithdrawableValue;
    expect(available).to.be.greaterThan(0n);
    expect(available).to.be.lessThan(10n * USDC);
    await context.core.connect(context.userA).withdraw(available, context.userA.address);
    await expect(context.core.connect(context.userA).withdraw(1n, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'LiquidityRequirementBreached');
  });

  it('allows the user to withdraw their full available balance when all managed assets are liquid', async () => {
    const context = await deployCore();
    await context.core.connect(context.policyAdmin).reduceBucketPolicy(bucketPolicy(6_000, 4_000, 0, 0));
    await fund(context, context.userA, 10n * USDC);

    const state = await context.core.userFinancialState(context.userA.address);
    expect(state.immediatelyWithdrawableValue).to.equal(state.currentValue);
    await context.core.connect(context.userA).withdraw(
      state.immediatelyWithdrawableValue,
      context.userA.address,
    );
    expect(await context.core.userBalance(context.userA.address)).to.equal(0n);
  });

  it('enforces the strategy absolute and relative caps', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 5_000, 10n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'ExposureCapExceeded');
  });

  it('enforces protocol exposure caps', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 20n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 20n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'ExposureCapExceeded');
  });

  it('enforces asset exposure caps', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 20n * USDC);
    await authorizeStrategy(context, 5n * USDC);
    await fund(context, context.userA, 20n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    expect(await context.core.assetExposure(await context.token.getAddress())).to.equal(5n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'ExposureCapExceeded');
  });

  it('enforces the aggregate deployed-assets cap', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 4n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC))
      .to.be.revertedWithCustomError(context.core, 'TotalDeployedCapExceeded');
  });

  it('rejects an adapter whose approved asset is not the core USDC asset', async () => {
    const context = await deployCore();
    const otherToken = await ethers.deployContract('MockUSDC');
    const otherStrategy = await ethers.deployContract('MockStrategyAdapter', [await otherToken.getAddress(), context.protocolId]);
    const protocolApprovalId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleProtocolApproval(context.protocolId, 5n * USDC, 10_000));
    const assetId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleAssetApproval(await otherToken.getAddress(), 5n * USDC, 10_000));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await context.core.connect(context.timelockExecutor).executeProtocolApproval(protocolApprovalId);
    await context.core.connect(context.timelockExecutor).executeAssetApproval(assetId);
    const strategyId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(await otherStrategy.getAddress(), context.protocolId, await otherToken.getAddress(), 5n * USDC, 10_000));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await expect(context.core.connect(context.timelockExecutor).executeStrategyApproval(strategyId))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');
  });

  it('rejects an adapter reporting the wrong protocol ID', async () => {
    const context = await deployCore();
    const wrongProtocol = ethers.keccak256(ethers.toUtf8Bytes('WRONG_PROTOCOL'));
    const wrongProtocolStrategy = await ethers.deployContract('MockStrategyAdapter', [await context.token.getAddress(), wrongProtocol]);
    const protocolApprovalId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleProtocolApproval(context.protocolId, 5n * USDC, 10_000));
    const assetId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleAssetApproval(await context.token.getAddress(), 5n * USDC, 10_000));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await context.core.connect(context.timelockExecutor).executeProtocolApproval(protocolApprovalId);
    await context.core.connect(context.timelockExecutor).executeAssetApproval(assetId);
    const strategyId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(await wrongProtocolStrategy.getAddress(), context.protocolId, await context.token.getAddress(), 5n * USDC, 10_000));
    await time.increase(2 * 24 * 60 * 60 + 1);

    await expect(context.core.connect(context.timelockExecutor).executeStrategyApproval(strategyId))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');
  });

  it('rejects unauthorized strategy approval scheduling', async () => {
    const context = await deployCore();

    await expect(context.core.connect(context.outsider).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    )).to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
  });

  it('rejects unauthorized strategy approval execution', async () => {
    const context = await deployCore();
    const strategyId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    ));
    await time.increase(2 * 24 * 60 * 60 + 1);

    await expect(context.core.connect(context.outsider).executeStrategyApproval(strategyId))
      .to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
  });

  it('rejects strategy approval execution before the timelock expires', async () => {
    const context = await deployCore();
    const strategyId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    ));

    await expect(context.core.connect(context.timelockExecutor).executeStrategyApproval(strategyId))
      .to.be.revertedWithCustomError(context.core, 'TimelockNotReady');
  });

  it('rejects replaying an executed strategy approval', async () => {
    const context = await deployCore();
    await context.core.connect(context.policyAdmin).configureProtocolVault(context.protocolId, await context.strategy.vault());
    const protocolApprovalId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleProtocolApproval(context.protocolId, 5n * USDC, 10_000));
    const assetId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleAssetApproval(await context.token.getAddress(), 5n * USDC, 10_000));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await context.core.connect(context.timelockExecutor).executeProtocolApproval(protocolApprovalId);
    await context.core.connect(context.timelockExecutor).executeAssetApproval(assetId);
    const strategyId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    ));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await context.core.connect(context.timelockExecutor).executeStrategyApproval(strategyId);
    await expect(context.core.connect(context.timelockExecutor).executeStrategyApproval(strategyId))
      .to.be.revertedWithCustomError(context.core, 'TimelockMissing');
  });

  it('rejects executing a cancelled strategy approval', async () => {
    const context = await deployCore();
    const strategyId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    ));
    await context.core.connect(context.policyAdmin).cancelTimelock(strategyId);
    await time.increase(2 * 24 * 60 * 60 + 1);

    await expect(context.core.connect(context.timelockExecutor).executeStrategyApproval(strategyId))
      .to.be.revertedWithCustomError(context.core, 'TimelockMissing');
  });

  it('pause-protects strategy approval scheduling and execution', async () => {
    const context = await deployCore();
    await context.core.connect(context.emergency).pause();
    await expect(context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    )).to.be.revertedWithCustomError(context.core, 'EnforcedPause');

    await context.core.connect(context.governance).unpause();
    const strategyId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    ));
    await context.core.connect(context.emergency).pause();
    await time.increase(2 * 24 * 60 * 60 + 1);
    await expect(context.core.connect(context.timelockExecutor).executeStrategyApproval(strategyId))
      .to.be.revertedWithCustomError(context.core, 'EnforcedPause');
  });

  it('enforces a non-10000 BPS strategy relative cap', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100n * USDC);
    await authorizeStrategy(context, 100n * USDC, 5_000);
    await fund(context, context.userA, 10n * USDC);

    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 6n * USDC))
      .to.be.revertedWithCustomError(context.core, 'ExposureCapExceeded');
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    expect((await context.core.strategies(await context.strategy.getAddress())).position).to.equal(5n * USDC);
  });

  it('blocks allocation after the approved protocol is disabled without changing state', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 5n * USDC);
    await context.core.connect(context.policyAdmin).disableProtocol(context.protocolId);

    const strategyAddress = await context.strategy.getAddress();
    const before = await context.core.strategies(strategyAddress);
    const beforeCoreBalance = await context.token.balanceOf(await context.core.getAddress());
    const beforeAdapterBalance = await context.token.balanceOf(strategyAddress);
    const beforeTotalDeployed = await context.core.totalDeployed();
    const beforeProtocolExposure = await context.core.protocolExposure(context.protocolId);
    const beforeAssetExposure = await context.core.assetExposure(await context.token.getAddress());

    await expect(context.core.connect(context.automation).allocateToStrategy(strategyAddress, 1n * USDC))
      .to.be.revertedWithCustomError(context.core, 'NotApproved');

    const after = await context.core.strategies(strategyAddress);
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(beforeCoreBalance);
    expect(await context.token.balanceOf(strategyAddress)).to.equal(beforeAdapterBalance);
    expect(after.principal).to.equal(before.principal);
    expect(after.shares).to.equal(before.shares);
    expect(after.position).to.equal(before.position);
    expect(await context.core.totalDeployed()).to.equal(beforeTotalDeployed);
    expect(await context.core.protocolExposure(context.protocolId)).to.equal(beforeProtocolExposure);
    expect(await context.core.assetExposure(await context.token.getAddress())).to.equal(beforeAssetExposure);
  });

  it('blocks allocation after the approved asset is disabled without changing state', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 5n * USDC);
    await context.core.connect(context.policyAdmin).disableAsset(await context.token.getAddress());

    const strategyAddress = await context.strategy.getAddress();
    const before = await context.core.strategies(strategyAddress);
    const beforeCoreBalance = await context.token.balanceOf(await context.core.getAddress());
    const beforeAdapterBalance = await context.token.balanceOf(strategyAddress);
    const beforeTotalDeployed = await context.core.totalDeployed();
    const beforeProtocolExposure = await context.core.protocolExposure(context.protocolId);
    const beforeAssetExposure = await context.core.assetExposure(await context.token.getAddress());

    await expect(context.core.connect(context.automation).allocateToStrategy(strategyAddress, 1n * USDC))
      .to.be.revertedWithCustomError(context.core, 'NotApproved');

    const after = await context.core.strategies(strategyAddress);
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(beforeCoreBalance);
    expect(await context.token.balanceOf(strategyAddress)).to.equal(beforeAdapterBalance);
    expect(after.principal).to.equal(before.principal);
    expect(after.shares).to.equal(before.shares);
    expect(after.position).to.equal(before.position);
    expect(await context.core.totalDeployed()).to.equal(beforeTotalDeployed);
    expect(await context.core.protocolExposure(context.protocolId)).to.equal(beforeProtocolExposure);
    expect(await context.core.assetExposure(await context.token.getAddress())).to.equal(beforeAssetExposure);
  });

  it('blocks allocation when the adapter protocol identity changes without funding', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 5n * USDC);
    await context.strategy.setProtocol(ethers.keccak256(ethers.toUtf8Bytes('CHANGED_PROTOCOL')));

    const strategyAddress = await context.strategy.getAddress();
    const before = await context.core.strategies(strategyAddress);
    const beforeCoreBalance = await context.token.balanceOf(await context.core.getAddress());
    const beforeTotalDeployed = await context.core.totalDeployed();

    await expect(context.core.connect(context.automation).allocateToStrategy(strategyAddress, 1n * USDC))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');

    const after = await context.core.strategies(strategyAddress);
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(beforeCoreBalance);
    expect(await context.token.balanceOf(strategyAddress)).to.equal(0n);
    expect(after.principal).to.equal(before.principal);
    expect(after.shares).to.equal(before.shares);
    expect(after.position).to.equal(before.position);
    expect(await context.core.totalDeployed()).to.equal(beforeTotalDeployed);
  });

  it('blocks allocation when the adapter asset identity changes without funding', async () => {
    const context = await deployCore();
    const otherToken = await ethers.deployContract('MockUSDC');
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 5n * USDC);
    await context.strategy.setAsset(await otherToken.getAddress());

    const strategyAddress = await context.strategy.getAddress();
    const before = await context.core.strategies(strategyAddress);
    const beforeCoreBalance = await context.token.balanceOf(await context.core.getAddress());
    const beforeTotalDeployed = await context.core.totalDeployed();

    await expect(context.core.connect(context.automation).allocateToStrategy(strategyAddress, 1n * USDC))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');

    const after = await context.core.strategies(strategyAddress);
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(beforeCoreBalance);
    expect(await context.token.balanceOf(strategyAddress)).to.equal(0n);
    expect(after.principal).to.equal(before.principal);
    expect(after.shares).to.equal(before.shares);
    expect(after.position).to.equal(before.position);
    expect(await context.core.totalDeployed()).to.equal(beforeTotalDeployed);
  });

  it('rolls back all funding and accounting when adapter deposit fails', async () => {
    const context = await deployCore();
    const vault = await ethers.deployContract('MockERC4626Vault', [await context.token.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      await context.core.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
    ]);
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000, adapter);
    await fund(context, context.userA, 5n * USDC);
    await vault.setFailDeposit(true);

    const strategyAddress = await adapter.getAddress();
    const before = await context.core.strategies(strategyAddress);
    const beforeCoreBalance = await context.token.balanceOf(await context.core.getAddress());
    const beforeAdapterBalance = await context.token.balanceOf(strategyAddress);
    const beforeShares = await adapter.sharesOfCore();
    const beforeTotalDeployed = await context.core.totalDeployed();
    const beforeProtocolExposure = await context.core.protocolExposure(context.protocolId);
    const beforeAssetExposure = await context.core.assetExposure(await context.token.getAddress());

    await expect(context.core.connect(context.automation).allocateToStrategy(strategyAddress, 1n * USDC))
      .to.be.revertedWithCustomError(vault, 'DepositFailed');

    const after = await context.core.strategies(strategyAddress);
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(beforeCoreBalance);
    expect(await context.token.balanceOf(strategyAddress)).to.equal(beforeAdapterBalance);
    expect(await adapter.sharesOfCore()).to.equal(beforeShares);
    expect(after.principal).to.equal(before.principal);
    expect(after.shares).to.equal(before.shares);
    expect(after.position).to.equal(before.position);
    expect(after.realizedYield).to.equal(before.realizedYield);
    expect(after.realizedLoss).to.equal(before.realizedLoss);
    expect(await context.core.totalDeployed()).to.equal(beforeTotalDeployed);
    expect(await context.core.protocolExposure(context.protocolId)).to.equal(beforeProtocolExposure);
    expect(await context.core.assetExposure(await context.token.getAddress())).to.equal(beforeAssetExposure);
  });

  it('rejects unapproved protocols, assets, and strategies', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await fund(context, context.userA, 10n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'NotApproved');
  });

  it('does not allow automation to grant itself permissions or bypass policy', async () => {
    const context = await deployCore();
    await expect(context.core.connect(context.automation).grantRole(await context.core.POLICY_ADMIN_ROLE(), context.automation.address))
      .to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
    await fund(context, context.userA, 10n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'NotApproved');
  });

  it('timelocks risk-increasing policy changes and prevents early execution', async () => {
    const context = await deployCore();
    const id = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleRiskPolicy(0, 5_000, 5n * USDC));
    await expect(context.core.connect(context.timelockExecutor).executeRiskPolicy(id))
      .to.be.revertedWithCustomError(context.core, 'TimelockNotReady');
  });

  it('executes a risk-increasing policy change only after the delay', async () => {
    const context = await deployCore();
    const id = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleRiskPolicy(0, 5_000, 5n * USDC));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await context.core.connect(context.timelockExecutor).executeRiskPolicy(id);
    const policy = await context.core.riskPolicy();
    expect(policy.minimumLiquidReserveBps).to.equal(5_000);
    expect(policy.maximumTotalDeployed).to.equal(5n * USDC);
  });

  it('applies risk-reducing policy changes immediately', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 5_000, 5n * USDC);
    await context.core.connect(context.policyAdmin).reduceRiskPolicy(0, 6_000, 4n * USDC);
    const policy = await context.core.riskPolicy();
    expect(policy.minimumLiquidReserveBps).to.equal(6_000);
    expect(policy.maximumTotalDeployed).to.equal(4n * USDC);
  });

  it('allows immediate disabling of approved strategies', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC);
    await context.core.connect(context.policyAdmin).disableStrategy(await context.strategy.getAddress());
    await fund(context, context.userA, 5n * USDC);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'Disabled');
  });

  it('reduces protocol, asset, and strategy caps immediately', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await context.core.connect(context.policyAdmin).reduceProtocolCap(context.protocolId, 4n * USDC, 9_000);
    await context.core.connect(context.policyAdmin).reduceAssetCap(await context.token.getAddress(), 4n * USDC, 9_000);
    await context.core.connect(context.policyAdmin).reduceStrategyCap(await context.strategy.getAddress(), 4n * USDC, 9_000);
    expect((await context.core.protocolCaps(context.protocolId)).absoluteCap).to.equal(4n * USDC);
    expect((await context.core.assetCaps(await context.token.getAddress())).absoluteCap).to.equal(4n * USDC);
    expect((await context.core.strategies(await context.strategy.getAddress())).absoluteCap).to.equal(4n * USDC);
  });

  it('cancels a scheduled risk increase without changing policy', async () => {
    const context = await deployCore();
    const id = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleRiskPolicy(0, 5_000, 5n * USDC));
    await context.core.connect(context.policyAdmin).cancelTimelock(id);
    await time.increase(2 * 24 * 60 * 60 + 1);
    await expect(context.core.connect(context.timelockExecutor).executeRiskPolicy(id))
      .to.be.revertedWithCustomError(context.core, 'TimelockMissing');
    expect((await context.core.riskPolicy()).maximumTotalDeployed).to.equal(0);
  });

  it('reverts when reapproving a strategy with nonzero shares', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    const strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.shares).to.not.equal(0);
    await expect(context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    )).to.be.revertedWithCustomError(context.core, 'ActiveStrategy');
  });

  it('reverts when reapproving a strategy with nonzero current value', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    const strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.position).to.not.equal(0);
    await expect(context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    )).to.be.revertedWithCustomError(context.core, 'ActiveStrategy');
  });

  it('reverts when reapproving a strategy with nonzero deployed position', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    const strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.position).to.not.equal(0);
    await expect(context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    )).to.be.revertedWithCustomError(context.core, 'ActiveStrategy');
  });

  it('allows approval of a genuinely unused zero-position strategy', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    const unusedStrategy = await ethers.deployContract('MockStrategyAdapter', [await context.token.getAddress(), context.protocolId]);
    await context.core.connect(context.policyAdmin).configureProtocolVault(context.protocolId, await unusedStrategy.vault());
    const protocolApprovalId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleProtocolApproval(context.protocolId, 10n * USDC, 10_000));
    const assetId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleAssetApproval(await context.token.getAddress(), 10n * USDC, 10_000));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await context.core.connect(context.timelockExecutor).executeProtocolApproval(protocolApprovalId);
    await context.core.connect(context.timelockExecutor).executeAssetApproval(assetId);
    const approvalId = await operationId(context.core, context.core.connect(context.policyAdmin).scheduleStrategyApproval(await unusedStrategy.getAddress(), context.protocolId, await context.token.getAddress(), 10n * USDC, 10_000));
    await time.increase(2 * 24 * 60 * 60 + 1);
    await expect(context.core.connect(context.timelockExecutor).executeStrategyApproval(approvalId)).to.not.be.reverted;
    expect((await context.core.strategies(await unusedStrategy.getAddress())).approved).to.equal(true);
    expect((await context.core.strategies(await unusedStrategy.getAddress())).position).to.equal(0);
  });

  it('keeps strategy accounting unchanged after a rejected reapproval', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    const beforeStrategy = await context.core.strategies(await context.strategy.getAddress());
    const beforeTotalDeployed = await context.core.totalDeployed();
    const beforeProtocolExposure = await context.core.protocolExposure(context.protocolId);
    const beforeAssetExposure = await context.core.assetExposure(await context.token.getAddress());

    await expect(context.core.connect(context.policyAdmin).scheduleStrategyApproval(
      await context.strategy.getAddress(),
      context.protocolId,
      await context.token.getAddress(),
      5n * USDC,
      10_000,
    )).to.be.revertedWithCustomError(context.core, 'ActiveStrategy');

    const afterStrategy = await context.core.strategies(await context.strategy.getAddress());
    expect(afterStrategy.shares).to.equal(beforeStrategy.shares);
    expect(afterStrategy.position).to.equal(beforeStrategy.position);
    expect(afterStrategy.principal).to.equal(beforeStrategy.principal);
    expect(await context.core.totalDeployed()).to.equal(beforeTotalDeployed);
    expect(await context.core.protocolExposure(context.protocolId)).to.equal(beforeProtocolExposure);
    expect(await context.core.assetExposure(await context.token.getAddress())).to.equal(beforeAssetExposure);
  });

  it('pauses deposits, allocations, and risk increases while emergency deallocation remains available', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 5n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.core.connect(context.emergency).pause();
    await expect(context.core.connect(context.userA).deposit(1n)).to.be.revertedWithCustomError(context.core, 'EnforcedPause');
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n)).to.be.revertedWithCustomError(context.core, 'EnforcedPause');
    await expect(context.core.connect(context.policyAdmin).scheduleRiskPolicy(0, 0, 10n * USDC)).to.be.revertedWithCustomError(context.core, 'EnforcedPause');
    await expect(context.core.connect(context.emergency).emergencyDeallocate(await context.strategy.getAddress(), 5n * USDC)).to.not.be.reverted;
  });

  it('blocks a user from withdrawing their own liquid balance while paused', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await fund(context, context.userA, 5n * USDC);
    await context.core.connect(context.emergency).pause();
    expect((await context.core.userFinancialState(context.userA.address)).immediatelyWithdrawableValue).to.equal(0);
    await expect(context.core.connect(context.userA).withdraw(2n * USDC, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'EnforcedPause');
    expect(await context.core.userBalance(context.userA.address)).to.equal(5n * USDC);
    expect(await context.core.totalUserLiabilities()).to.equal(5n * USDC);
    expect(await context.token.balanceOf(context.userA.address)).to.equal(0n);
  });

  it('blocks a user from withdrawing with deallocation while paused', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await fund(context, context.userA, 5n * USDC);
    await context.core.connect(context.emergency).pause();
    expect((await context.core.userFinancialState(context.userA.address)).immediatelyWithdrawableValue).to.equal(0);
    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      2n * USDC,
      context.userA.address,
      [],
      [],
    )).to.be.revertedWithCustomError(context.core, 'EnforcedPause');
    expect(await context.core.userBalance(context.userA.address)).to.equal(5n * USDC);
    expect(await context.core.totalUserLiabilities()).to.equal(5n * USDC);
  });

  it('enforces ownership and balance limits for paused withdrawals', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await fund(context, context.userA, 5n * USDC);
    await context.core.connect(context.emergency).pause();
    await expect(context.core.connect(context.userA).withdraw(6n * USDC, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'EnforcedPause');
    await expect(context.core.connect(context.userB).withdraw(1n, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'EnforcedPause');
  });

  it('blocks paused withdrawals before liquidity checks', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.core.connect(context.emergency).pause();
    await expect(context.core.connect(context.userA).withdraw(6n * USDC, context.userA.address))
      .to.be.revertedWithCustomError(context.core, 'EnforcedPause');
  });

  it('does not let emergency authority transfer arbitrary funds', async () => {
    const context = await deployCore();
    await expect(context.core.connect(context.emergency).withdraw(1n, context.emergency.address))
      .to.be.revertedWithCustomError(context.core, 'InsufficientUserBalance');
  });

  it('rejects reentrant token callbacks during withdrawal', async () => {
    const [governance, policyAdmin, timelockExecutor, automation, emergency, userA, recipient] = await ethers.getSigners();
    const token = await ethers.deployContract('ReentrantUSDC');
    const core = await ethers.deployContract('VeloxTreasuryCore', [
      await token.getAddress(), governance.address, policyAdmin.address, timelockExecutor.address, automation.address, emergency.address,
      [0n, 10_000, 0n], [0, 10_000, 0, 0], 100n,
    ]);
    await token.mint(userA.address, USDC);
    await token.connect(userA).approve(await core.getAddress(), USDC);
    await core.connect(userA).deposit(USDC);
    await token.setTransferCallback(await core.getAddress(), core.interface.encodeFunctionData('deposit', [1n]));
    await expect(core.connect(userA).withdraw(USDC, userA.address))
      .to.be.revertedWithCustomError(core, 'ReentrancyGuardReentrantCall');
  });

  it('restores liquidity and preserves accounting after deallocation', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 5_000, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.core.connect(context.automation).deallocateFromStrategy(await context.strategy.getAddress(), 5n * USDC);
    expect(await context.core.totalUserLiabilities()).to.equal(10n * USDC);
    expect(await context.core.totalDeployed()).to.equal(0);
    expect(await context.core.availableLiquidity()).to.equal(5n * USDC);
  });

  it('rejects zero and invalid constructor addresses', async () => {
    const context = await deployCore();
    const initialPolicyArgs = [[0n, 10_000, 0n], [0, 10_000, 0, 0], 100n];
    await expect(ethers.deployContract('VeloxTreasuryCore', [ethers.ZeroAddress, context.governance.address, context.policyAdmin.address, context.timelockExecutor.address, context.automation.address, context.emergency.address, ...initialPolicyArgs]))
      .to.be.revertedWithCustomError(context.core, 'InvalidAddress');
    await expect(ethers.deployContract('VeloxTreasuryCore', [await context.token.getAddress(), context.governance.address, context.policyAdmin.address, context.timelockExecutor.address, context.automation.address, context.emergency.address, [0n, 10_000, 0n], [0, 10_000, 0, 0], 0n]))
      .to.be.revertedWithCustomError(context.core, 'InvalidValuationFreshness');
    await expect(ethers.deployContract('VeloxTreasuryCore', [await context.token.getAddress(), context.governance.address, context.policyAdmin.address, context.timelockExecutor.address, context.automation.address, context.emergency.address, [0n, 10_000, 0n], [0, 10_000, 0, 1], 100n]))
      .to.be.revertedWithCustomError(context.core, 'InvalidBucketAllocationTotal');
    await expect(context.core.connect(context.userA).deposit(0)).to.be.revertedWithCustomError(context.core, 'InvalidAmount');
  });

  it('rejects unauthorized emergency, policy, timelock, and automation actions', async () => {
    const context = await deployCore();
    await expect(context.core.connect(context.outsider).pause()).to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
    await expect(context.core.connect(context.outsider).scheduleRiskPolicy(0, 0, 0)).to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
    await expect(context.core.connect(context.outsider).executeRiskPolicy(ethers.ZeroHash)).to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
    await expect(context.core.connect(context.outsider).allocateToStrategy(context.outsider.address, 1)).to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
  });

  it('handles zero-fee strategy accounting correctly under yield and loss', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    const adapterFees = await context.strategy.feesAccrued();
    expect(adapterFees).to.equal(0);
    expect(await context.core.totalManagedAssets()).to.equal(1_000n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 250n * USDC);
    await context.strategy.setAssetValue(1_250n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    let strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.position).to.equal(1_250n * USDC);
    expect(await context.core.totalManagedAssets()).to.equal(1_250n * USDC);
    expect(strategyState.realizedYield).to.equal(0);

    await context.strategy.setAssetValue(750n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.position).to.equal(750n * USDC);
    expect(await context.core.totalManagedAssets()).to.equal(750n * USDC);
    expect(strategyState.realizedLoss).to.equal(0);
  });

  it('records a synced gain exactly once when the strategy is redeemed', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 250n * USDC);
    await context.strategy.setAssetValue(1_250n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    expect((await context.core.strategies(await context.strategy.getAddress())).realizedYield).to.equal(0);

    await context.core.connect(context.automation).deallocateFromStrategy(await context.strategy.getAddress(), 1_000n * USDC);
    const state = await context.core.strategies(await context.strategy.getAddress());
    expect(state.realizedYield).to.equal(250n * USDC);
    expect(state.realizedLoss).to.equal(0);
    expect(await context.core.totalManagedAssets()).to.equal(1_250n * USDC);
  });

  it('records a synced loss exactly once when the strategy is redeemed', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.strategy.setAssetValue(750n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    expect((await context.core.strategies(await context.strategy.getAddress())).realizedLoss).to.equal(0);

    await context.core.connect(context.automation).deallocateFromStrategy(await context.strategy.getAddress(), 1_000n * USDC);
    const state = await context.core.strategies(await context.strategy.getAddress());
    expect(state.realizedYield).to.equal(0);
    expect(state.realizedLoss).to.equal(250n * USDC);
    expect(await context.core.totalManagedAssets()).to.equal(750n * USDC);
  });

  it('accumulates multiple valuation changes as unrealized until redemption', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.strategy.setAssetValue(1_100n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    await context.token.mint(await context.strategy.getAddress(), 100n * USDC);
    await context.strategy.setAssetValue(1_200n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    expect((await context.core.strategies(await context.strategy.getAddress())).realizedYield).to.equal(0);

    await context.token.mint(await context.strategy.getAddress(), 200n * USDC);
    await context.core.connect(context.automation).deallocateFromStrategy(await context.strategy.getAddress(), 1_000n * USDC);
    const state = await context.core.strategies(await context.strategy.getAddress());
    expect(state.realizedYield).to.equal(200n * USDC);
    expect(state.realizedLoss).to.equal(0);
  });

  it('blocks stale valuations after the configured block boundary and restores freshness on sync', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 2_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await mine(101);
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'ValuationNotCurrent');

    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n)).to.not.be.reverted;
  });

  it('rejects valuation sync from an unauthorized caller', async () => {
    const context = await deployCore();
    await authorizeStrategy(context);

    await expect(context.core.connect(context.outsider).syncStrategyValuation(await context.strategy.getAddress()))
      .to.be.revertedWithCustomError(context.core, 'AccessControlUnauthorizedAccount');
  });

  it('allows valuation refresh for a disabled strategy without allowing new allocations', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);
    await context.core.connect(context.policyAdmin).disableStrategy(await context.strategy.getAddress());
    await context.core.connect(context.automation).markStrategyValuationStale(await context.strategy.getAddress());

    await expect(context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [5n * USDC],
    )).to.be.revertedWithCustomError(context.core, 'ValuationNotCurrent');
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'Disabled');
    await context.core.connect(context.userA).withdrawWithDeallocation(
      10n * USDC,
      context.userA.address,
      [await context.strategy.getAddress()],
      [5n * USDC],
    );
    expect(await context.core.userBalance(context.userA.address)).to.equal(0);
  });

  it('allows read-only valuation refresh after the approved protocol is disabled', async () => {
    const context = await deployCore();
    await authorizeStrategy(context);
    await context.core.connect(context.policyAdmin).disableProtocol(context.protocolId);

    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress())).to.not.be.reverted;
  });

  it('allows read-only valuation refresh after the approved asset is disabled', async () => {
    const context = await deployCore();
    await authorizeStrategy(context);
    await context.core.connect(context.policyAdmin).disableAsset(await context.token.getAddress());

    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress())).to.not.be.reverted;
  });

  it('rejects sync for an unapproved adapter identity', async () => {
    const context = await deployCore();
    const otherStrategy = await ethers.deployContract('MockStrategyAdapter', [await context.token.getAddress(), context.protocolId]);
    await authorizeStrategy(context);

    await expect(context.core.connect(context.automation).syncStrategyValuation(await otherStrategy.getAddress()))
      .to.be.revertedWithCustomError(context.core, 'NotApproved');
  });

  it('rejects sync when the adapter protocol identity changes', async () => {
    const context = await deployCore();
    await authorizeStrategy(context);
    await context.strategy.setProtocol(ethers.keccak256(ethers.toUtf8Bytes('CHANGED_PROTOCOL')));

    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress()))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');
  });

  it('rejects sync when the adapter asset identity changes', async () => {
    const context = await deployCore();
    const otherToken = await ethers.deployContract('MockUSDC');
    await authorizeStrategy(context);
    await context.strategy.setAsset(await otherToken.getAddress());

    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress()))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');
  });

  it('rejects sync when the adapter vault identity changes', async () => {
    const context = await deployCore();
    await authorizeStrategy(context);
    await context.strategy.setVault(await context.userA.getAddress());

    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress()))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');
  });

  it('rejects valuation sync while Core is paused', async () => {
    const context = await deployCore();
    await authorizeStrategy(context);
    await context.core.connect(context.emergency).pause();

    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress()))
      .to.be.revertedWithCustomError(context.core, 'EnforcedPause');
  });

  it('allows valid repeated syncs and updates the authoritative position', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 10n * USDC);
    await authorizeStrategy(context, 10n * USDC, 10_000);
    await fund(context, context.userA, 10n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 5n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 1n * USDC);
    await context.strategy.setAssetValue(6n * USDC);
    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress())).to.not.be.reverted;
    await expect(context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress())).to.not.be.reverted;

    const state = await context.core.strategies(await context.strategy.getAddress());
    expect(state.position).to.equal(6n * USDC);
    expect(state.realizedYield).to.equal(0);
    expect(await context.core.totalDeployed()).to.equal(6n * USDC);
    expect(await context.core.totalManagedAssets()).to.equal(11n * USDC);
  });

  it('rejects an adapter after its approved vault identity changes', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 5n * USDC);
    await authorizeStrategy(context, 5n * USDC, 10_000);
    await fund(context, context.userA, 5n * USDC);
    await context.strategy.setVault(await context.userA.getAddress());

    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n * USDC))
      .to.be.revertedWithCustomError(context.core, 'StrategyMismatch');
    expect(await context.token.balanceOf(await context.core.getAddress())).to.equal(5n * USDC);
  });

  it('keeps multi-user proportional NAV exact across yield and withdrawals', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);

    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 1_000n * USDC);
    await context.strategy.setAssetValue(2_000n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    expect(await context.core.userBalance(context.userA.address)).to.equal(2_000n * USDC);

    await fund(context, context.userB, 1_000n * USDC);
    expect(await context.core.userBalance(context.userA.address)).to.equal(2_000n * USDC);
    expect(await context.core.userBalance(context.userB.address)).to.equal(1_000n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 1_600n * USDC);
    await context.strategy.setAssetValue(3_600n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    const aNav = await context.core.userBalance(context.userA.address);
    const bNav = await context.core.userBalance(context.userB.address);
    const liabilities = await context.core.totalUserLiabilities();
    expect(liabilities - (aNav + bNav)).to.be.at.most(1n);
    expect(await context.core.totalManagedAssets()).to.equal(4_600n * USDC);

    const liquidBefore = await context.core.liquidUSDC();
    const validWithdraw = 500n * USDC;
    await context.core.connect(context.userA).withdraw(validWithdraw, context.userA.address);
    const aAfter = await context.core.userBalance(context.userA.address);
    const bAfter = await context.core.userBalance(context.userB.address);
    expect(aAfter).to.be.at.most(aNav - validWithdraw + 1n);
    expect(aAfter).to.be.at.least(aNav - validWithdraw - 1n);
    expect(bAfter).to.be.at.most(bNav + 1n);
    expect(bAfter).to.be.at.least(bNav - 1n);
    const totalLiabilities = await context.core.totalUserLiabilities();
    expect(aAfter + bAfter).to.be.at.most(totalLiabilities + 1n);
    expect(aAfter + bAfter).to.be.at.least(totalLiabilities - 1n);
    expect(await context.core.totalManagedAssets()).to.equal(await context.core.liquidUSDC() + await context.core.totalDeployed());
    expect(liquidBefore - validWithdraw).to.equal(await context.core.liquidUSDC());
  });

  it('rejects stale strategy valuation before risk-increasing allocation', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.core.connect(context.automation).markStrategyValuationStale(await context.strategy.getAddress());
    await expect(context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1n))
      .to.be.revertedWithCustomError(context.core, 'ValuationNotCurrent');
  });

  it('preserves accounting through emergency deallocation after yield and loss', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 500n * USDC);
    await context.strategy.setAssetValue(1_500n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    await context.core.connect(context.emergency).emergencyDeallocate(await context.strategy.getAddress(), 1_000n * USDC);
    let strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.realizedYield).to.equal(500n * USDC);
    expect(strategyState.position).to.equal(0);
    expect(await context.core.totalDeployed()).to.equal(0);

    await fund(context, context.userB, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);
    await context.strategy.setAssetValue(800n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    await context.core.connect(context.emergency).emergencyDeallocate(await context.strategy.getAddress(), 1_000n * USDC);
    strategyState = await context.core.strategies(await context.strategy.getAddress());
    expect(strategyState.realizedLoss).to.equal(200n * USDC);
    expect(strategyState.position).to.equal(0);
    expect(await context.core.totalDeployed()).to.equal(0);
  });

  it('reports an authoritative zero financial state for a new user without a deposit', async () => {
    const context = await deployCore();

    const state = await context.core.userFinancialState(context.userA.address);
    const position = await context.core.userStrategyPosition(
      context.userA.address,
      await context.strategy.getAddress(),
    );

    expect(await context.core.userBalance(context.userA.address)).to.equal(0);
    expect(state.principal).to.equal(0);
    expect(state.currentValue).to.equal(0);
    expect(state.unrealizedPnl).to.equal(0);
    expect(state.realizedPnl).to.equal(0);
    expect(state.totalPnl).to.equal(0);
    expect(state.immediatelyWithdrawableValue).to.equal(0);
    expect(position.shares).to.equal(0);
    expect(position.position).to.equal(0);
  });

  it('reports zero user P/L immediately after deposit', async () => {
    const context = await deployCore();
    await fund(context, context.userA, 1_000n * USDC);

    const state = await context.core.userFinancialState(context.userA.address);
    expect(state.principal).to.equal(1_000n * USDC);
    expect(state.currentValue).to.equal(1_000n * USDC);
    expect(state.unrealizedPnl).to.equal(0);
    expect(state.realizedPnl).to.equal(0);
    expect(state.totalPnl).to.equal(0);
    expect(state.immediatelyWithdrawableValue).to.equal(1_000n * USDC);
    const events = await context.core.queryFilter(context.core.filters.UserFinancialStateChanged(context.userA.address));
    expect(events.at(-1)?.args.immediatelyWithdrawableValue).to.equal(1_000n * USDC);
  });

  it('attributes strategy gains and losses to the user without double counting', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 250n * USDC);
    await context.strategy.setAssetValue(1_250n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    let state = await context.core.userFinancialState(context.userA.address);
    expect(state.unrealizedPnl).to.equal(250n * USDC);
    expect(state.realizedPnl).to.equal(0);
    expect(state.totalPnl).to.equal(250n * USDC);

    await context.strategy.setAssetValue(750n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    state = await context.core.userFinancialState(context.userA.address);
    expect(state.currentValue).to.equal(750n * USDC);
    expect(state.unrealizedPnl).to.equal(-250n * USDC);
    expect(state.realizedPnl).to.equal(0);
    expect(state.totalPnl).to.equal(-250n * USDC);
  });

  it('crystallizes realized P/L on partial withdrawal and settles on full withdrawal', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);
    await context.token.mint(await context.strategy.getAddress(), 250n * USDC);
    await context.strategy.setAssetValue(1_250n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    await context.core.connect(context.automation).deallocateFromStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.core.connect(context.userA).withdraw(500n * USDC, context.userA.address);
    let state = await context.core.userFinancialState(context.userA.address);
    expect(state.principal).to.equal(600n * USDC);
    expect(state.currentValue).to.equal(750n * USDC);
    expect(state.unrealizedPnl).to.equal(150n * USDC);
    expect(state.realizedPnl).to.equal(100n * USDC);
    expect(state.totalPnl).to.equal(250n * USDC);

    await context.core.connect(context.userA).withdraw(750n * USDC, context.userA.address);
    state = await context.core.userFinancialState(context.userA.address);
    expect(state.principal).to.equal(0);
    expect(state.currentValue).to.equal(0);
    expect(state.unrealizedPnl).to.equal(0);
    expect(state.realizedPnl).to.equal(250n * USDC);
    expect(state.totalPnl).to.equal(250n * USDC);
    expect(state.immediatelyWithdrawableValue).to.equal(0);
  });

  it('keeps user P/L isolated across users and strategies', async () => {
    const context = await deployCore();
    const secondStrategy = await ethers.deployContract('MockStrategyAdapter', [await context.token.getAddress(), context.protocolId]);
    await setDeployablePolicy(context, 0, 100_000n * USDC);
    await authorizeStrategy(context, 10_000n * USDC, 10_000);
    await authorizeStrategy(context, 10_000n * USDC, 10_000, secondStrategy);
    await fund(context, context.userA, 500n * USDC);
    await fund(context, context.userB, 500n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 500n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await secondStrategy.getAddress(), 500n * USDC);

    await context.token.mint(await context.strategy.getAddress(), 100n * USDC);
    await context.strategy.setAssetValue(600n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await context.strategy.getAddress());
    await secondStrategy.setAssetValue(500n * USDC);
    await context.core.connect(context.automation).syncStrategyValuation(await secondStrategy.getAddress());

    const userA = await context.core.userFinancialState(context.userA.address);
    const userB = await context.core.userFinancialState(context.userB.address);
    expect(userA.principal).to.equal(500n * USDC);
    expect(userB.principal).to.equal(500n * USDC);
    expect(userA.currentValue).to.equal(550n * USDC);
    expect(userB.currentValue).to.equal(550n * USDC);
    expect(userA.totalPnl).to.equal(50n * USDC);
    expect(userB.totalPnl).to.equal(50n * USDC);
    expect(userA.totalPnl + userB.totalPnl).to.equal(100n * USDC);
  });

  it('records withdrawal shortfall as user loss when the strategy returns less than principal', async () => {
    const context = await deployCore();
    await setDeployablePolicy(context, 0, 1_000n * USDC);
    await authorizeStrategy(context, 1_000n * USDC, 10_000);
    await fund(context, context.userA, 1_000n * USDC);
    await context.core.connect(context.automation).allocateToStrategy(await context.strategy.getAddress(), 1_000n * USDC);
    await context.strategy.setWithdrawalBps(9_000);
    await context.core.connect(context.automation).deallocateFromStrategy(await context.strategy.getAddress(), 1_000n * USDC);

    await context.core.connect(context.userA).withdraw(900n * USDC, context.userA.address);
    const state = await context.core.userFinancialState(context.userA.address);
    expect(state.principal).to.equal(0);
    expect(state.currentValue).to.equal(0);
    expect(state.unrealizedPnl).to.equal(0);
    expect(state.realizedPnl).to.equal(-100n * USDC);
    expect(state.totalPnl).to.equal(-100n * USDC);
  });
});
