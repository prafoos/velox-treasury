import { ethers } from 'hardhat';
import { expect } from 'chai';

describe('SteakhousePrimeUSDCAdapter', () => {
  const protocolId = ethers.keccak256(ethers.toUtf8Bytes('STEAKHOUSE_PRIME_USDC_MORPHO_VAULT_V2'));

  it('immutably binds the explicitly supplied Core', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    expect(await adapter.core()).to.equal(core.address);
    expect(adapter.interface.fragments.some((fragment) => fragment.type === 'function' && fragment.name === 'setCore')).to.equal(false);
  });

  it('uses the correct USDC asset', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);

    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    expect(await adapter.asset()).to.equal(await usdc.getAddress());
  });

  it('returns vault shares for a deposit', async () => {
    const [core, , user] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(user.address, 1_000n * 10n ** 6n);
    await usdc.connect(user).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);

    await adapter.connect(core).deposit(1_000n * 10n ** 6n);
    expect(await adapter.sharesOfCore()).to.equal(1_000n * 10n ** 6n);
    expect(await adapter.currentValue()).to.equal(1_000n * 10n ** 6n);
  });

  it('reports current redeemable value from the underlying vault', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    await vault.setTotalAssets(1_500n * 10n ** 6n);
    expect(await adapter.currentValue()).to.equal(1_500n * 10n ** 6n);
  });

  it('previewRedeem reflects vault math', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    const shares = await adapter.sharesOfCore();
    expect(await adapter.previewRedeem(shares)).to.equal(await vault.previewRedeem(shares));
  });

  it('supports full redemption and returns actual USDC received', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    const shares = await adapter.sharesOfCore();
    const received = await adapter.connect(core).withdrawShares.staticCall(shares, await adapter.getAddress());
    await adapter.connect(core).withdrawShares(shares, await adapter.getAddress());
    expect(received).to.equal(1_000n * 10n ** 6n);
    expect(await adapter.sharesOfCore()).to.equal(0);
    expect(await usdc.balanceOf(await adapter.getAddress())).to.equal(1_000n * 10n ** 6n);
  });

  it('supports partial redemption', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    const shares = await adapter.sharesOfCore();
    const halfShares = shares / 2n;
    const received = await adapter.connect(core).withdrawShares.staticCall(halfShares, await adapter.getAddress());
    await adapter.connect(core).withdrawShares(halfShares, await adapter.getAddress());
    expect(received).to.equal(500n * 10n ** 6n);
    expect(await adapter.sharesOfCore()).to.equal(halfShares);
  });

  it('tracks yield increasing current value', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    await vault.setTotalAssets(1_250n * 10n ** 6n);
    expect(await adapter.currentValue()).to.equal(1_250n * 10n ** 6n);
  });

  it('tracks loss reducing current value', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    await vault.setTotalAssets(750n * 10n ** 6n);
    expect(await adapter.currentValue()).to.equal(750n * 10n ** 6n);
  });

  it('reverts on failed redemption', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    await vault.setFailRedeem(true);
    await expect(adapter.connect(core).withdrawShares(1_000n * 10n ** 6n, await adapter.getAddress()))
      .to.be.reverted; 
  });

  it('preserves shortfall accounting when redemption is less than preview', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    await vault.setUnexpectedRedeemGap(100n * 10n ** 6n);
    const shares = await adapter.sharesOfCore();
    const preview = await adapter.previewRedeem(shares);
    const received = await adapter.connect(core).withdrawShares.staticCall(shares, await adapter.getAddress());
    await adapter.connect(core).withdrawShares(shares, await adapter.getAddress());
    expect(received).to.equal(preview - 100n * 10n ** 6n);
  });

  it('rejects a wrong asset configuration', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const other = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await other.getAddress()]);

    const factory = await ethers.getContractFactory('SteakhousePrimeUSDCAdapter');
    await expect(factory.deploy(
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    )).to.be.revertedWithCustomError(factory, 'InvalidAsset');
  });

  it('rejects unauthorized callers', async () => {
    const [core, , user] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await expect(adapter.connect(user).deposit(1n)).to.be.revertedWithCustomError(adapter, 'UnauthorizedCaller');
    await expect(adapter.connect(user).withdrawShares(1n, user.address)).to.be.revertedWithCustomError(adapter, 'UnauthorizedCaller');
  });

  it('rejects unexpected token delta during redemption', async () => {
    const [core] = await ethers.getSigners();
    const usdc = await ethers.deployContract('MockUSDC');
    const vault = await ethers.deployContract('MockERC4626Vault', [await usdc.getAddress()]);
    const adapter = await ethers.deployContract('SteakhousePrimeUSDCAdapter', [
      await vault.getAddress(),
      core.address,
      protocolId,
      await usdc.getAddress(),
    ]);

    await usdc.mint(core.address, 1_000n * 10n ** 6n);
    await usdc.connect(core).approve(await adapter.getAddress(), 1_000n * 10n ** 6n);
    await adapter.connect(core).deposit(1_000n * 10n ** 6n);

    await vault.setUnexpectedTransferGap(1n);
    await expect(adapter.connect(core).withdrawShares(await adapter.sharesOfCore(), await adapter.getAddress()))
      .to.be.reverted;
  });
});
